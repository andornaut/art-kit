// Sequential art build runner: dependency order, downstream selection, set table self-checks and a
// byte-snapshot check. Node built-ins only. Git runs only for a check with `index: true`, and a
// process is spawned only by a `nodeBuild` build.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** One build set: its build step and the sets whose outputs it reads. */
export interface BuildSet {
  readonly build: () => unknown;
  readonly needs?: readonly string[];
}

/** Build sets by name. Declaration (insertion) order breaks ties in the build order. */
export type BuildSets = Readonly<Record<string, BuildSet>>;

/** Files and directories to snapshot before and after the rebuild. */
export interface BuildCheck {
  readonly paths: readonly string[];
  /**
   * Also fail on files under the paths that differed from the Git index (`dirty`) or were untracked
   * and not ignored (`untracked`) before the run. Runs `git` in the working directory; false by
   * default, which keeps the check Git-free.
   */
  readonly index?: boolean;
}

/** A directory of one module per set, named `<set><extension>`. */
export interface ModuleDirectory {
  readonly directory: string;
  /** Defaults to `.ts`. */
  readonly extension?: string;
}

/** The module directory to reconcile with the sets: every module is a set or a listed non-set. */
export interface ModuleCheck extends ModuleDirectory {
  /** Module names, without the extension, that are not sets. */
  readonly nonSets: readonly string[];
}

/** Startup self-checks on the set table, all off by default. */
export interface SetChecks {
  /** Throw when a set is declared before a set it needs instead of reordering. */
  readonly strictOrder?: boolean;
  /** Throw on a module that is neither a set nor a listed non-set, and on a missing module. */
  readonly modules?: ModuleCheck;
}

export interface BuildOptions extends SetChecks {
  readonly sets: BuildSets;
  readonly check?: BuildCheck;
  /** Progress lines; defaults to `console.log`. */
  readonly log?: (line: string) => void;
}

export interface CommandOptions extends BuildOptions {
  /** Usage text printed after a usage error and, on stdout, for `--help` or `-h`. */
  readonly usage?: string;
  /** Error lines; defaults to `console.error`. */
  readonly error?: (line: string) => void;
}

export interface NodeBuildOptions extends ModuleDirectory {
  /** Arguments after the module path; defaults to `["build"]`. */
  readonly args?: readonly string[];
}

/** Paths under the check paths that the rebuild added, removed or changed, each sorted. */
export interface Changes {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** With `index: true`: tracked files that differed from the Git index before the run, sorted. */
  readonly dirty?: readonly string[];
  /** With `index: true`: untracked, unignored files present before the run, sorted. */
  readonly untracked?: readonly string[];
}

export interface BuildResult {
  /** The sets that ran, in order. */
  readonly order: readonly string[];
  /** Present when `check` was given; empty lists, since differences throw `CheckError`. */
  readonly changes?: Changes;
}

/** An unknown set name in a selection or a command line argument. */
export class UsageError extends Error {
  override name = "UsageError";
}

