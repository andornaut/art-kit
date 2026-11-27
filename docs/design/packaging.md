# Packaging

Art-kit ships an ESM package with declarations and explicit build subpaths. Source checks use
container-backed Make targets. Release packaging uses committed source and produces a GitHub
release tarball.

Reference: [Boundaries](../reference/api-reference.md#boundaries), [Runtime and checks](../guides/development-checks.md#runtime-and-checks), [Version and licence](../reference/package.md#version-and-licence), [Released dependency](../guides/installation-and-releases.md#released-dependency), [API entry points](../reference/api-entry-points.md),
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
| ak-0051 | Correct the Art-kit documentation                           | [ak-0051.md](../work/ak-0051.md) |
| ak-0052 | Refactor the Art-kit source structure                       | [ak-0052.md](../work/ak-0052.md) |
| ak-0053 | Apply the approved Art-kit interface proposals              | [ak-0053.md](../work/ak-0053.md) |
| ak-0054 | Finish the error wording and release Art-kit 0.34.0         | [ak-0054.md](../work/ak-0054.md) |
| ak-0055 | Adopt the shared source-structure policy                    | [ak-0055.md](../work/ak-0055.md) |
| ak-0056 | Reject inline type-only imports that load a module          | [ak-0056.md](../work/ak-0056.md) |
| ak-0057 | Apply the straightforward Art-kit review fixes              | [ak-0057.md](../work/ak-0057.md) |
| ak-0060 | Align Art-kit docs with current source                      | [ak-0060.md](../work/ak-0060.md) |
| ak-0061 | Add Art-kit Dependabot coverage                             | [ak-0061.md](../work/ak-0061.md) |
| ak-0063 | Add Dependabot coverage for Markdown lint tooling           | [ak-0063.md](../work/ak-0063.md) |
| ak-0064 | Group cohesive Art-kit internals                            | [ak-0064.md](../work/ak-0064.md) |
| ak-0065 | Organize Art-kit documentation for navigation               | [ak-0065.md](../work/ak-0065.md) |
| ak-0066 | Group Art-kit documentation by purpose                      | [ak-0066.md](../work/ak-0066.md) |
