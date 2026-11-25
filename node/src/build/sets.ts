// The build set table: its types, dependency order and self-check problems. No I/O.
import { join } from "node:path";

/** One build set: its build step, the sets whose outputs it reads and the paths it writes. */
export interface BuildSet {
  readonly build: () => unknown;
  readonly needs?: readonly string[];
  /** Files and directories this set writes, for a check with `outputs: true`. */
  readonly outputs?: readonly string[];
}

/** Build sets by name. Declaration (insertion) order breaks ties in the build order. */
export type BuildSets = Readonly<Record<string, BuildSet>>;

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

/** An unknown set name in a selection or a command line argument. */
export class UsageError extends Error {
  override name = "UsageError";
}

export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const own = (sets: BuildSets, name: string): boolean => Object.hasOwn(sets, name);

/**
 * Every problem the requested self-checks find. found holds the module names in the `modules`
 * directory, read by the caller. With `modules`: each module that is neither a set nor a non-set,
 * each set or non-set without a module, and each name listed as both; with `strictOrder`, each
 * set declared before a set it needs.
 */
export function setProblems(
  checks: SetChecks,
  found: ReadonlySet<string> | undefined,
  sets: BuildSets,
): string[] {
  const { modules, strictOrder = false } = checks;
  const problems: string[] = [];
  if (modules && found) {
    const { directory, extension = ".ts", nonSets } = modules;
    const listed = new Set(nonSets);
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
  return problems;
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
