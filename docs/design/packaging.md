# Packaging

Art-kit ships an ESM package with declarations and explicit build subpaths. Source checks use
container-backed Make targets. Release packaging uses committed source and produces a GitHub
release tarball.

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
| ak-0045 | Cap Art-kit containers at 4 GiB                             | [ak-0045.md](../work/ak-0045.md) |
| ak-0046 | Harden Art-kit build tooling and asset output validation    | [ak-0046.md](../work/ak-0046.md) |
| ak-0047 | Simplify PNG filtering and package tooling                  | [ak-0047.md](../work/ak-0047.md) |
| ak-0050 | Standardize Art-kit checks on Make                          | [ak-0050.md](../work/ak-0050.md) |
