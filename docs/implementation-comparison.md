# Implementation notes

## Rendering split

`fonts` is the only module that renders with a CPU Skia canvas. `grid`, `raster`, `draw`, `glyphAtlas` and the codecs work on `RgbaImage` buffers with exact integer arithmetic, so composition copies exact bytes and is not limited by a canvas. Pillow 13.0.0 is the parity reference for the frozen `raster`, `draw`, GIF and ICO fixtures.

Fonts take two calls: `fonts.rasteriseGlyphs` returns trimmed glyph images, metrics and kernings, and `glyphAtlas.buildBitmapFontFromGlyphs` packs them into the atlas and writes the BMFont XML. Callers own glyph policy between the two calls, such as recolouring, metric adjustments and the line box. Glyph rasterization has no custom alpha arithmetic or Pillow-specific rounding.

## Font output

The bounded comparison uses Liberation Sans Regular and Bold at native 12, 16 and 24 px on light and dark backgrounds, including shaped text and separate glyph strips. Pillow, node-canvas and hinted Skia are visually credible. Hinted Skia looks firmer at 12 px; the renderers are close at 16 px, where unhinted Skia looks softer. Binary node-canvas glyphs are less even in the small-text sample. These are visual assessments, not readability scores or a font ranking.

Each glyph is drawn alone with a clear margin and trimmed to the pixels Skia covers, so antialiased edges outside its measured bounds are kept. Whole-text shaping is not equivalent to a code-point bitmap atlas, so rasterization disables cross-glyph substitutions. Skia defaults to CPU rendering, hinting and grayscale antialiasing with synthesis disabled; its metrics and rounding define the output, not Pillow compatibility. Other fonts, scripts, browser or device scaling and game layouts are outside the comparison.
