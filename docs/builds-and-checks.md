# Builds and checks

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

## Runtime and checks

Node 24.22.2 or newer with the exact peers `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas@4.0.0` for `fonts`, `wawoff2@2.0.1` for `woff2` and `harfbuzzjs@1.6.4` for `subsetWoff2`. Source fonts and their licences stay in the client repositories.

Run `make check` for the full package gate. Use `make lint` for formatting, ESLint, TypeScript, Markdown and ShellCheck, or `make test` to build and install the package, check its public imports and declarations, and run the Node tests. Only `make build` writes to the checkout, replacing ignored `node/dist`. It exits before launching Docker if Git tracks `node/dist` or any of its contents.

Make runs `tests/container/check-stock` using the stock images pinned in `tests/container/images`. One Node container installs the development and peer dependencies, downloads the Skia prebuild and uses a fresh scratch source tree for each Node phase. Lint adds separate Markdown and read-only ShellCheck containers. The shared `tests/container/stock` functions copy the Git-listed source into `/work` without Git metadata or credentials. Containers run as uid 19001 with a read-only root, four CPUs and bounded scratch. Node and Markdown containers use the network to install dependencies. Each container starts only while the one-minute load is below 20. The [Markdown tooling notes](../tests/container/README.md) document the scoped security overrides and their removal criteria.

Check, pack and provision containers have a 4 GiB memory ceiling. `scripts/provision.sh` and `scripts/pack.sh` run `scripts/container.mts` with host Node through type stripping. Both wait for the one-minute load to fall below 20 before launching Docker. Pack archives the packaging script and payload from the same committed revision. Their builds and downloads run in a `node:24.22.2` container as uid 19001 (`--user 19001:19001 -e HOME=/tmp`), with four CPUs, a read-only root and no network except while provisioning. Host paths are read-only bind mounts. Writable state lives in a per-run `/tmp` volume, outputs leave through `docker cp`, and owned containers and volumes are removed on exit.

| Command                                                 | Effect                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bash scripts/provision.sh <empty-directory>`           | Downloads the pinned dependencies from `node/package.json` into `<empty-directory>/node/node_modules` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` from the committed `HEAD`            |

Formatting follows `.prettierrc`; `node/tests/fixtures` is excluded because the tests compare it byte for byte. Lint rules are in `eslint.config.mjs` and the shared `eslint.config.base.mjs`. ESLint layers the `node/src` areas, lowest first: `raster` imports no other area, `codecs` and `fonts` import `raster`, `atlas` imports `raster` and `codecs`, and `build` imports no other area. Type-only imports follow the same layers. In TypeScript sources, scripts and container checks, an import with only type specifiers must use `import type` so it does not load the module at runtime. `import-x/no-cycle` rejects runtime import cycles in `node/src`, `scripts`, `tests/container` and `node/tests`, and TypeScript `erasableSyntaxOnly` rejects parameter properties, enums and namespaces. On a branch push or pull request, CI runs `make lint` and the attribution scan. The verification job skips changes confined to `docs/` when CI can compare against the base commit. Changes outside `docs/`, including `README.md`, and events without a usable base also run `make check`, then provision, pack and upload the committed release artifacts. Game projects test their own adapters and authored output; no game build is part of the package gate.
