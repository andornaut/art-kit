# Build

`build` runs a game's art build sets one at a time in dependency order and uses only Node built-ins.
`buildCommand` handles `[--check] [SET...]` and `--help`, and `nodeBuild` runs a set in its own Node
process. Opt-in self-checks reconcile the declared order and a modules directory with the set table.
The `--check` flag compares a snapshot of the check paths before and after the rebuild.
With `outputs: true`, the check also fails on any file under the check paths that no set's
`outputs` or `check.static` claims. The check never deletes files.

Reference: [Builds](../../README.md#builds).

## Work items

| ID      | Title                                                            | Link                             |
| ------- | ---------------------------------------------------------------- | -------------------------------- |
| ak-0017 | Add the build subpath with a byte-snapshot check                 | [ak-0017.md](../work/ak-0017.md) |
| ak-0021 | Add build self-checks, nodeBuild, --help and an index check mode | [ak-0021.md](../work/ak-0021.md) |
| ak-0038 | Declare build outputs and fail on unclaimed files                | [ak-0038.md](../work/ak-0038.md) |
| ak-0049 | Remove Git-index checks from art builds                          | [ak-0049.md](../work/ak-0049.md) |
