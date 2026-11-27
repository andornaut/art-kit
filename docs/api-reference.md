# API reference

## Boundaries

The package ships TypeScript declarations and explicit leaf subpaths. Canonical art-kit APIs live under `build/*`: their supported purpose is asset development, including diagnostics used by tests. This category describes intended use, not platform portability. Current consumers need no in-game runtime or reusable testing API, so `runtime/*` and `test/*` are absent. Private fixtures and harnesses are not published. Import each explicitly, for example `@andornaut/art-kit/build/raster`.

| Subpath       | Owns                                                                                                                                      | Client supplies                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `atlasBuild`  | Atlas page drawing and encoded page assembly                                                                                              | Read, decode and encode functions, blits, extrusion and metadata         |
| `atlasLayout` | Shelf packing and candidate selection                                                                                                     | Items, order comparator, candidate widths and size limits                |
| `build`       | Sequential game art builds in dependency order, set table self-checks, snapshot and output ownership checks, Node process steps and a CLI | Named build steps, their needs, the module directory and the check paths |
| `colour`      | Six-digit hex RGB, WCAG contrast, sRGB to/from Oklab and OKLCH                                                                            | Resolved hex colours and colour triples                                  |
| `draw`        | Pillow 13.0.0-exact shape drawing into RGBA buffers                                                                                       | Colours, points, bounds, widths and the target image                     |
| `fonts`       | Skia glyph rasterization, font coverage, line metrics and pair kerning                                                                    | Font path, size, characters, antialiasing, hinting and kerning           |
| `gif`         | Animated GIF encoding with exact palettes and binary alpha                                                                                | Frames, durations and loop                                               |
| `bitmapFont`  | Single-page BMFont XML reading, text measurement and tinted RGBA composition without Skia                                                 | XML, decoded atlas, text, missing-glyph/spacing policy, tint and target  |
| `glyphAtlas`  | BMFont atlas packing and XML for supplied RGBA glyphs                                                                                     | Glyph images, offsets, advances and font metrics                         |
| `grid`        | Pixel-frame drawing, outlines, opaque extents and mirroring                                                                               | Palette, colour names and edge colour rule                               |
| `ico`         | ICO encoding with PNG entries                                                                                                             | One pre-sized RGBA image per entry                                       |
| `indexedPng`  | Indexed PNG encoding                                                                                                                      | RGBA image and compression options                                       |
| `png`         | PNG decoding to RGBA, and RGBA and opaque RGB PNG encoding                                                                                | Encoded bytes, or an RGBA image and compression options                  |
| `raster`      | RGBA operations, Float32 smooth filters, frame rendering, sheets and contact sheets                                                       | Images, planes, colours, frames, colour resolver and geometry            |
| `rgbaImage`   | RGBA allocation, alpha bounds and extruded blitting                                                                                       | Image dimensions, pixels, rectangles and bounds                          |
| `spriteSheet` | Sprite sheet PNG with Aseprite 1.2.30 decoded pixels and exact json-hash text                                                             | Key, image name, tags, optional columns and slice margins, paths         |
| `webp`        | Lossless and lossy WebP encoding, and decoding                                                                                            | RGBA images                                                              |
| `woff2`       | WOFF2 encoding and optional text-driven subsetting                                                                                        | TrueType bytes, strings and optional font names                          |
| `compareRgba` | Raw and composited RGBA comparisons for asset development                                                                                 | Decoded images and comparison backgrounds                                |

Geometry and image types are local structural types; the package has no `game-kit` dependency. Clients own palettes and ramps, sprite definitions, font files and glyph policy, camera and depth geometry, manifests, tile sizes, frame tags, grouping, ordering, paths, filenames and Vite asset emission. No module imports a game or discovers its repository from the working directory. Options and context come before the subject. Validation errors read `<subject> must <constraint>`, such as `Columns must be a positive safe integer`, naming the argument, option or input; an identifying key, such as a frame index, font label, set name or cycle path, may lead the subject, and ranges are inclusive `min..max`. libwebp and HarfBuzz failures throw `Error` naming the engine. The `build` runner keeps its command-line and process messages: `unknown option <option>`, `--check needs check paths`, `check.index has been removed`, `exit <status>`, `signal <name>`, `<set> build failed: <cause>` and the `CheckError` summary. Only `fonts` needs Skia; every other subpath is canvas-free. Numerical transforms use the rounding and intermediate precision specified below.