/** A set's build threw or rejected; `cause` is the original error. */
export class BuildError extends Error {
  override name = "BuildError";
  constructor(
    readonly set: string,
    cause: unknown,
  ) {
    super(`${set} build failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

const pathCount = (count: number): string => `${count} path${count === 1 ? "" : "s"}`;

/** The rebuild changed files under the check paths, or, with `index: true`, they were not clean. */
export class CheckError extends Error {
  override name = "CheckError";
  constructor(readonly changes: Changes) {
    const changed = changes.added.length + changes.removed.length + changes.changed.length;
    const unclean = (changes.dirty?.length ?? 0) + (changes.untracked?.length ?? 0);
    const parts = [
      ...(changed || !unclean
        ? [`the rebuild changed ${pathCount(changed)} under the check paths`]
        : []),
      ...(unclean
        ? [`${pathCount(unclean)} under the check paths differed from the Git index before the run`]
        : []),
    ];
    super(parts.join("; "));
  }
}

const own = (sets: BuildSets, name: string): boolean => Object.hasOwn(sets, name);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Throw `RangeError` listing every problem the requested self-checks find, separated by `; `: with
 * `modules`, each file in the directory with the extension that is neither a set nor a non-set, each
 * set or non-set without a module, and each name listed as both; with `strictOrder`, each set
 * declared before a set it needs. Unknown needs and cycles are left to `buildOrder`.
 */
export function checkSets(checks: SetChecks, sets: BuildSets): void {
  const { modules, strictOrder = false } = checks;
  const problems: string[] = [];
  if (modules) {
    const { directory, extension = ".ts", nonSets } = modules;
    const listed = new Set(nonSets);
    const found = new Set(
      readdirSync(directory)
        .filter((file) => file.endsWith(extension) && file.length > extension.length)
        .map((file) => file.slice(0, -extension.length)),
    );
    const modulePath = (name: string) => join(directory, `${name}${extension}`);
    for (const name of [...found].sort(byCodeUnit)) {
      if (!own(sets, name) && !listed.has(name)) {
        problems.push(`${modulePath(name)} is neither a set nor a listed non-set`);
      }
    }
    for (const name of Object.keys(sets)) {
      if (listed.has(name)) {
        problems.push(`${name} is listed as both a set and a non-set`);
      } else if (!found.has(name)) {
        problems.push(`set ${name} has no module ${modulePath(name)}`);
      }
    }
    for (const name of listed) {
      if (!own(sets, name) && !found.has(name)) {
        problems.push(`non-set ${name} has no module ${modulePath(name)}`);
      }
    }
  }
  if (strictOrder) {
    const names = Object.keys(sets);
    for (const [index, name] of names.entries()) {
      for (const need of sets[name].needs ?? []) {
        if (names.indexOf(need) > index) {
          problems.push(`${name} is declared before ${need}, which it needs`);
        }
      }
    }
  }
  if (problems.length) {
    throw new RangeError(problems.join("; "));
  }
}

/**
 * A build step that runs `node <directory>/<set><extension> ...args` in its own process with the
 * current Node executable and inherited stdio. A spawn failure throws its error; a nonzero exit
 * throws `exit <status>` and a signal `signal <name>`, which `runBuilds` wraps in `BuildError`.
 */
export function nodeBuild(options: NodeBuildOptions, set: string): () => void {
  const { args = ["build"], directory, extension = ".ts" } = options;
  return () => {
    const result = spawnSync(process.execPath, [join(directory, `${set}${extension}`), ...args], {
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.signal !== null) {
      throw new Error(`signal ${result.signal}`);
    }
    if (result.status !== 0) {
      throw new Error(`exit ${result.status}`);
    }
  };
}

function findCycle(sets: BuildSets, remaining: ReadonlySet<string>): string[] {
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  function visit(name: string): string[] | undefined {
    state.set(name, "open");
    stack.push(name);
    for (const need of sets[name].needs ?? []) {
      if (!remaining.has(need)) {
        continue;
      }
      if (state.get(need) === "open") {
        return [...stack.slice(stack.indexOf(need)), need];
      }
      if (!state.has(need)) {
        const found = visit(need);
        if (found) {
          return found;
        }
      }
    }
    stack.pop();
    state.set(name, "done");
    return undefined;
  }
  for (const name of remaining) {
    if (!state.has(name)) {
      const found = visit(name);
      if (found) {
        return found;
      }
    }
  }
  return [...remaining];
}

/**
 * Every set in build order: each set after every set it needs, ties broken by declaration order
 * (the earliest-declared ready set runs next). With `selected`, only those sets and every set
 * downstream of them, directly or transitively, in the same order. Throws `RangeError` naming an
 * unknown need or a cycle, and `UsageError` naming unknown selected sets.
 */
export function buildOrder(sets: BuildSets, selected?: readonly string[]): string[] {
  const names = Object.keys(sets);
  const unknownNeeds = names.flatMap((name) =>
    (sets[name].needs ?? [])
      .filter((need) => !own(sets, need))
      .map((need) => `${name} needs unknown set ${need}`),
  );
  if (unknownNeeds.length) {
    throw new RangeError(unknownNeeds.join("; "));
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < names.length) {
    const next = names.find(
      (name) => !done.has(name) && (sets[name].needs ?? []).every((need) => done.has(need)),
    );
    if (next === undefined) {
      const cycle = findCycle(sets, new Set(names.filter((name) => !done.has(name))));
      throw new RangeError(`build sets form a cycle: ${cycle.join(" -> ")}`);
    }
    order.push(next);
    done.add(next);
  }
  if (!selected?.length) {
    return order;
  }
  const unknown = [...new Set(selected.filter((name) => !own(sets, name)))];
  if (unknown.length) {
    throw new UsageError(`unknown set ${unknown.join(", ")}`);
  }
  const chosen = new Set(selected);
  for (const name of order) {
    if ((sets[name].needs ?? []).some((need) => chosen.has(need))) {
      chosen.add(name);
    }
  }
  return order.filter((name) => chosen.has(name));
}

type Snapshot = Map<string, string>;

async function snapshotInto(path: string, into: Snapshot): Promise<void> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) {
      // eslint-disable-next-line no-await-in-loop
      await snapshotInto(join(path, entry), into);
    }
  } else if (stat.isSymbolicLink()) {
    into.set(path, `link:${await readlink(path)}`);
  } else if (stat.isFile()) {
    into.set(
      path,
      `file:${createHash("sha256")
        .update(await readFile(path))
        .digest("hex")}`,
    );
  } else {
    into.set(path, `other:${stat.mode}`);
  }
}

/**
 * A SHA-256 digest of every file under each path, keyed by its path joined to the given one. A
 * missing path contributes nothing; symbolic links are recorded by target, not followed.
 */
export async function snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const into: Snapshot = new Map();
  for (const path of paths) {
    // eslint-disable-next-line no-await-in-loop
    await snapshotInto(path, into);
  }
  return into;
}

/** The paths added, removed and changed from `before` to `after`, each sorted. */
export function compareSnapshots(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Changes {
  const sorted = (list: string[]) => list.sort(byCodeUnit);
  return {
    added: sorted([...after.keys()].filter((path) => !before.has(path))),
    changed: sorted(
      [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path)),
    ),
    removed: sorted([...before.keys()].filter((path) => !after.has(path))),
  };
}

function git(args: readonly string[]): string {
  const result = spawnSync("git", ["--literal-pathspecs", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`git ${args[0]} failed: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const reason = result.stderr.trim() || `exit ${result.status ?? result.signal}`;
    throw new Error(`git ${args[0]} failed: ${reason}`);
  }
  return result.stdout;
}

/**
 * The tracked files under `paths` that differ from the Git index and the untracked, unignored files
 * under them, keyed like `snapshot` (each joined to the check path that holds it) and sorted. Runs
 * `git` in the working directory without taking the index lock.
 */
function indexState(paths: readonly string[]): Pick<Changes, "dirty" | "untracked"> {
  if (!paths.length) {
    return { dirty: [], untracked: [] };
  }
  // Paths are compared in a virtual tree rooted at the repository top, so symbolic links in the
  // working directory's path do not matter.
  const cwd = resolve(sep, git(["rev-parse", "--show-prefix"]).trim());
  const roots = paths.map((path) => [path, resolve(cwd, relative(process.cwd(), resolve(path)))]);
  const keyed = (output: string): string[] => {
    const keys = new Set<string>();
    for (const file of output.split("\0").filter(Boolean)) {
      const target = resolve(sep, file);
      for (const [path, root] of roots) {
        const inner = relative(root, target);
        if (inner !== ".." && !inner.startsWith(`..${sep}`) && !isAbsolute(inner)) {
          keys.add(inner ? join(path, inner) : path);
          break;
        }
      }
    }
    return [...keys].sort(byCodeUnit);
  };
  return {
    dirty: keyed(
      git(["diff", "--no-ext-diff", "--no-relative", "--name-only", "-z", "--", ...paths]),
    ),
    untracked: keyed(
      git(["ls-files", "--others", "--exclude-standard", "--full-name", "-z", "--", ...paths]),
    ),
  };
}

/**
 * Lines `A\tpath`, `D\tpath` and `M\tpath` for the rebuild's changes, and with `index: true`
 * `~\tpath` for a file that differed from the Git index and `?\tpath` for an untracked file before
 * the run, sorted by path.
 */
export function formatChanges(changes: Changes): string[] {
  const lines = [
    ...changes.added.map((path) => [path, "A"] as const),
    ...changes.removed.map((path) => [path, "D"] as const),
    ...changes.changed.map((path) => [path, "M"] as const),
    ...(changes.dirty ?? []).map((path) => [path, "~"] as const),
    ...(changes.untracked ?? []).map((path) => [path, "?"] as const),
  ];
  return lines
    .sort(([a, x], [b, y]) => byCodeUnit(a, b) || byCodeUnit(x, y))
    .map(([path, status]) => `${status}\t${path}`);
}

// Run the sets in order after the self-checks, with the snapshot (and index) check around them.
async function execute(options: BuildOptions, selected?: readonly string[]): Promise<BuildResult> {
  const { check, log = console.log, sets } = options;
  const order = buildOrder(sets, selected);
  const unclean = check?.index ? indexState(check.paths) : {};
  const before = check && (await snapshot(check.paths));
  const started = performance.now();
  for (const name of order) {
    log(`build ${name}`);
    try {
      // Sets build one at a time, in dependency order.
      // eslint-disable-next-line no-await-in-loop
      await sets[name].build();
    } catch (error) {
      throw new BuildError(name, error);
    }
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  log(`built ${order.length} set${order.length === 1 ? "" : "s"} in ${seconds}s`);
  if (!check || !before) {
    return { order };
  }
  const changes = { ...compareSnapshots(before, await snapshot(check.paths)), ...unclean };
  const found = [
    changes.added,
    changes.removed,
    changes.changed,
    changes.dirty ?? [],
    changes.untracked ?? [],
  ].some((list) => list.length);
  if (found) {
    throw new CheckError(changes);
  }
  return { changes, order };
}

/**
 * Run the selected sets (every set when none is selected) one at a time in `buildOrder`, logging
 * `build <set>` before each, after `checkSets` with the options' `strictOrder` and `modules`. A
 * failing build stops the run with `BuildError`. With `check`, the files under its paths are
 * snapshotted before the first build and after the last, and any difference throws `CheckError`;
 * with `check.index`, so do files that differed from the Git index or were untracked before the run.
 */
export async function runBuilds(
  options: BuildOptions,
  selected?: readonly string[],
): Promise<BuildResult> {
  checkSets(options, options.sets);
  return execute(options, selected);
}

const HELP: ReadonlySet<string> = new Set(["--help", "-h"]);

/**
 * Command line wrapper for `[--check] [SET...]`. A sole `--help` or `-h` prints `usage` (or a
 * default line) to `log` and returns 0. Otherwise it runs `checkSets`, then the builds, and returns
 * the exit status: 0 on success, 1 when a self-check fails, a build fails, the check finds
 * differences or the sets are invalid, and 2 on a usage error (an unknown option or set, or
 * `--check` without `check` paths). Other errors propagate.
 */
export async function buildCommand(
  options: CommandOptions,
  argv: readonly string[],
): Promise<number> {
  const { check, error = console.error, log = console.log, usage } = options;
  if (argv.length === 1 && HELP.has(argv[0])) {
    log(usage ?? "Usage: [--check] [SET...]");
    return 0;
  }
  const checking = argv[0] === "--check";
  const named = checking ? argv.slice(1) : argv;
  try {
    checkSets(options, options.sets);
    const option = named.find((arg) => arg.startsWith("-"));
    if (option !== undefined) {
      throw new UsageError(`unknown option ${option}`);
    }
    if (checking && !check) {
      throw new UsageError("--check needs check paths");
    }
    await execute({ log, sets: options.sets, ...(checking && { check }) }, named);
    return 0;
  } catch (caught) {
    if (caught instanceof UsageError) {
      error(caught.message);
      if (usage) {
        error(usage);
      }
      return 2;
    }
    if (caught instanceof CheckError) {
      for (const line of formatChanges(caught.changes)) {
        log(line);
      }
      error(caught.message);
      return 1;
    }
    if (caught instanceof BuildError) {
      if (caught.cause instanceof Error && caught.cause.stack) {
        error(caught.cause.stack);
      }
      error(caught.message);
      return 1;
    }
    if (caught instanceof RangeError) {
      error(caught.message);
      return 1;
    }
    throw caught;
  }
}
