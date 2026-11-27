# Design

Each area page describes its design and lists its work items. The [documentation index](../README.md)
links to the public reference and guides. The [work index](../work/README.md) explains how to read
and maintain work items.

## Areas

| Area                              | Covers                                                                                                   | Topic docs                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [raster](raster.md)               | Frames, `grid`, `rgbaImage`, `raster`, `draw`, `colour` and image comparison                             | [frames and images](../api-reference.md#pixel-frames-and-images), [comparison](../api-reference.md#development-image-comparison), [raster and colour proposal](../shared-raster-colour-proposal.md) |
| [fonts](fonts.md)                 | `fonts`, `bitmapFont`, `glyphAtlas` and `woff2`, including `subsetWoff2` and renaming                    | [fonts](../api-reference.md#fonts), [bitmap text](../api-reference.md#bitmap-text), [WOFF2](../api-reference.md#woff2-fonts), [notes](../implementation-comparison.md)                              |
| [sprite-sheets](sprite-sheets.md) | `spriteSheet`, `atlasLayout`, `atlasBuild` and the `gif`, `ico`, `png`, `indexedPng` and `webp` encoders | [encoders and atlases](../api-reference.md#encoders-and-atlases)                                                                                                                                    |
| [build](build.md)                 | The build runner, its self-checks and check modes, and declared outputs                                  | [builds](../builds-and-checks.md#builds)                                                                                                                                                            |
| [packaging](packaging.md)         | Package exports, peers, stock container checks, CI and releases                                          | [boundaries](../api-reference.md#boundaries), [checks](../builds-and-checks.md#runtime-and-checks), [API entry points](../api-entry-points.md)                                                      |