See [API entry points](api-entry-points.md) for import dependencies, the shared kit namespace rules and the v0.28 migration map.

## Pixel frames and images

A `Frame` is rows of hex colours (opaque) or `null` (clear). An `RgbaImage` is `{ data, width, height }` with straight (non-premultiplied) RGBA bytes; an opaque (RGB) image has alpha 255. `rgbaImage` also exports the `Point` (`{ x, y }`) and `Rect` (`{ x, y, width, height }`) types its functions take. A `Tag` is `[name, frames, milliseconds]`, with one duration for every frame or one each.

```ts
import { Grid } from "@andornaut/art-kit/build/grid";
import { frameToRgba } from "@andornaut/art-kit/build/raster";

const grid = new Grid({ fill: "ffffff" }, 16, 16, { edge: () => "000000" });
grid.ell(8, 8, 4, 4, "fill");
const image = frameToRgba(grid.palette, grid.outlined());
```

| Export                                                                  | Contract                                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grid.Grid`                                                             | Draws palette names or hex colours into `px`; `outlined()` adds an edge-rule outline. `px`, `w`, `h`, `edge` and `close` are mutable; subclassable                      |
| `grid.opaqueRows(frames)`, `opaqueCols(frames)`                         | First and last rows or columns holding colour across the frames, or `null` when all are clear                                                                           |
| `grid.flipped(frame)`                                                   | The frame mirrored left to right                                                                                                                                        |
| `raster.frameToRgba(context, frame)`                                    | Resolves through a palette (unlisted names are hex) or a `resolveRgb` callback; `null` is (0,0,0,0)                                                                     |
| `raster.composeSheet({ columns, cellWidth, cellHeight }, images)`       | Row-order cells, RGBA copied exactly and clipped to each cell; unused cells are clear                                                                                   |
| `raster.composeContactSheet(options, sprites, grounds)`                 | Opaque preview, one row per sprite and ground; `cellSize` is `"largest-frame"` or `"row-first-frame"`                                                                   |
| `raster.fill`, `paste`, `composite`                                     | Mutate the target: replace or coverage-blend a rect through an optional plane, replace or blend a source by its own alpha (`mask: "alpha"`), straight-alpha source-over |
| `raster.filledImage`, `crop`, `resizeNearest`, `rotateNearest`          | New images; crop zero-fills outside the source, resampling copies RGBA exactly including RGB under clear alpha                                                          |
| `raster.resizeLanczos3(width, height, source)`                          | New image; positive safe-integer source/output dimensions; premultiplied encoded RGB, clipped normalized Lanczos-3 support and Float32 passes                           |
| `raster.gaussianBlur({ sigma }, source)`                                | New full-image straight-RGBA blur; finite positive sigma, repeated edges, Float32 passes; empty images stay empty                                                       |
| `raster.opaque`, `grayscale`, `channel`                                 | Alpha set to 255, ITU-R 601-2 luma plane, one channel plane                                                                                                             |
| `draw.point`, `line`, `polygon`, `ellipse`, `rectangle`, `arc`          | Pillow `ImageDraw.Draw(image)` output byte for byte, ink written without blending. `Bounds` corners are inclusive; arcs run clockwise from three o'clock                |
| `rgbaImage.blankImage(width, height)`                                   | A clear image                                                                                                                                                           |
| `rgbaImage.opaqueRect(within, image)`                                   | Alpha bounds inside `within`, or `undefined` when clear                                                                                                                 |
| `rgbaImage.blitExtruded({ from, extrude, at, bounds }, source, target)` | Copies `from` to `at` with `extrude` pixels of border repeating the edges of `bounds` (default `from`)                                                                  |
| `colour.rgb(hex)`                                                       | Bytes of exactly six hex digits without `#`; any other string throws                                                                                                    |
| `colour.contrast`, `srgbToOklab`, `srgbToOklch`, `oklchToSrgb`          | WCAG contrast ratio and colour-space conversion; `oklchToSrgb` reduces chroma at fixed lightness and hue to reach the gamut                                             |

