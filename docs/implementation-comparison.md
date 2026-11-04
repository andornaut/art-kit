# Python and Skia TypeScript implementations

Both implementations remain available. Prefer the Skia TypeScript generation API when a cohesive Node-native workflow is the priority and its rendering is acceptable. Retain Python/Pillow for existing generators whose smaller implementation or established output matters. Neither language has a demonstrated universal font-quality advantage. Adoption and Python retirement are separate decisions.

## Maintained code and API

| Area | Python source lines | TypeScript source lines |
| --- | ---: | ---: |
| Colour | 109 | 123 |
| Grid | 113 | 185 |
| Frames and composition | 71 | 183 |
| Fonts, packing and coverage | 109 | 384 |
| Aseprite | 105 | 109 |
| Total | 507 | 984 |

These are physical lines including types, comments and whitespace, excluding tests, existing Node atlas/codecs and packaging. The TypeScript fonts total includes rasterization (253), strict coverage (42) and supplied-glyph assembly (89); the Python font module includes rasterization, packing and XML. The consolidated generation entry and one-call font export add another 114 lines outside this primitive comparison. Formatting differs; the numbers are not a complexity score. The redesign does not establish a smaller source implementation. It removes custom alpha arithmetic, manually scaled pixel writes, intermediate glyph RGBA buffers and Pillow-specific rounding from the rendering path. TypeScript still owns typed options, input/bounds validation, packing and XML. Font construction adds native pair-kerning derivation and structured metadata.

Generation exposes renderFrame, composeSheet and renderContactSheet returning CPU Canvas objects. Keep those surfaces through composition and encode at the boundary. buildBitmapFont replaces separate rasterize/pack/XML calls with one font-and-atlas operation. Existing exact-copy buffer utilities and codecs remain separate and unchanged. This reduces caller assembly and renderer-specific buffer handling, rather than the total source-line count.

## Font output

The bounded comparison uses Liberation Sans Regular/Bold at native 12, 16 and 24 px on light/dark backgrounds, including shaped text and separate glyph strips. Pillow, node-canvas and hinted Skia are visually credible. Hinted Skia looks firmer at 12 px; the renderers are close at 16 px. Unhinted Skia looks softer there. Binary node-canvas glyphs are less even in the small-text sample. These are visual assessments, not objective readability scores or a universal font ranking.

The new builder was separately checked by reconstructing regular/bold text from its actual atlas rectangles, offsets and advances at 16 px. The inspected samples are readable without visible clipping. Native tests cover bearings, spaces, atlas containment, AA/binary policy, kerning, bounds and XML. Whole-text engine shaping is not equivalent to a code-point bitmap atlas; the builder disables cross-glyph substitutions. It derives requested kerning pairs by default; opt-in all-pair evaluation covers at most 256 unique characters and emits nonzero integer adjustments.

Skia defaults to CPU rendering, hinting and grayscale antialiasing, with synthesis disabled. Its metrics and rounding define the output, not Pillow compatibility. Missing characters may use system fallback. Opt-in strict coverage uses fontkit cmap preflight to reject absent code points in a single-face font file; it does not disable renderer fallback. Face labels, baseline and line height can be explicit. The supplied-glyph API bypasses rasterization and copies caller-owned straight-alpha RGBA bytes with signed placement and advance metrics. Files remain immutable after registration. Other fonts, scripts, browser/device scaling and game layouts are outside this fixture.

## Dependencies and compatibility

Skia Canvas 4.0.0 is an exact optional peer for generation modules. Strict coverage additionally needs optional fontkit 2.0.4; default rendering does not. Codec-only and standalone supplied-glyph atlas clients need neither peer. Both implementations still use native rendering libraries; TypeScript cohesion does not eliminate that dependency. Test fonts retain SIL OFL and are excluded from release artifacts; helper code remains MIT and consumer licences are unchanged.

Version 0.8 deliberately replaces the 0.7 TypeScript generation interfaces and Canvas peer. Python APIs, generic colour spaces and existing Node atlas/RGBA/codec contracts are unchanged. No consumer migration follows automatically.

## Verification

The isolated local gates pass 19 Python and 93 Node tests with zero skips, plus lint, declarations, installed-package imports and builds. The Node gate requires native licensed-font rendering; its codec-only smoke checks omit both optional Skia and fontkit peers. Checks validate library mechanisms, not every consumer asset. Exact release-commit CI and installed/public release payloads remain mandatory publication gates.
