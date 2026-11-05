import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCommand,
  BuildError,
  buildOrder,
  CheckError,
  checkSets,
  formatChanges,
  nodeBuild,
  runBuilds,
  UsageError,
} from "@andornaut/art-kit/build";

// A set table from [name, needs] pairs in declaration order; each build appends its name to ran.
function table(entries, ran = [], failing) {
  return Object.fromEntries(
    entries.map(([name, needs]) => [
      name,
      {
        needs,
        build: async () => {
          if (name === failing) {
            throw new Error(`${name} broke`);
          }
          ran.push(name);
        },
      },
    ]),
  );
}

const graph = [
  ["zeta", []],
  ["mixer", ["alpha", "zeta"]],
  ["alpha", []],
  ["late", ["mixer"]],
  ["beta", ["alpha"]],
  ["solo", undefined],
];

const orders = [
  {
    name: "declaration order breaks ties",
    entries: graph,
    selected: undefined,
    order: ["zeta", "alpha", "mixer", "late", "beta", "solo"],
  },
  {
    name: "empty selection runs every set",
    entries: graph,
    selected: [],
    order: ["zeta", "alpha", "mixer", "late", "beta", "solo"],
  },
  {
    name: "a set and everything downstream",
    entries: graph,
    selected: ["alpha"],
    order: ["alpha", "mixer", "late", "beta"],
  },
  { name: "downstream of a leaf is itself", entries: graph, selected: ["late"], order: ["late"] },
  {
    name: "several and duplicate selections",
    entries: graph,
    selected: ["solo", "zeta", "zeta"],
    order: ["zeta", "mixer", "late", "solo"],
  },
  {
    name: "upstream needs are not rebuilt",
    entries: graph,
    selected: ["mixer"],
    order: ["mixer", "late"],
  },
  {
    name: "independent sets keep declaration order",
    entries: [["b"], ["a"], ["c"]],
    selected: undefined,
    order: ["b", "a", "c"],
  },
  {
    name: "a dependent declared first waits",
    entries: [["top", ["base"]], ["base"]],
    selected: undefined,
    order: ["base", "top"],
  },
];

for (const { entries, name, order, selected } of orders) {
  test(`buildOrder: ${name}`, () => {
    assert.deepEqual(buildOrder(table(entries), selected), order);
  });
}

const invalid = [
  {
    name: "cycle",
    entries: [["a", ["c"]], ["b", ["a"]], ["c", ["b"]], ["d"]],
    error: RangeError,
    message: /cycle: a -> c -> b -> a$/,
  },
  { name: "self need", entries: [["a", ["a"]]], error: RangeError, message: /cycle: a -> a$/ },
  {
    name: "unknown need",
    entries: [
      ["a", ["ghost"]],
      ["b", ["phantom"]],
    ],
    error: RangeError,
    message: /^a needs unknown set ghost; b needs unknown set phantom$/,
  },
  {
    name: "unknown selection",
    entries: [["a"]],
    selected: ["b", "a", "c", "b"],
    error: UsageError,
    message: /^unknown set b, c$/,
  },
  {
    name: "inherited name is unknown",
    entries: [["a"]],
    selected: ["toString"],
    error: UsageError,
    message: /^unknown set toString$/,
  },
];

for (const { entries, error, message, name, selected } of invalid) {
  test(`buildOrder rejects ${name}`, () => {
    assert.throws(
      () => buildOrder(table(entries), selected),
      (caught) => caught instanceof error && message.test(caught.message),
    );
  });
}

test("runBuilds runs sequentially in order and logs each set", async () => {
  const events = [];
  const sets = {
    slow: {
      build: async () => {
        events.push("slow start");
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        events.push("slow end");
      },
    },
    sync: {
      needs: ["slow"],
      build: () => {
        events.push("sync");
      },
    },
  };
  const lines = [];
  const result = await runBuilds({ sets, log: (line) => lines.push(line) });
  assert.deepEqual(result.order, ["slow", "sync"]);
  assert.deepEqual(events, ["slow start", "slow end", "sync"]);
  assert.deepEqual(lines.slice(0, 2), ["build slow", "build sync"]);
  assert.match(lines[2], /^built 2 sets in \d+s$/);
});