`paste` and `composite` read the original source bytes when the source and target byte ranges overlap.

Drawing throws `RangeError` before changing the image if any bounds coordinate or stroke width is nonfinite. The Pillow fixtures in `node/tests/fixtures` cover the raster and drawing operations, including partial alpha. Separate frozen synthetic references cover the smooth filters and inverse Oklab.

`resizeLanczos3` filters horizontally then vertically after premultiplying encoded RGB into Float32. It clips and renormalizes support at image edges, clamps alpha, and uses the unrounded alpha to unpremultiply before byte rounding. It preserves nonzero RGB when a positive alpha rounds to zero; same-size filtering does not copy hidden RGB under originally clear pixels. Use `resizeNearest` for exact RGBA sampling and binary-alpha masks.

`gaussianBlur` filters straight channels independently with support `ceil(3*sigma)` and normalized Gaussian weights, horizontally then vertically. It repeats image edges, stores intermediate Float32 values and rounds final bytes. Kernel size is limited by array allocation and available memory. Bounds expansion, integer cropping and raw replacement remain caller-owned; do not replace an expanded region through alpha compositing when clear RGB must overwrite. Zero sigma throws instead of defining a legacy invalid-domain result.

`colour.oklabToSrgb({ gamut, rounding }, lab)` requires finite Oklab channels and finite conversion results. `gamut: "clip"` clamps linear channels before sRGB transfer; `"reject"` throws for any out-of-range channel with no tolerance or chroma reduction. `rounding: "half-even"` rounds exact byte half-ties to even; `"half-up"` uses `floor(encoded*255 + 0.5)`. Both policies are required. Existing `oklchToSrgb` retains its chroma-reduction behavior. No operation changes its source.

Decoded RGBA equality includes RGB under zero alpha. Encoded PNG equality additionally requires matching encoder settings and dependency pins; SVG and metadata text need separate comparisons.

## Encoders and atlases

| Export                                                                    | Contract                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `png.decodePng(bytes)`                                                    | RGBA image                                                                                                                                                                 |
| `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` | The bytes pngjs 7.0.0 `PNG.sync.write` writes, streamed row by row                                                                                                         |
| `png.encodeRgbPng(options, image)`                                        | Colour type 2 bytes, as pngjs writes them; throws when any alpha is not 255                                                                                                |
| `indexedPng.encodeIndexedPng({ level, memLevel }, image)`                 | Indexed PNG bytes, or `undefined` above 256 RGBA colours                                                                                                                   |
| `webp.encodeLosslessWebp(image)`                                          | Lossless WebP through the non-SIMD WASM codec of `@jsquash/webp`                                                                                                           |
| `webp.encodeLossyWebp({ quality, method, alphaQuality, exact }, image)`   | Lossy non-SIMD WebP using explicit validated settings; alphaQuality 100 preserves the alpha plane                                                                          |
| `webp.decodeWebp(bytes)`                                                  | The RGBA image the WebP bytes decode to, through the same non-SIMD codec, so producers can check encoded output; repeated decodes are identical, bad input throws          |
| `gif.encodeGif({ durations, loop }, frames)`                              | Animated GIF with unspecified disposal; durations stored in hundredths, truncated                                                                                          |
| `ico.encodeIco(images)`                                                   | ICO with one PNG entry per image                                                                                                                                           |
| `spriteSheet.spriteSheet({ key, image, columns, margins }, tags)`         | `{ sheet, data }`: shared PNG encoding of Aseprite 1.2.30's RGBA pixels and byte-identical json-hash text                                                                  |
| `spriteSheet.writeSpriteSheet({ sheet, data }, options, tags)`            | Writes both files, creating directories, with the sheet's file name as `meta.image`                                                                                        |
| `atlasLayout.packAtlas(policy, items)`                                    | Items sorted by `compare` and shelf-packed at each candidate width, each item on one page; the candidate with fewest pages, then least area, or `undefined` when none fits |
| `padding` (default 0)                                                     | Transparent pixels between neighbouring cells on a shelf and between shelves, outside `extrude`, never at page edges; a non-negative safe integer, else `RangeError`       |
| `atlasBuild.drawAtlasPage(extrude, images, page)`                         | One page of extruded blits                                                                                                                                                 |
| `atlasBuild.buildAtlasPages(dependencies, pages)`                         | Reads, decodes, draws and encodes each page with the supplied functions                                                                                                    |

