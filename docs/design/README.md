# Design

Each area page describes its design and lists its work items. The [documentation index](../README.md)
links to the public reference and guides. The [work index](../work/README.md) explains how to read
and maintain work items.

## Areas

| Area                              | Covers                                                                                                   | Topic docs                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [raster](raster.md)               | Frames, `grid`, `rgbaImage`, `raster`, `draw`, `colour` and image comparison                             | [frames and images](../reference/api-reference.md#pixel-frames-and-images), [comparison](../reference/api-reference.md#development-image-comparison), [raster and colour proposal](history/shared-raster-colour-proposal.md) |
| [fonts](fonts.md)                 | `fonts`, `bitmapFont`, `glyphAtlas` and `woff2`, including `subsetWoff2` and renaming                    | [fonts](../reference/api-reference.md#fonts), [bitmap text](../reference/api-reference.md#bitmap-text), [WOFF2](../reference/api-reference.md#woff2-fonts), [notes](implementation-comparison.md)                            |
| [sprite-sheets](sprite-sheets.md) | `spriteSheet`, `atlasLayout`, `atlasBuild` and the `gif`, `ico`, `png`, `indexedPng` and `webp` encoders | [encoders and atlases](../reference/api-reference.md#encoders-and-atlases)                                                                                                                                                   |
| [build](build.md)                 | The build runner, its self-checks and check modes, and declared outputs                                  | [builds](../reference/build-runner.md#builds)                                                                                                                                                                                |
| [packaging](packaging.md)         | Package exports, peers, stock container checks, CI and releases                                          | [boundaries](../reference/api-reference.md#boundaries), [checks](../guides/development-checks.md#runtime-and-checks), [API entry points](../reference/api-entry-points.md)                                                   |

## Historical design records

- [Consumer API recommendations](history/consumer-api-recommendations.md) records the Art-owner
  consultation before the numerical and bitmap-font APIs shipped.
- [Shared raster and colour API proposal](history/shared-raster-colour-proposal.md) records the
  approved design that shipped in v0.23.0.
