// Sequential art build runner: dependency order, downstream selection, set table self-checks and a
// byte-snapshot check. Node built-ins only. Only `nodeBuild` spawns a process.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  buildOrder,
  type BuildSets,
  type ModuleDirectory,
  type SetChecks,
  setProblems,
  UsageError,
} from "./sets.js";
import {
  type Changes,
  compareSnapshots,
  formatChanges,
  snapshot,
  unclaimedFiles,
} from "./snapshot.js";

export {
  buildOrder,
  type BuildSet,
  type BuildSets,
  type ModuleCheck,
  type ModuleDirectory,
  type SetChecks,
} from "./sets.js";
export type { Changes } from "./snapshot.js";

/** Files and directories to snapshot before and after the rebuild. */
export interface BuildCheck {
  readonly paths: readonly string[];
  /**
   * Also fail on files under the paths, after the rebuild, that no set's `outputs` and no `static`
   * entry contains, such as a file a set no longer writes. Every set counts, selected or not; false
   * by default.
   */
  readonly outputs?: boolean;
  /** Hand-kept files and directories under the paths that no set writes, such as a licence. */
  readonly static?: readonly string[];
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

export interface BuildResult {
  /** The sets that ran, in order. */
  readonly order: readonly string[];
  /** Present when `check` was given; empty lists, since differences throw `CheckError`. */
  readonly changes?: Changes;
}

/** A set's build threw or rejected; `cause` is the original error. */
class BuildError extends Error {
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

/** The rebuild changed files under the check paths or left unclaimed files. */
class CheckError extends Error {
  override name = "CheckError";
  constructor(readonly changes: Changes) {
    const changed = changes.added.length + changes.removed.length + changes.changed.length;
    const unclaimed = changes.unclaimed?.length ?? 0;
    const parts = [
      ...(changed || !unclaimed
        ? [`the rebuild changed ${pathCount(changed)} under the check paths`]
        : []),
      ...(unclaimed
        ? [`the check found ${pathCount(unclaimed)} outside every set output and static entry`]
        : []),
    ];
    super(parts.join("; "));
  }
}

// The names, without the extension, of the files in directory that end with it.
function moduleNames({ directory, extension = ".ts" }: ModuleDirectory): Set<string> {
  return new Set(
    readdirSync(directory)
      .filter((file) => file.endsWith(extension) && file.length > extension.length)
      .map((file) => file.slice(0, -extension.length)),
  );
}

/**
 * Throw `RangeError` listing every problem the requested self-checks find, separated by `; `: with
 * `modules`, each file in the directory with the extension that is neither a set nor a non-set, each
 * set or non-set without a module, and each name listed as both; with `strictOrder`, each set
 * declared before a set it needs. Unknown needs and cycles are left to `buildOrder`.
 */
export function checkSets(checks: SetChecks, sets: BuildSets): void {
  const problems = setProblems(checks, checks.modules && moduleNames(checks.modules), sets);
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

// Run the sets in order after the self-checks, with the snapshot check around them.
async function execute(options: BuildOptions, selected?: readonly string[]): Promise<BuildResult> {
  const { check, log = console.log, sets } = options;
  if (check && "index" in check && check.index === true) {
    throw new RangeError("check.index has been removed");
  }
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
  const after = await snapshot(check.paths);
  const claimed = [
    ...Object.values(sets).flatMap((set) => set.outputs ?? []),
    ...(check.static ?? []),
  ];
  const changes = {
    ...compareSnapshots(before, after),
    ...(check.outputs && { unclaimed: unclaimedFiles(claimed, after) }),
  };
  const found = [changes.added, changes.removed, changes.changed, changes.unclaimed ?? []].some(
    (list) => list.length,
  );
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
 * with `check.outputs`, so do files after the run that no set's `outputs` or `check.static` contains.
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
 * differences or the build configuration is invalid, and 2 on a usage error (an unknown option or set, or
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