`encodeLossyWebp` requires all four settings: finite `quality` in 0..100, integer `method` in 0..6, integer `alphaQuality` in 0..100 and boolean `exact`. It uses the same pinned encoder as the unchanged lossless function, with lossy mode forced and remaining settings fixed to the pinned defaults. Use `alphaQuality: 100` when alpha coverage must remain exact; lower values explicitly permit alpha loss. RGB is lossy, including under clear alpha: `exact` forwards the codec transparency flag and does not promise RGBA byte equality. Compare decoded alpha and appearance independently; codec choice or quality alone does not establish a byte budget or visual acceptance.

Callers choose indexed-first fallback, PNG versus WebP and output metadata. The sprite sheet tests compare every decoded RGBA byte and the exact JSON text with frozen Aseprite exports in `node/tests/fixtures/sprite-sheet`. The PNG encoding can differ from Aseprite's.

## Development image comparison

Import `compareRgba` from `@andornaut/art-kit/build/compareRgba`. Call `compareRgba({ backgrounds }, expected, actual)` with decoded, normalized straight RGBA8 images and an explicit ordered array of opaque RGB backgrounds. An empty array requests raw comparison only. This dependency-free diagnostic performs no decoding, file access, colour-profile normalization or acceptance decision.

Different dimensions return `{ kind: "dimension-mismatch", expected, actual }` without pixel metrics. Equal dimensions return `kind: "compared"`, width and height, plus `raw` equality, differing pixel/channel counts and maximum absolute byte error. Raw metrics include RGB under zero alpha; `raw.alpha` reports alpha-different pixels and maximum alpha error separately.

Each `composites` entry copies its background and reports RGB RMSE and maximum absolute error. For channel `C`, opacity `a` and background `B`, compositing is `(C*a + B*(255-a))/255` in encoded byte levels using unrounded doubles. RMSE divides squared RGB error by three times the pixel count. These are deterministic encoded-channel metrics, not linear-light or perceptual measurements. Inputs remain unchanged; invalid dimensions, buffers or backgrounds throw `RangeError`.

Use this tool during asset generation or compression review. Callers choose decoding policy, backgrounds, thresholds, byte budgets and visual acceptance. It is not a gameplay service, and tests using it do not turn it into a test-only API. Timing and memory measurements are separate from the report.

## Bitmap text

Import the canvas-free reader and compositor from `@andornaut/art-kit/build/bitmapFont`. Font generation remains in `fonts` and `glyphAtlas`; this module reads their XML without loading Skia or accessing files.

`readBitmapFont(xml)` returns the single page name, atlas dimensions, base, line height, glyphs and kerning. It accepts one unpacked RGBA page (page 0, channel 15), including either atlas packing layout emitted by `glyphAtlas`. Multi-page and channel-packed fonts are unsupported. The reader validates counts, code points, metrics and atlas rectangles; it does not resolve page paths or load images.

`measureBitmapText({ font, lineSpacing, missing }, text)` returns separate `lineAdvances`, total line-box `height` and optional `glyphBounds`. Bounds cover declared nonempty glyph rectangles, including any transparent padding; they are not a scan of visible pixels. Positions, advances and kerning preserve signed integer metrics. The origin is the first line box's top-left, not its baseline or ink bounds.

Both text functions require explicit spacing and missing-glyph policy. `lineSpacing` is the integer gap between line boxes; the resulting pitch must be positive. Literal LF separates lines and retains blank and trailing lines. Empty text is one line. There is no wrapping, alignment or newline normalization.

`missing` is `"reject"`, `"skip"`, or `{ fallback: codePoint, absent: "reject" | "skip" }`. Kerning uses the original input code points even when a fallback is drawn. Skipped characters neither advance nor update the previous character; LF resets both. Space and other empty glyphs retain their advances.

