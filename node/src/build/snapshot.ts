// The byte-snapshot check: SHA-256 digests of the files under the check paths, and the
// differences between two snapshots. Only snapshot reads the file system.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { byCodeUnit } from "./sets.js";

/** Paths under the check paths that the rebuild added, removed or changed, each sorted. */
export interface Changes {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** With `outputs: true`: files after the rebuild that no set output or static entry contains. */
  readonly unclaimed?: readonly string[];
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

/** Snapshot keys that no claimed file or directory equals or contains, sorted. */
export function unclaimedFiles(
  claimed: readonly string[],
  after: ReadonlyMap<string, string>,
): string[] {
  const claims = claimed.map((path) => resolve(path));
  return [...after.keys()]
    .filter((key) => {
      const file = resolve(key);
      return !claims.some((claim) => file === claim || file.startsWith(claim + sep));
    })
    .sort(byCodeUnit);
}

/** Change lines for added (A), removed (D), changed (M) and unclaimed (!) files, sorted by path. */
export function formatChanges(changes: Changes): string[] {
  const lines = [
    ...changes.added.map((path) => [path, "A"] as const),
    ...changes.removed.map((path) => [path, "D"] as const),
    ...changes.changed.map((path) => [path, "M"] as const),
    ...(changes.unclaimed ?? []).map((path) => [path, "!"] as const),
  ];
  return lines
    .sort(([a, x], [b, y]) => byCodeUnit(a, b) || byCodeUnit(x, y))
    .map(([path, status]) => `${status}\t${path}`);
}