test("runBuilds names the failing set and stops", async () => {
  const ran = [];
  const sets = table([["a"], ["b", ["a"]], ["c", ["b"]]], ran, "b");
  await assert.rejects(runBuilds({ sets, log: () => {} }), (caught) => {
    assert.ok(caught instanceof BuildError);
    assert.equal(caught.set, "b");
    assert.equal(caught.message, "b build failed: b broke");
    assert.equal(caught.cause.message, "b broke");
    return true;
  });
  assert.deepEqual(ran, ["a"]);
});

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), "art-kit-build-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "out", "nested"), { recursive: true });
  await writeFile(join(dir, "out", "keep.txt"), "same");
  await writeFile(join(dir, "out", "edit.txt"), "before");
  await writeFile(join(dir, "out", "nested", "gone.txt"), "x");
  await writeFile(join(dir, "single.txt"), "one");
  await symlink("keep.txt", join(dir, "out", "link"));
  return dir;
}

const checks = [
  { name: "an unchanged rebuild passes", edit: async () => {}, changes: undefined },
  {
    name: "rewriting identical bytes passes",
    edit: async (dir) => {
      await writeFile(join(dir, "out", "keep.txt"), "same");
    },
    changes: undefined,
  },
  {
    name: "added, removed and changed paths are reported sorted",
    edit: async (dir) => {
      await writeFile(join(dir, "out", "edit.txt"), "after");
      await writeFile(join(dir, "out", "b-new.txt"), "new");
      await writeFile(join(dir, "out", "a-new.txt"), "new");
      await rm(join(dir, "out", "nested", "gone.txt"));
      await writeFile(join(dir, "single.txt"), "two");
      await writeFile(join(dir, "missing.txt"), "created");
    },
    changes: (dir) => ({
      added: [
        join(dir, "missing.txt"),
        join(dir, "out", "a-new.txt"),
        join(dir, "out", "b-new.txt"),
      ],
      removed: [join(dir, "out", "nested", "gone.txt")],
      changed: [join(dir, "out", "edit.txt"), join(dir, "single.txt")],
    }),
  },
  {
    name: "a retargeted symbolic link is changed",
    edit: async (dir) => {
      await rm(join(dir, "out", "link"));
      await symlink("edit.txt", join(dir, "out", "link"));
    },
    changes: (dir) => ({ added: [], removed: [], changed: [join(dir, "out", "link")] }),
  },
];

for (const { changes, edit, name } of checks) {
  test(`runBuilds check: ${name}`, async (t) => {
    const dir = await scratch(t);
    const sets = { only: { build: () => edit(dir) } };
    const check = { paths: [join(dir, "out"), join(dir, "single.txt"), join(dir, "missing.txt")] };
    const run = runBuilds({ sets, check, log: () => {} });
    if (!changes) {
      assert.deepEqual((await run).changes, { added: [], removed: [], changed: [] });
      return;
    }
    await assert.rejects(run, (caught) => {
      assert.ok(caught instanceof CheckError);
      assert.deepEqual(caught.changes, changes(dir));
      return true;
    });
  });
}

const commands = [
  { name: "no arguments builds every set", argv: [], status: 0, ran: ["a", "b", "c"], errors: [] },
  { name: "named sets build downstream", argv: ["b"], status: 0, ran: ["b", "c"], errors: [] },
  {
    name: "--check passes on a clean rebuild",
    argv: ["--check", "a"],
    status: 0,
    ran: ["a", "b", "c"],
    errors: [],
  },
  {
    name: "unknown set is a usage error",
    argv: ["b", "nope"],
    status: 2,
    ran: [],
    errors: ["unknown set nope", "USAGE"],
  },
  {
    name: "unknown option is a usage error",
    argv: ["--fast"],
    status: 2,
    ran: [],
    errors: ["unknown option --fast", "USAGE"],
  },
  {
    name: "--check after a set is a usage error",
    argv: ["a", "--check"],
    status: 2,
    ran: [],
    errors: ["unknown option --check", "USAGE"],
  },
  {
    name: "--check without paths is a usage error",
    argv: ["--check"],
    check: false,
    status: 2,
    ran: [],
    errors: ["--check needs check paths", "USAGE"],
  },
  {
    name: "a failing build exits 1 naming the set",
    argv: [],
    failing: "b",
    status: 1,
    ran: ["a"],
    errors: ["b build failed: b broke"],
  },
];