`drawBitmapText({ font, lineSpacing, missing, atlas, at, tint }, text, target)` validates and lays out the text before mutating the target. The decoded RGBA atlas must match the XML dimensions and must not share the target's backing buffer. Each glyph keeps its alpha coverage, receives the supplied RGB tint and uses the existing straight-alpha compositor, including clipping and byte rounding. The atlas remains unchanged. Use existing alpha-bound helpers on rendered output when actual visible ink bounds are needed.

Font files, samples, colours, line spacing, fallback selection and PNG encoder settings remain caller-owned. Parsing and measurement perform no I/O; drawing mutates only the target.

## Fonts

`fonts` renders through CPU Skia and needs the optional exact peer `skia-canvas@4.0.0`, so it belongs in Node build scripts, not browser bundles. `rasteriseGlyphs` produces the glyphs and metrics that `glyphAtlas` packs; callers apply glyph policy in between.

| Export                                                                           | Contract                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fonts.rasteriseGlyphs({ path, size, characters, antialias, hinting, kerning })` | `{ ascent, base, descent, glyphs, kernings, lineHeight }`. Each unique character is drawn alone in white and trimmed to the pixels Skia covers (`undefined` without ink). `base` is the ascent rounded up; `lineHeight` the ascent plus descent rounded up |
| `kerning: "all"`                                                                 | Every ordered pair of at most 256 unique characters, nonzero integer adjustments only; the default `"none"` returns none                                                                                                                                   |
| Unmapped characters                                                              | Throw `RangeError` before drawing, naming the font path and every character outside `fontCoverage` as `U+XXXX "c"`                                                                                                                                         |
| `fonts.fontCoverage(path)`                                                       | The code points a TrueType or OpenType file maps to a glyph other than `.notdef`, from its format 12 Unicode cmap subtable, else its format 4 one. Font collections, WOFF and malformed tables throw `RangeError`                                          |
| `glyphAtlas.buildBitmapFontFromGlyphs(options, glyphs)`                          | `{ image, metadata, xml }`: glyphs packed in insertion order with BMFont XML; bytes copied exactly, without blending. Atlas height is limited to 16384 px                                                                                                  |
| `layout: "padded"` (default)                                                     | Insets and spaces glyphs by `padding` (default 1), fits the height to the last row and always writes a kernings element                                                                                                                                    |
| `layout: "packed"`                                                               | Requires `antialias`, rejects `padding`: 1 px spacing from (0, 0), a power-of-two height, every info attribute, and no kernings element when there are none                                                                                                |

Font coverage reads stay within the declared cmap and selected subtable lengths.

Antialiasing and hinting default to true; synthesis and cross-glyph substitutions are disabled. Requiring every character in the file's cmap keeps Skia from substituting a system font. Supply each ordered kerning pair at most once. `glyphAtlas` exports the result type as `GlyphAtlas`. The tests compare valid output byte for byte with frozen references in `node/tests/fixtures/fonts` and `node/tests/fixtures/bmfont-packed.json` and verify that a legacy duplicate pair is rejected.

```ts
import { writeFile } from "node:fs/promises";

import { rasteriseGlyphs } from "@andornaut/art-kit/build/fonts";
import { buildBitmapFontFromGlyphs } from "@andornaut/art-kit/build/glyphAtlas";
import { encodeRgbaPng } from "@andornaut/art-kit/build/png";

