# Development checks

Use these commands to check, build or package an Art Kit source checkout. For rebuilding a
consumer's assets, see the [build runner](../reference/build-runner.md#builds).

## Runtime and checks

See the [package requirements](../reference/package.md#runtime-and-peers) for the supported Node
version and peers. The container checks install their own dependencies.

Run `make check` for the full package gate. Use `make lint` for formatting, ESLint, TypeScript, Markdown and ShellCheck, or `make test` to build and install the package, check its public imports and declarations, and run the Node tests. Only `make build` writes to the checkout, replacing ignored `node/dist`. It exits before launching Docker if Git tracks `node/dist` or any of its contents.

Make runs `tests/container/check-stock` using the stock images pinned in `tests/container/images`. One Node container installs the development and peer dependencies, downloads the Skia prebuild and uses a fresh scratch source tree for each Node phase. Lint adds separate Markdown and read-only ShellCheck containers. The shared `tests/container/stock` functions copy the Git-listed source into `/work` without Git metadata or credentials. Containers run as uid 19001 with a read-only root, four CPUs and bounded scratch. Node and Markdown containers use the network to install dependencies. Each container starts only while the one-minute load is below 20. The [Markdown tooling notes](../../tests/container/README.md) document the scoped security overrides and their removal criteria.

Check, pack and provision containers have a 4 GiB memory ceiling. `scripts/provision.sh` and `scripts/pack.sh` run `scripts/container.mts` with host Node through type stripping. Both wait for the one-minute load to fall below 20 before launching Docker. Pack archives the packaging script and payload from the same committed revision. Their builds and downloads run in a `node:24.22.2` container as uid 19001 (`--user 19001:19001 -e HOME=/tmp`), with four CPUs, a read-only root and no network except while provisioning. Host paths are read-only bind mounts. Writable state lives in a per-run `/tmp` volume, outputs leave through `docker cp`, and owned containers and volumes are removed on exit.

| Command                                                 | Effect                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bash scripts/provision.sh <empty-directory>`           | Downloads the pinned dependencies from `node/package.json` into `<empty-directory>/node/node_modules` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` from the committed `HEAD`            |

Formatting follows `.prettierrc`; `node/tests/fixtures` is excluded because the tests compare it byte for byte. Lint rules are in `eslint.config.mjs` and the shared `eslint.config.base.mjs`. ESLint layers the `node/src` areas, lowest first: `raster` imports no other area, `codecs` and `fonts` import `raster`, `atlas` imports `raster` and `codecs`, and `build` imports no other area. Type-only imports follow the same layers. In TypeScript sources, scripts and container checks, an import with only type specifiers must use `import type` so it does not load the module at runtime. `import-x/no-cycle` rejects runtime import cycles in `node/src`, `scripts`, `tests/container` and `node/tests`, and TypeScript `erasableSyntaxOnly` rejects parameter properties, enums and namespaces. On a branch push or pull request, CI runs `make lint` and the attribution scan. The verification job skips changes confined to `docs/` when CI can compare against the base commit. Changes outside `docs/`, including `README.md`, and events without a usable base also run `make check`, then provision, pack and upload the committed release artifacts. Game projects test their own adapters and authored output; no game build is part of the package gate.
