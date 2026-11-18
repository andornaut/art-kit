# Design

Each area has a short design summary and an index of its work items. The README and the topic docs
in [docs/](..) remain the detailed reference. Work items and their convention are in
[docs/work/](../work/README.md).

| Area                              | Covers                                                                                                   | Topic docs                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [raster](raster.md)               | Frames, `grid`, `rgbaImage`, `raster`, `draw`, `colour` and image comparison                             | [frames and images](../../README.md#pixel-frames-and-images), [comparison](../../README.md#development-image-comparison), [raster and colour proposal](../shared-raster-colour-proposal.md) |
| [fonts](fonts.md)                 | `fonts`, `bitmapFont`, `glyphAtlas` and `woff2`, including `subsetWoff2` and renaming                    | [fonts](../../README.md#fonts), [bitmap text](../../README.md#bitmap-text), [WOFF2](../../README.md#woff2-fonts), [notes](../implementation-comparison.md)                                  |
| [sprite-sheets](sprite-sheets.md) | `spriteSheet`, `atlasLayout`, `atlasBuild` and the `gif`, `ico`, `png`, `indexedPng` and `webp` encoders | [encoders and atlases](../../README.md#encoders-and-atlases)                                                                                                                                |
| [build](build.md)                 | The build runner, its self-checks and check modes, and declared outputs                                  | [builds](../../README.md#builds)                                                                                                                                                            |
| [packaging](packaging.md)         | Package exports, peers, stock container checks, CI and releases                                          | [boundaries](../../README.md#boundaries), [checks](../../README.md#runtime-and-checks), [API entry points](../api-entry-points.md)                                                          |
