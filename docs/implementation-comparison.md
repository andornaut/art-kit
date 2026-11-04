# Generation implementation

The `frames` and `fonts` generation modules render with CPU Skia canvases; `raster`, `draw` and the codecs are the canvas-free paths with exact RGBA arithmetic. Since 0.14.0 the package is TypeScript only. The Python and Pillow implementation that preceded the Skia generation API remains in tags up to v0.13.0, and Pillow 13.0.0 remains the parity reference for the frozen fixtures.

## Maintained code and API

| Area | TypeScript source lines |
| --- | ---: |
| Colour | 123 |
| Grid | 185 |
| Frames and composition | 183 |
| Fonts, packing and coverage | 419 |
| Aseprite | 109 |
| Total | 1019 |

These are physical lines including types, comments and whitespace, excluding tests, the atlas/codec modules and packaging. The fonts total includes rasterization (253), strict coverage (42) and supplied-glyph assembly (124). The consolidated generation entry and one-call font export add another 124 lines. The numbers are not a complexity score. The rendering path has no custom alpha arithmetic, manually scaled pixel writes, intermediate glyph RGBA buffers or Pillow-specific rounding. TypeScript owns typed options, input/bounds validation, packing and XML. Font construction adds native pair-kerning derivation and structured metadata.

Generation exposes renderFrame, composeSheet and renderContactSheet returning CPU Canvas objects. Keep those surfaces through composition and encode at the boundary. buildBitmapFont is one font-and-atlas operation in place of separate rasterize, pack and XML calls. Exact-copy buffer utilities and codecs remain separate. This reduces caller assembly and renderer-specific buffer handling.

## Font output

The bounded comparison uses Liberation Sans Regular/Bold at native 12, 16 and 24 px on light/dark backgrounds, including shaped text and separate glyph strips. Pillow, node-canvas and hinted Skia are visually credible. Hinted Skia looks firmer at 12 px; the renderers are close at 16 px. Unhinted Skia looks softer there. Binary node-canvas glyphs are less even in the small-text sample. These are visual assessments, not objective readability scores or a universal font ranking.

The builder was separately checked by reconstructing regular/bold text from its actual atlas rectangles, offsets and advances at 16 px. The inspected samples are readable without visible clipping. Native tests cover bearings, spaces, atlas containment, AA/binary policy, kerning, bounds and XML. Whole-text engine shaping is not equivalent to a code-point bitmap atlas; the builder disables cross-glyph substitutions. It derives requested kerning pairs by default; opt-in all-pair evaluation covers at most 256 unique characters and emits nonzero integer adjustments.

Skia defaults to CPU rendering, hinting and grayscale antialiasing, with synthesis disabled. Its metrics and rounding define the output, not Pillow compatibility. Missing characters may use system fallback. Opt-in strict coverage uses fontkit cmap preflight to reject absent code points in a single-face font file; it does not disable renderer fallback. Face labels, baseline and line height can be explicit. The supplied-glyph API bypasses rasterization and copies caller-owned straight-alpha RGBA bytes with signed placement and advance metrics. Files remain immutable after registration. Other fonts, scripts, browser/device scaling and game layouts are outside this fixture.

## Dependencies and compatibility

Skia Canvas 4.0.0 is an exact optional peer for generation modules. Strict coverage additionally needs optional fontkit 2.0.4; default rendering does not. Codec-only and standalone supplied-glyph atlas clients need neither peer. Skia is a native rendering library. Test fonts retain SIL OFL and are excluded from release artifacts; helper code remains MIT and consumer licences are unchanged.

## Verification

The isolated local gate passes 98 Node tests with zero skips, plus declarations, installed-package imports and the build. It requires native licensed-font rendering; its codec-only smoke checks omit both optional Skia and fontkit peers. Checks validate library mechanisms, not every consumer asset. Exact release-commit CI and installed/public release payloads remain mandatory publication gates.
