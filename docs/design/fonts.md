# Fonts

`fonts` is the only Skia module: `rasteriseGlyphs` draws each glyph alone through CPU Skia (optional
exact peer `skia-canvas@4.0.0`), rejects characters the font's cmap does not map and returns the
glyphs and metrics that `glyphAtlas` packs into a BMFont atlas and XML in the padded or packed
layout. `bitmapFont` reads that XML, measures text and composes tinted glyphs without Skia or I/O.
`woff2` encodes complete static or variable TrueType fonts through `wawoff2@2.0.1`, and
`subsetWoff2` keeps only the code points of given strings through `harfbuzzjs@1.6.4`, fails on
uncovered characters and can rename the subset for a Reserved Font Name. Font files, licences, glyph
policy and browser readiness stay with the games.

Reference: [Fonts](../api-reference.md#fonts), [Bitmap text](../api-reference.md#bitmap-text), [WOFF2 fonts](../api-reference.md#woff2-fonts), [implementation notes](../implementation-comparison.md).

## Work items

| ID      | Title                                                      | Link                             |
| ------- | ---------------------------------------------------------- | -------------------------------- |
| ak-0008 | Add a packed glyph atlas layout                            | [ak-0008.md](../work/ak-0008.md) |
| ak-0014 | Remove strict font coverage, kerningPairs and maxHeight    | [ak-0014.md](../work/ak-0014.md) |
| ak-0016 | Replace buildBitmapFont with rasteriseGlyphs               | [ak-0016.md](../work/ak-0016.md) |
| ak-0020 | Add fontCoverage and reject characters a font does not map | [ak-0020.md](../work/ak-0020.md) |
| ak-0030 | Add canvas-free bitmap font reading and text composition   | [ak-0030.md](../work/ak-0030.md) |
| ak-0032 | Add WOFF2 encoding for complete static TrueType fonts      | [ak-0032.md](../work/ak-0032.md) |
| ak-0036 | Encode full variable TrueType fonts to WOFF2               | [ak-0036.md](../work/ak-0036.md) |
| ak-0037 | Subset fonts to their strings with subsetWoff2             | [ak-0037.md](../work/ak-0037.md) |
| ak-0039 | Rename subset fonts with subsetWoff2 names                 | [ak-0039.md](../work/ak-0039.md) |