for (const {
  argv,
  check = true,
  errors: expectedErrors,
  failing,
  name,
  ran: expected,
  status,
} of commands) {
  test(`buildCommand: ${name}`, async (t) => {
    const dir = await scratch(t);
    const ran = [];
    const errors = [];
    const sets = table([["a"], ["b", ["a"]], ["c", ["b"]]], ran, failing);
    const options = {
      sets,
      usage: "USAGE",
      log: () => {},
      error: (line) => errors.push(line),
      ...(check && { check: { paths: [join(dir, "out")] } }),
    };
    assert.equal(await buildCommand(options, argv), status);
    assert.deepEqual(ran, expected);
    // A failing build also prints the cause's stack before its summary line.
    assert.deepEqual(failing ? errors.slice(-1) : errors, expectedErrors);
  });
}

test("buildCommand --check prints changes sorted and exits 1", async (t) => {
  const dir = await scratch(t);
  const lines = [];
  const errors = [];
  const sets = {
    writer: {
      build: async () => {
        await writeFile(join(dir, "out", "edit.txt"), "after");
        await writeFile(join(dir, "out", "added.txt"), "new");
        await rm(join(dir, "out", "keep.txt"));
      },
    },
  };
  const options = {
    sets,
    check: { paths: [join(dir, "out")] },
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  assert.equal(await buildCommand(options, ["--check"]), 1);
  assert.deepEqual(lines.slice(-3), [
    `A\t${join(dir, "out", "added.txt")}`,
    `M\t${join(dir, "out", "edit.txt")}`,
    `D\t${join(dir, "out", "keep.txt")}`,
  ]);
  assert.deepEqual(errors, ["the rebuild changed 3 paths under the check paths"]);
});

test("buildCommand exits 1 on a cycle", async () => {
  const errors = [];
  const sets = table([
    ["a", ["b"]],
    ["b", ["a"]],
  ]);
  assert.equal(
    await buildCommand({ sets, log: () => {}, error: (line) => errors.push(line) }, []),
    1,
  );
  assert.deepEqual(errors, ["build sets form a cycle: a -> b -> a"]);
});

// A module directory holding each named file, empty.
async function moduleDir(t, files) {
  const dir = await mkdtemp(join(tmpdir(), "art-kit-modules-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Promise.all(files.map((file) => writeFile(join(dir, file), "")));
  return dir;
}

const selfChecks = [
  {
    name: "every module is a set or a non-set",
    files: ["a.ts", "b.ts", "shared.ts", "notes.md"],
    entries: [["a"], ["b", ["a"]]],
    checks: { modules: { nonSets: ["shared"] } },
    problems: undefined,
  },
  {
    name: "unknown modules, missing modules and overlaps are all listed",
    files: ["a.ts", "z-stray.ts", "m-stray.ts", "both.ts"],
    entries: [["a"], ["ghost"], ["both"]],
    checks: { modules: { nonSets: ["gone", "both"] } },
    problems: (dir) => [
      `${join(dir, "m-stray.ts")} is neither a set nor a listed non-set`,
      `${join(dir, "z-stray.ts")} is neither a set nor a listed non-set`,
      `set ghost has no module ${join(dir, "ghost.ts")}`,
      "both is listed as both a set and a non-set",
      `non-set gone has no module ${join(dir, "gone.ts")}`,
    ],
  },
  {
    name: "another extension",
    files: ["a.mjs", "b.ts", "c.mjs"],
    entries: [["a"]],
    checks: { modules: { extension: ".mjs", nonSets: [] } },
    problems: (dir) => [`${join(dir, "c.mjs")} is neither a set nor a listed non-set`],
  },
  {
    name: "a declared order that meets every need passes strictOrder",
    files: [],
    entries: [["a"], ["b", ["a"]], ["c", ["a", "b"]]],
    checks: { strictOrder: true },
    problems: undefined,
  },
  {
    name: "strictOrder names each set declared before a need",
    files: [],
    entries: [["top", ["base", "mid"]], ["mid", ["base"]], ["base"]],
    checks: { strictOrder: true },
    problems: () => [
      "top is declared before base, which it needs",
      "top is declared before mid, which it needs",
      "mid is declared before base, which it needs",
    ],
  },
  {
    name: "without strictOrder the same table passes",
    files: [],
    entries: [["top", ["base"]], ["base"]],
    checks: {},
    problems: undefined,
  },
  {
    name: "module problems come before order problems",
    files: ["b.ts", "a.ts", "x.ts"],
    entries: [["b", ["a"]], ["a"]],
    checks: { modules: { nonSets: [] }, strictOrder: true },
    problems: (dir) => [
      `${join(dir, "x.ts")} is neither a set nor a listed non-set`,
      "b is declared before a, which it needs",
    ],
  },
];

for (const { checks, entries, files, name, problems } of selfChecks) {
  test(`checkSets: ${name}`, async (t) => {
    const dir = await moduleDir(t, files);
    const options = checks.modules
      ? { ...checks, modules: { ...checks.modules, directory: dir } }
      : checks;
    const run = () => checkSets(options, table(entries));
    if (!problems) {
      run();
      return;
    }
    assert.throws(run, (caught) => {
      assert.ok(caught instanceof RangeError);
      assert.equal(caught.message, problems(dir).join("; "));
      return true;
    });
  });
}

test("runBuilds runs the self-checks before any build", async (t) => {
  const dir = await moduleDir(t, ["a.ts"]);
  const ran = [];
  const options = {
    log: () => {},
    modules: { directory: dir, nonSets: [] },
    sets: table([["a"], ["b"]], ran),
  };
  await assert.rejects(runBuilds(options), /^RangeError: set b has no module /);
  assert.deepEqual(ran, []);
});

test("strictOrder runs a valid table in declaration order", async () => {
  const ran = [];
  const sets = table([["c"], ["a", ["c"]], ["b"]], ran);
  assert.deepEqual((await runBuilds({ log: () => {}, sets, strictOrder: true })).order, [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(ran, ["c", "a", "b"]);
});

const helps = [
  { name: "--help prints usage", argv: ["--help"], usage: "USAGE", status: 0, lines: ["USAGE"] },
  { name: "-h prints usage", argv: ["-h"], usage: "USAGE", status: 0, lines: ["USAGE"] },
  {
    name: "help without usage prints the default",
    argv: ["--help"],
    usage: undefined,
    status: 0,
    lines: ["Usage: [--check] [SET...]"],
  },
  {
    name: "help ahead of the self-checks",
    argv: ["-h"],
    usage: "USAGE",
    strictOrder: true,
    status: 0,
    lines: ["USAGE"],
  },
  {
    name: "--help with other arguments is a usage error",
    argv: ["--check", "--help"],
    usage: "USAGE",
    status: 2,
    errors: ["unknown option --help", "USAGE"],
  },
  {
    name: "a failed self-check exits 1",
    argv: [],
    usage: "USAGE",
    strictOrder: true,
    status: 1,
    errors: ["b is declared before a, which it needs"],
  },
  {
    name: "a failed self-check outranks an unknown set",
    argv: ["nope"],
    usage: "USAGE",
    strictOrder: true,
    status: 1,
    errors: ["b is declared before a, which it needs"],
  },
];

for (const { argv, errors: expected = [], lines: logged = [], name, status, ...rest } of helps) {
  test(`buildCommand: ${name}`, async () => {
    const ran = [];
    const lines = [];
    const errors = [];
    const options = {
      ...rest,
      sets: table([["b", ["a"]], ["a"]], ran),
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
    };
    assert.equal(await buildCommand(options, argv), status);
    assert.deepEqual(ran, []);
    assert.deepEqual(lines, logged);
    assert.deepEqual(errors, expected);
  });
}

// Each child writes its argv to <name>.out; the rest exit as their name says.
const children = {
  "ok.mjs": "",
  "status.mjs": "process.exitCode = 3;",
  "signal.mjs": "process.kill(process.pid, 'SIGTERM');",
};

const spawns = [
  { name: "default args", set: "ok", options: {}, args: ["build"] },
  {
    name: "custom args",
    set: "ok",
    options: { args: ["build", "--fast"] },
    args: ["build", "--fast"],
  },
  { name: "nonzero exit", set: "status", options: {}, args: ["build"], error: "exit 3" },
  { name: "signal", set: "signal", options: {}, args: ["build"], error: "signal SIGTERM" },
];

for (const { args, error, name, options, set } of spawns) {
  test(`nodeBuild: ${name}`, async (t) => {
    const dir = await moduleDir(t, []);
    await Promise.all(
      Object.entries(children).map(([file, tail]) =>
        writeFile(
          join(dir, file),
          `import { writeFileSync } from "node:fs";\n` +
            `const out = ${JSON.stringify(`${join(dir, file)}.out`)};\n` +
            `writeFileSync(out, JSON.stringify(process.argv.slice(2)));\n${tail}\n`,
        ),
      ),
    );
    const build = nodeBuild({ directory: dir, extension: ".mjs", ...options }, set);
    if (error) {
      assert.throws(build, (caught) => caught.message === error);
    } else {
      build();
    }
    assert.deepEqual(JSON.parse(await readFile(join(dir, `${set}.mjs.out`), "utf8")), args);
  });
}

test("nodeBuild failures become BuildError naming the set", async (t) => {
  const dir = await moduleDir(t, []);
  await writeFile(join(dir, "broken.ts"), "process.exitCode = 1;\n");
  const sets = { broken: { build: nodeBuild({ directory: dir }, "broken") } };
  await assert.rejects(runBuilds({ log: () => {}, sets }), (caught) => {
    assert.ok(caught instanceof BuildError);
    assert.equal(caught.message, "broken build failed: exit 1");
    return true;
  });
});

function gitIn(dir, ...args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

// A committed repository: out/{clean,dirty,staged}.txt, single.txt, and out/ignored/ in .gitignore.
async function repository(t) {
  const dir = await mkdtemp(join(tmpdir(), "art-kit-index-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "out", "ignored"), { recursive: true });
  await mkdir(join(dir, "elsewhere"));
  await writeFile(join(dir, ".gitignore"), "out/ignored/\n");
  for (const file of ["clean.txt", "dirty.txt", "staged.txt", "gone.txt"]) {
    // eslint-disable-next-line no-await-in-loop
    await writeFile(join(dir, "out", file), file);
  }
  await writeFile(join(dir, "single.txt"), "one");
  await writeFile(join(dir, "elsewhere", "outside.txt"), "x");
  gitIn(dir, "-c", "init.defaultBranch=main", "init", "-q");
  gitIn(dir, "add", ".");
  gitIn(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

const indexChecks = [
  { name: "a clean checkout and rebuild pass", before: async () => {}, edit: async () => {} },
  {
    name: "staged changes match the index",
    before: async (dir) => {
      await writeFile(join(dir, "out", "staged.txt"), "staged edit");
      gitIn(dir, "add", "out/staged.txt");
    },
    edit: async () => {},
  },
  {
    name: "ignored and outside files are not flagged",
    before: async (dir) => {
      await writeFile(join(dir, "out", "ignored", "cache.bin"), "x");
      await writeFile(join(dir, "elsewhere", "outside.txt"), "edited");
      await writeFile(join(dir, "elsewhere", "new.txt"), "new");
    },
    edit: async () => {},
  },
  {
    name: "dirty and untracked files before the run are flagged",
    before: async (dir) => {
      await writeFile(join(dir, "out", "dirty.txt"), "edited");
      await rm(join(dir, "out", "gone.txt"));
      await writeFile(join(dir, "out", "new.txt"), "new");
      await writeFile(join(dir, "out", "..dots.txt"), "dots");
      await writeFile(join(dir, "single.txt"), "two");
    },
    edit: async () => {},
    changes: {
      added: [],
      removed: [],
      changed: [],
      dirty: ["out/dirty.txt", "out/gone.txt", "single.txt"],
      untracked: ["out/..dots.txt", "out/new.txt"],
    },
    lines: [
      "?\tout/..dots.txt",
      "~\tout/dirty.txt",
      "~\tout/gone.txt",
      "?\tout/new.txt",
      "~\tsingle.txt",
    ],
    message: "5 paths under the check paths differed from the Git index before the run",
  },
  {
    name: "rebuild changes and earlier dirt are both reported",
    before: async (dir) => {
      await writeFile(join(dir, "out", "dirty.txt"), "edited");
    },
    edit: async (dir) => {
      await writeFile(join(dir, "out", "dirty.txt"), "rebuilt");
      await writeFile(join(dir, "out", "made.txt"), "made");
    },
    changes: {
      added: ["out/made.txt"],
      removed: [],
      changed: ["out/dirty.txt"],
      dirty: ["out/dirty.txt"],
      untracked: [],
    },
    lines: ["M\tout/dirty.txt", "~\tout/dirty.txt", "A\tout/made.txt"],
    message: [
      "the rebuild changed 2 paths under the check paths",
      "1 path under the check paths differed from the Git index before the run",
    ].join("; "),
  },
  {
    name: "files the rebuild creates are only rebuild changes",
    before: async () => {},
    edit: async (dir) => {
      await writeFile(join(dir, "out", "made.txt"), "made");
    },
    changes: { added: ["out/made.txt"], removed: [], changed: [], dirty: [], untracked: [] },
    lines: ["A\tout/made.txt"],
    message: "the rebuild changed 1 path under the check paths",
  },
];

for (const { before, changes, edit, lines: expected, message, name } of indexChecks) {
  test(`runBuilds index check: ${name}`, async (t) => {
    const dir = await repository(t);
    const previous = process.cwd();
    process.chdir(dir);
    t.after(() => process.chdir(previous));
    await before(dir);
    const sets = { only: { build: () => edit(dir) } };
    const check = { index: true, paths: ["out", "single.txt", "missing.txt"] };
    const run = runBuilds({ check, log: () => {}, sets });
    if (!changes) {
      assert.deepEqual((await run).changes, {
        added: [],
        removed: [],
        changed: [],
        dirty: [],
        untracked: [],
      });
      return;
    }
    await assert.rejects(run, (caught) => {
      assert.ok(caught instanceof CheckError);
      assert.deepEqual(caught.changes, changes);
      assert.deepEqual(formatChanges(caught.changes), expected);
      assert.equal(caught.message, message);
      return true;
    });
  });
}

test("buildCommand --check with index prints the earlier dirt and exits 1", async (t) => {
  const dir = await repository(t);
  const previous = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(previous));
  await writeFile(join(dir, "out", "new.txt"), "new");
  const lines = [];
  const errors = [];
  const options = {
    sets: { only: { build: () => {} } },
    check: { index: true, paths: ["out"] },
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  assert.equal(await buildCommand(options, ["--check"]), 1);
  assert.deepEqual(lines.slice(-1), ["?\tout/new.txt"]);
  assert.deepEqual(errors, [
    "1 path under the check paths differed from the Git index before the run",
  ]);
});

test("runBuilds index check reports changes keyed like the snapshot", async (t) => {
  const dir = await repository(t);
  const previous = process.cwd();
  process.chdir(join(dir, "elsewhere"));
  t.after(() => process.chdir(previous));
  await writeFile(join(dir, "out", "dirty.txt"), "edited");
  await writeFile(join(dir, "out", "new.txt"), "new");
  const check = { index: true, paths: [join(dir, "out"), "../single.txt"] };
  await writeFile(join(dir, "single.txt"), "two");
  await assert.rejects(runBuilds({ check, log: () => {}, sets: {} }), (caught) => {
    assert.ok(caught instanceof CheckError);
    assert.deepEqual(caught.changes, {
      added: [],
      removed: [],
      changed: [],
      dirty: ["../single.txt", join(dir, "out", "dirty.txt")],
      untracked: [join(dir, "out", "new.txt")],
    });
    return true;
  });
});

test("only the index check runs git", async (t) => {
  const dir = await scratch(t);
  const path = process.env.PATH;
  process.env.PATH = "";
  t.after(() => {
    process.env.PATH = path;
  });
  const sets = { only: { build: () => {} } };
  const check = { paths: [join(dir, "out")] };
  assert.deepEqual((await runBuilds({ check, log: () => {}, sets })).changes, {
    added: [],
    removed: [],
    changed: [],
  });
  await assert.rejects(
    runBuilds({ check: { ...check, index: true }, log: () => {}, sets }),
    /^Error: git rev-parse failed: .*ENOENT/,
  );
});
