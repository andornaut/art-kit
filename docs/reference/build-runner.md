# Build runner

<a name="builds-and-checks"></a>

## Builds

`build` runs a game's art build sets one at a time. The module uses only Node built-ins and spawns a process only for a `nodeBuild` step.

| Export                                                                               | Contract                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BuildSets`                                                                          | Set name to `{ build, needs? }`; `needs` names the sets whose outputs it reads                                                                                                                                            |
| `buildOrder(sets, selected?)`                                                        | Each set after its needs, ties in declaration order. Selected sets run with everything downstream, not their needs. Unknown needs and cycles throw `RangeError`; unknown selected names throw an error named `UsageError` |
| `checkSets({ strictOrder?, modules? }, sets)`                                        | Startup self-checks, all off by default; every problem found is listed in one `RangeError`                                                                                                                                |
| `runBuilds({ sets, check?, strictOrder?, modules?, log? }, selected?)`               | Runs `checkSets`, then logs `build <set>` before each and resolves to `{ changes?, order }`. A failing build throws an error named `BuildError` with `set` and `cause`                                                    |
| `check: { paths, outputs?, static? }`                                                | SHA-256 before/after snapshot under each path (symlinks by target). Changes or unclaimed files throw `CheckError` with sorted `{ added, changed, removed, unclaimed? }` lists.                                            |
| `nodeBuild({ directory, extension?, args? }, set)`                                   | A build step running `node <directory>/<set><extension> ...args` (defaults `.ts` and `["build"]`) with `process.execPath` and inherited stdio; throws `exit <status>` or `signal <name>`                                  |
| `buildCommand({ sets, check?, strictOrder?, modules?, usage?, log?, error? }, argv)` | `[--check] [SET...]`; resolves to 0, 1 for a failed self-check, a failing build, check differences or invalid build configuration, or 2 for a usage error followed by `usage`                                             |

### Self-checks

`strictOrder: true` requires the declared order to meet every need and throws `Set <set> must be declared after <need>, which it needs` instead of reordering; a table that passes runs in declaration order. `modules: { directory, nonSets, extension? }` reconciles a directory of one module per set (`.ts` by default) with the table. It counts regular files and symlinks to regular files matching the extension. The check lists each module that is neither a set nor in `nonSets`, each set or non-set without a module, and each name listed as both. Both are off by default so tables built in process, without modules or with a dependent declared first, keep working. `buildCommand` runs them after `--help` and before parsing the sets, so a failed self-check exits 1 even when the arguments also hold an unknown set.

### Command line

A sole `--help` or `-h` prints `usage` (or `Usage: [--check] [SET...]` when none is given) through `log`, which defaults to stdout, and returns 0 without running the self-checks. With other arguments either is an unknown option, exit 2.

### Check modes

The snapshot check compares the tree before and after the rebuild without Git, so it works in a copy with no `.git`. It ignores differences that existed before the run and includes ignored files under the check paths: run it on a clean checkout to compare the rebuild with the committed outputs. Relative paths resolve against the working directory.

`outputs: true` catches stale outputs without Git: each set lists the files and directories it writes in `outputs`, and `static` lists hand-kept files under the check paths, such as a licence. After the rebuild, every file under the check paths must equal or sit inside one of them, or the check fails with it in `unclaimed`, printed as `!\tpath`. Every set's `outputs` count, selected or not, so a partial rebuild does not flag other sets' files. A file a set stopped writing therefore fails the check even though the rebuild left it unchanged. Nothing is deleted.

```ts
import { buildCommand, nodeBuild } from "@andornaut/art-kit/build/build";

const tools = { directory: "art/tools" };
process.exitCode = await buildCommand(
  {
    check: { outputs: true, paths: ["public/art"], static: ["public/art/fonts/OFL.txt"] },
    modules: { ...tools, nonSets: ["build", "pixel"] },
    sets: {
      sprites: { build: nodeBuild(tools, "sprites"), outputs: ["public/art/sprites"] },
      silhouettes: {
        build: nodeBuild(tools, "silhouettes"),
        needs: ["sprites"],
        outputs: ["public/art/silhouettes.json"],
      },
    },
    strictOrder: true,
    usage: "Usage: node art/tools/build.ts [--check] [SET...]",
  },
  process.argv.slice(2),
);
```
