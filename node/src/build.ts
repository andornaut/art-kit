// Sequential art build runner: dependency order, downstream selection and a byte-snapshot check.
// Node built-ins only; no module here spawns a process or reads Git.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

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
}

export interface BuildOptions {
  readonly sets: BuildSets;
  readonly check?: BuildCheck;
  /** Progress lines; defaults to `console.log`. */
  readonly log?: (line: string) => void;
}

export interface CommandOptions extends BuildOptions {
  /** Usage text printed after a usage error. */
  readonly usage?: string;
  /** Error lines; defaults to `console.error`. */
  readonly error?: (line: string) => void;
}

/** Paths under the check paths that the rebuild added, removed or changed, each sorted. */
export interface Changes {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
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

/** The rebuild changed files under the check paths. */
export class CheckError extends Error {
  override name = "CheckError";
  constructor(readonly changes: Changes) {
    const count = changes.added.length + changes.removed.length + changes.changed.length;
    super(`the rebuild changed ${count} path${count === 1 ? "" : "s"} under the check paths`);
  }
}

const own = (sets: BuildSets, name: string): boolean => Object.hasOwn(sets, name);

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
  const sorted = (list: string[]) => list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    added: sorted([...after.keys()].filter((path) => !before.has(path))),
    changed: sorted(
      [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path)),
    ),
    removed: sorted([...before.keys()].filter((path) => !after.has(path))),
  };
}

/** Lines `A\tpath`, `D\tpath` and `M\tpath`, sorted by path. */
export function formatChanges(changes: Changes): string[] {
  const lines = [
    ...changes.added.map((path) => [path, "A"] as const),
    ...changes.removed.map((path) => [path, "D"] as const),
    ...changes.changed.map((path) => [path, "M"] as const),
  ];
  return lines
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, status]) => `${status}\t${path}`);
}

/**
 * Run the selected sets (every set when none is selected) one at a time in `buildOrder`, logging
 * `build <set>` before each. A failing build stops the run with `BuildError`. With `check`, the
 * files under its paths are snapshotted before the first build and after the last, and any
 * difference throws `CheckError`.
 */
export async function runBuilds(
  options: BuildOptions,
  selected?: readonly string[],
): Promise<BuildResult> {
  const { check, log = console.log, sets } = options;
  const order = buildOrder(sets, selected);
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
  const changes = compareSnapshots(before, await snapshot(check.paths));
  if (changes.added.length || changes.removed.length || changes.changed.length) {
    throw new CheckError(changes);
  }
  return { changes, order };
}

/**
 * Command line wrapper for `[--check] [SET...]`. Returns the exit status: 0 on success, 1 when a
 * build fails, the check finds differences or the sets are invalid, and 2 on a usage error
 * (an unknown option or set, or `--check` without `check` paths). Other errors propagate.
 */
export async function buildCommand(
  options: CommandOptions,
  argv: readonly string[],
): Promise<number> {
  const { check, error = console.error, log = console.log, sets, usage } = options;
  const checking = argv[0] === "--check";
  const named = checking ? argv.slice(1) : argv;
  try {
    const option = named.find((arg) => arg.startsWith("-"));
    if (option !== undefined) {
      throw new UsageError(`unknown option ${option}`);
    }
    if (checking && !check) {
      throw new UsageError("--check needs check paths");
    }
    await runBuilds({ log, sets, ...(checking && { check }) }, named);
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
