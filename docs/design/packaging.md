# Packaging

The package is `@andornaut/art-kit`: TypeScript compiled to ESM with declarations, released as a
GitHub release tarball with no registry publication. Every API is an explicit `build/<name>`
subpath; `runtime/*` and `test/*` are absent and there is no root barrel. Peers are exact:
`pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas`, `wawoff2` and
`harfbuzzjs`. `make check`, `lint`, `test` and `build` run `tests/container/check-stock`, which uses
pinned stock images and the shared `stock` core: Git-listed source, uid 19001, a read-only root,
bounded CPU, memory and scratch, and a container start only while the one-minute load is below 20.
CI classifies the changed paths first: a change only under `docs/` runs lint and the attribution
scan, and anything else also runs `make check` and builds the committed release artifacts. The
tarball holds compiled ESM, declarations, `LICENSE` and `SOURCE_COMMIT`, and no docs. A release is
tagged only after every required CI workflow passes on the exact `main` commit.

Reference: [Boundaries](../../README.md#boundaries), [Runtime and
checks](../../README.md#runtime-and-checks), [Version and
licence](../../README.md#version-and-licence), [Released
dependency](../../README.md#released-dependency), [API entry points](../api-entry-points.md),
[container tooling](../../tests/container/README.md).

## Work items

| ID      | Title                                                       | Link                             |
| ------- | ----------------------------------------------------------- | -------------------------------- |
| ak-0001 | Run every container as uid 19001 with read-only host mounts | [ak-0001.md](../work/ak-0001.md) |
| ak-0007 | Move container orchestration into a TypeScript module       | [ak-0007.md](../work/ak-0007.md) |
| ak-0009 | Release TypeScript only and remove the Python package       | [ak-0009.md](../work/ak-0009.md) |
| ak-0011 | Remove public exports neither game imports                  | [ak-0011.md](../work/ak-0011.md) |
| ak-0018 | Run Prettier and ESLint in the check container              | [ak-0018.md](../work/ak-0018.md) |
| ak-0023 | Remove unused public surface                                | [ak-0023.md](../work/ak-0023.md) |
| ak-0024 | Add Markdown, ShellCheck and attribution CI gates           | [ak-0024.md](../work/ak-0024.md) |
| ak-0025 | Adopt the Make and isolated container check interface       | [ak-0025.md](../work/ak-0025.md) |
| ak-0026 | Run Make and CI checks in stock images                      | [ak-0026.md](../work/ak-0026.md) |
| ak-0027 | Remove internal source fingerprint checks                   | [ak-0027.md](../work/ak-0027.md) |
| ak-0029 | Prune redundant test cases                                  | [ak-0029.md](../work/ak-0029.md) |
| ak-0034 | Add canonical build entry points                            | [ak-0034.md](../work/ak-0034.md) |
| ak-0035 | Remove the flat import aliases                              | [ak-0035.md](../work/ak-0035.md) |
| ak-0041 | Adopt the design and work file convention                   | [ak-0041.md](../work/ak-0041.md) |
| ak-0042 | Record every user request as a work file                    | [ak-0042.md](../work/ak-0042.md) |
