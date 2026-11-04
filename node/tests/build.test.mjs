import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BuildError,
  buildCommand,
  buildOrder,
  CheckError,
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
          if (name === failing) throw new Error(`${name} broke`);
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

for (const { name, entries, selected, order } of orders) {
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

for (const { name, entries, selected, error, message } of invalid) {
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
        await new Promise((resolve) => setTimeout(resolve, 20));
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

for (const { name, edit, changes } of checks) {
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
  name,
  argv,
  check = true,
  failing,
  status,
  ran: expected,
  errors: expectedErrors,
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
