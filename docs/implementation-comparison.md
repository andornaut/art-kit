# Generation implementation

`fonts` is the only module that renders with a CPU Skia canvas; `grid`, `raster`, `draw`, `glyphAtlas` and the codecs are canvas-free paths with exact RGBA arithmetic. Pillow 13.0.0 is the parity reference for the frozen `raster`, `draw`, GIF and ICO fixtures.

## Maintained code and API

| Area              | TypeScript source lines |
| ----------------- | ----------------------: |
| Colour            |                     115 |
| Grid              |                     223 |
| Fonts and packing |                     294 |
| Total             |                     632 |

These are physical lines including types, comments and whitespace, excluding tests, `raster`, the atlas/codec modules and packaging. The fonts total includes rasterization (160) and supplied-glyph assembly (134). The numbers are not a complexity score. Glyph rasterization has no custom alpha arithmetic or Pillow-specific rounding. TypeScript owns typed options, input validation, packing and XML.

Frames resolve to `RgbaImage` buffers (`raster.frameToRgba`), and sheets and contact sheets compose in memory (`raster.composeSheet`, `raster.composeContactSheet`), so composition copies exact bytes and is not limited by a canvas. `fonts.rasteriseGlyphs` returns trimmed glyph images, metrics and kernings; `glyphAtlas.buildBitmapFontFromGlyphs` packs them and writes the BMFont XML. Callers own glyph policy between the two calls.

## Font output

The bounded comparison uses Liberation Sans Regular/Bold at native 12, 16 and 24 px on light/dark backgrounds, including shaped text and separate glyph strips. Pillow, node-canvas and hinted Skia are visually credible. Hinted Skia looks firmer at 12 px; the renderers are close at 16 px. Unhinted Skia looks softer there. Binary node-canvas glyphs are less even in the small-text sample. These are visual assessments, not objective readability scores or a universal font ranking.

Each glyph is drawn alone with a clear margin and trimmed to the pixels Skia covers, so antialiased edges outside its measured bounds are kept. Native tests cover bearings, spaces, trimming, AA/binary policy and kerning, and the frozen font fixtures pin both games' packing pipelines byte for byte. Whole-text engine shaping is not equivalent to a code-point bitmap atlas; rasterization disables cross-glyph substitutions. Kerning is off by default; opt-in all-pair evaluation covers at most 256 unique characters and emits nonzero integer adjustments.

Skia defaults to CPU rendering, hinting and grayscale antialiasing, with synthesis disabled. Its metrics and rounding define the output, not Pillow compatibility. Missing characters may use system fallback. The supplied-glyph API copies caller-owned straight-alpha RGBA bytes with signed placement and advance metrics. Files remain immutable after registration. Other fonts, scripts, browser/device scaling and game layouts are outside this fixture.

## Dependencies and compatibility

Skia Canvas 4.0.0 is an exact optional peer for `fonts`. No other subpath needs it. Skia is a native rendering library. Test fonts retain SIL OFL and are excluded from release artifacts; helper code remains MIT and consumer licences are unchanged.

## Verification

The isolated local gate passes every Node test with zero skips, plus declarations, installed-package imports and the build. It requires native licensed-font rendering; its smoke checks import every other subpath without the optional Skia peer. Checks validate library mechanisms, not every consumer asset. Exact release-commit CI and installed/public release payloads remain mandatory publication gates.