const { base, glyphs, kernings, lineHeight } = rasteriseGlyphs({
  characters: " ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  kerning: "all",
  path: "body.ttf",
  size: 16,
});
const font = buildBitmapFontFromGlyphs(
  { atlasWidth: 256, base, face: "Body", kernings, key: "body", lineHeight, size: 16 },
  glyphs,
);
await writeFile(
  "body.png",
  encodeRgbaPng({ deflateLevel: 9, deflateStrategy: 3, filterType: -1 }, font.image),
);
await writeFile("body.fnt", font.xml);
```

[Implementation notes](implementation-comparison.md) cover font output quality and the rendering split.

## WOFF2 fonts

Import `encodeWoff2(font: Uint8Array): Promise<Uint8Array>` from `@andornaut/art-kit/build/woff2`, with the optional exact peer `wawoff2@2.0.1` installed. This canvas-free Node build API encodes a complete static or variable TrueType 1.0 font with `glyf`/`loca` tables. It does not rasterize, replace fonts or expose fidelity settings. The peer is loaded only when encoding; other imports need neither it nor Skia. Input bytes are copied and remain unchanged; concurrent calls are serialized and return independent output bytes.

Signed fonts with a `DSIG` table, CFF outlines, collections and malformed directories are rejected. Variable fonts retain their variation tables and axes; encoding does not select an instance or strip variation data. Codec failures reject the promise without preventing later calls. The pinned WASM codec comes from Google's WOFF2 implementation; its packaged binary dates from 2022. Repeated output is pinned by regression hashes, rather than a promise that different codec versions produce identical bytes.

WOFF2 retains font content but may normalize SFNT serialization, including table offsets and padding, glyph encoding, location/metric representation and the head checksum and lossless-transform flag. Decoded TTF bytes need not equal the original file. Tests decode both full Liberation Sans fixtures and the full variable Tiny5 fixture and compare every glyph's geometry, components and hint instructions, Unicode coverage, advances, kerning, names, licence metadata and all remaining tables outside explicit serialization differences. Tiny5 checks include complete `fvar`, `gvar` and `HVAR` table bytes, preserving axes, named instances and variation metrics. These fixtures match the requested consumer originals. Font licensing remains unchanged; no font payload is included in the package.

### Subsetting

`subsetWoff2({ strings, label?, names? }, font): Promise<Uint8Array>` also needs the optional exact peer `harfbuzzjs@1.6.4`. It keeps only the code points of `strings`, subsets through HarfBuzz hb-subset defaults and encodes the result like `encodeWoff2`. HarfBuzz keeps the glyphs those characters reach through composites and default GSUB features, their GPOS adjustments, hinting, every variation axis and named instance, and name records 0 to 25 (including copyright, licence and licence URL). HarfBuzz drops the legacy `kern` table (and `FFTM`), so kerning survives only where GPOS carries it, as in Liberation Sans. C0 and C1 controls such as newline are ignored.

Before subsetting it throws `RangeError` naming every other character the font's cmap does not map, as `<label> must have a glyph for U+XXXX "c", ...` (`label` defaults to `Font`). Passing every player-visible string therefore fails the build instead of letting the browser fall back to another font. Tests check that a Liberation Sans subset maps exactly the requested characters and renders the same glyph pixels, metrics and kerning as the full font through `rasteriseGlyphs`, and that a Tiny5 subset keeps `fvar`, `gvar`, `HVAR`, its five axes and nine instances. A subset is a modified font: callers check their font licence before shipping one.

`names: { family, fullName, postScriptName, uniqueId, version?, reserved? }` renames the subset, as a SIL OFL Reserved Font Name requires. It replaces name IDs 1 (family), 3 (unique ID), 4 (full name), 6 (PostScript name), 16 (typographic family, when present) and, with `version`, 5 in every Unicode, Windows and Mac Roman record. Copyright, licence and the other records (0, 13, 14 and the rest) stay unchanged, and the file is reassembled with valid table checksums. It throws `RangeError` when a replaced name, the subfamily (2) or the typographic subfamily (17) contains a `reserved` name (case-insensitive), when a name is empty or has control characters, and when the PostScript name is not 1 to 63 printable ASCII characters without spaces or `[](){}<>/%`.

```ts
import { readFile, writeFile } from "node:fs/promises";

import { subsetWoff2 } from "@andornaut/art-kit/build/woff2";

const strings = ["Play", "Settings", "Volume: 80%"]; // every player-visible string
const font = await readFile("art/fonts/LiberationSans-Regular.ttf");
const names = {
  family: "GameUI",
  fullName: "GameUI Regular",
  postScriptName: "GameUI-Regular",
  reserved: ["Liberation"],
  uniqueId: "GameUI Regular 1",
};
await writeFile(
  "public/fonts/body.woff2",
  await subsetWoff2({ label: "Body", names, strings }, font),
);
```

Callers own input font files, output paths, browser `FontFace` readiness, cache manifests and visual acceptance. Encoded file size is separate from network transfer and decoded memory. There is no public WOFF2 decoder or browser qualification claim.
