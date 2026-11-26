# art-kit

Shared TypeScript mechanisms for scripted pixel art and atlas builds. Source lives in `node/src`, grouped by area (`raster`, `codecs`, `atlas`, `fonts` and `build`), and compiles to the ESM package `@andornaut/art-kit`, released as a GitHub release tarball with no registry publication.

Design summaries by area, with an index of their work items, are in [docs/design](docs/design/README.md); each approved task is a work file in [docs/work](docs/work/README.md).

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

See [API entry points](docs/api-entry-points.md) for import dependencies, the shared kit namespace rules and the v0.28 migration map.

## Try a released build

Use Node 24.22.2 or newer. Choose a version from [GitHub Releases](https://github.com/andornaut/art-kit/releases)
and download its tarball, `SOURCE_COMMIT` and `SHA256SUMS` into a scratch directory. Run the following
there, replacing the example version with the one you downloaded.

```sh
version=0.34.0
sha256sum -c SHA256SUMS &&
  npm install "./art-kit-$version.tgz" pngjs@7.0.0 @jsquash/webp@1.5.0 &&
  node --input-type=module -e 'import { Grid } from "@andornaut/art-kit/build/grid"; console.log(typeof Grid)'
```

The smoke check prints `function`. In a consumer project, [pin the public release URL](#released-dependency)
and commit its lockfile. Install the [optional peers](#runtime-and-checks) only for the APIs you use.

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

The Pillow fixtures in `node/tests/fixtures` cover the existing raster and drawing operations, including partial alpha. Separate frozen synthetic references cover the smooth filters and inverse Oklab.

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

## Builds

`build` runs a game's art build sets one at a time. The module uses only Node built-ins and spawns a process only for a `nodeBuild` step.

| Export                                                                               | Contract                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BuildSets`                                                                          | Set name to `{ build, needs? }`; `needs` names the sets whose outputs it reads                                                                                                                                            |
| `buildOrder(sets, selected?)`                                                        | Each set after its needs, ties in declaration order. Selected sets run with everything downstream, not their needs. Unknown needs and cycles throw `RangeError`; unknown selected names throw an error named `UsageError` |
| `checkSets({ strictOrder?, modules? }, sets)`                                        | Startup self-checks, all off by default; every problem found is listed in one `RangeError`                                                                                                                                |
| `runBuilds({ sets, check?, strictOrder?, modules?, log? }, selected?)`               | Runs `checkSets`, then logs `build <set>` before each and resolves to `{ changes?, order }`. A failing build throws an error named `BuildError` with `set` and `cause`                                                    |
| `check: { paths, outputs?, static? }`                                                | SHA-256 before/after snapshot under each path (symlinks by target). Changes or unclaimed files throw `CheckError` with sorted `{ added, changed, removed, unclaimed? }` lists.                                            |
| `nodeBuild({ directory, extension?, args? }, set)`                                   | A build step running `node <directory>/<set><extension> ...args` (defaults `.ts` and `["build"]`) with `process.execPath` and inherited stdio; throws `exit <status>` or `signal <name>`                                  |
| `buildCommand({ sets, check?, strictOrder?, modules?, usage?, log?, error? }, argv)` | `[--check] [SET...]`; resolves to 0, 1 for a failed self-check, a failing build, check differences or invalid build configuration, or 2 for a usage error followed by `usage`                                             |

### Self-checks

`strictOrder: true` requires the declared order to meet every need and throws `Set <set> must be declared after <need>, which it needs` instead of reordering; a table that passes runs in declaration order. `modules: { directory, nonSets, extension? }` reconciles a directory of one module per set (`.ts` by default) with the table: it lists each module that is neither a set nor in `nonSets`, each set or non-set without a module, and each name listed as both. Both are off by default so tables built in process, without modules or with a dependent declared first, keep working. `buildCommand` runs them after `--help` and before parsing the sets, so a failed self-check exits 1 even when the arguments also hold an unknown set.

### Command line

A sole `--help` or `-h` prints `usage` (or `Usage: [--check] [SET...]` when none is given) through `log`, which defaults to stdout, and returns 0 without running the self-checks. With other arguments either is an unknown option, exit 2.

### Check modes

The snapshot check compares the tree before and after the rebuild without Git, so it works in a copy with no `.git`. It ignores differences that existed before the run and includes ignored files under the check paths: run it on a clean checkout to compare the rebuild with the committed outputs. Relative paths resolve against the working directory.

`outputs: true` catches stale outputs without Git: each set lists the files and directories it writes in `outputs`, and `static` lists hand-kept files under the check paths, such as a licence. After the rebuild, every file under the check paths must equal or sit inside one of them, or the check fails with it in `unclaimed`, printed as `!\tpath`. Every set's `outputs` count, selected or not, so a partial rebuild does not flag other sets' files. A file a set stopped writing therefore fails the check even though the rebuild left it unchanged. Nothing is deleted.

```ts
import { buildCommand, nodeBuild } from "@andornaut/art-kit/build/build";

const tools = { directory: "art/tools" };
process.exitCode = await buildCommand(
  {
    check: { outputs: true, paths: ["public/art"], static: ["public/art/fonts/OFL.txt"] },
    modules: { ...tools, nonSets: ["build", "pixel"] },
    sets: {
      sprites: { build: nodeBuild(tools, "sprites"), outputs: ["public/art/sprites"] },
      silhouettes: {
        build: nodeBuild(tools, "silhouettes"),
        needs: ["sprites"],
        outputs: ["public/art/silhouettes.json"],
      },
    },
    strictOrder: true,
    usage: "Usage: node art/tools/build.ts [--check] [SET...]",
  },
  process.argv.slice(2),
);
```

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

[Implementation notes](docs/implementation-comparison.md) cover font output quality and the rendering split.

## WOFF2 fonts

Import `encodeWoff2(font: Uint8Array): Promise<Uint8Array>` from `@andornaut/art-kit/build/woff2`, with the optional exact peer `wawoff2@2.0.1` installed. This canvas-free Node build API encodes a complete static or variable TrueType 1.0 font with `glyf`/`loca` tables. It does not rasterize, replace fonts or expose fidelity settings. The peer is loaded only when encoding; other imports need neither it nor Skia. Input bytes are copied and remain unchanged; concurrent calls are serialized and return independent output bytes.

Signed fonts with a `DSIG` table, CFF outlines, collections and malformed directories are rejected. Variable fonts retain their variation tables and axes; encoding does not select an instance or strip variation data. Codec failures reject the promise without preventing later calls. The pinned WASM codec comes from Google's WOFF2 implementation; its packaged binary dates from 2022. Repeated output is pinned by regression hashes, rather than a promise that different codec versions produce identical bytes.

WOFF2 retains font content but may normalize SFNT serialization, including table offsets and padding, glyph encoding, location/metric representation and the head checksum and lossless-transform flag. Decoded TTF bytes need not equal the original file. Tests decode both full Liberation Sans fixtures and the full variable Tiny5 fixture and compare every glyph's geometry, components and hint instructions, Unicode coverage, advances, kerning, names, licence metadata and all remaining tables outside explicit serialization differences. Tiny5 checks include complete `fvar`, `gvar` and `HVAR` table bytes, preserving axes, named instances and variation metrics. These fixtures match the requested consumer originals. Font licensing remains unchanged; no font payload is included in the package.

### Subsetting

`subsetWoff2({ strings, label? }, font): Promise<Uint8Array>` also needs the optional exact peer `harfbuzzjs@1.6.4`. It keeps only the code points of `strings`, subsets through HarfBuzz hb-subset defaults and encodes the result like `encodeWoff2`. HarfBuzz keeps the glyphs those characters reach through composites and default GSUB features, their GPOS adjustments, hinting, every variation axis and named instance, and name records 0 to 25 (including copyright, licence and licence URL). HarfBuzz drops the legacy `kern` table (and `FFTM`), so kerning survives only where GPOS carries it, as in Liberation Sans. C0 and C1 controls such as newline are ignored.

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

## Runtime and checks

Node 24.22.2 or newer with the exact peers `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas@4.0.0` for `fonts`, `wawoff2@2.0.1` for `woff2` and `harfbuzzjs@1.6.4` for `subsetWoff2`. Source fonts and their licences stay in the client repositories.

Run `make check` for the full package gate. Use `make lint` for formatting, ESLint, TypeScript, Markdown and ShellCheck, or `make test` to build and install the package, check its public imports and declarations, and run the Node tests. Only `make build` writes to the checkout, replacing ignored `node/dist`. It exits before launching Docker if Git tracks `node/dist` or any of its contents.

Make runs `tests/container/check-stock` using the stock images pinned in `tests/container/images`. One Node container installs the development and peer dependencies, downloads the Skia prebuild and uses a fresh scratch source tree for each Node phase. Lint adds separate Markdown and read-only ShellCheck containers. The shared `tests/container/stock` functions copy the Git-listed source into `/work` without Git metadata or credentials. Containers run as uid 19001 with a read-only root, four CPUs and bounded scratch. Node and Markdown containers use the network to install dependencies. Each container starts only while the one-minute load is below 20. The [Markdown tooling notes](tests/container/README.md) document the scoped security overrides and their removal criteria.

Check, pack and provision containers have a 4 GiB memory ceiling. `scripts/provision.sh` and `scripts/pack.sh` run `scripts/container.mts` with host Node through type stripping. Both wait for the one-minute load to fall below 20 before launching Docker. Pack archives the packaging script and payload from the same committed revision. Their builds and downloads run in a `node:24.22.2` container as uid 19001 (`--user 19001:19001 -e HOME=/tmp`), with four CPUs, a read-only root and no network except while provisioning. Host paths are read-only bind mounts. Writable state lives in a per-run `/tmp` volume, outputs leave through `docker cp`, and owned containers and volumes are removed on exit.

| Command                                                 | Effect                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bash scripts/provision.sh <empty-directory>`           | Downloads the pinned dependencies from `node/package.json` into `<empty-directory>/node/node_modules` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` from the committed `HEAD`            |

Formatting follows `.prettierrc`; `node/tests/fixtures` is excluded because the tests compare it byte for byte. Lint rules are in `eslint.config.mjs` and the shared `eslint.config.base.mjs`. ESLint layers the `node/src` areas, lowest first: `raster` imports no other area, `codecs` and `fonts` import `raster`, `atlas` imports `raster` and `codecs`, and `build` imports no other area. Type-only imports follow the same layers. `import-x/no-cycle` rejects runtime import cycles in `node/src`, `scripts`, `tests/container` and `node/tests`, and TypeScript `erasableSyntaxOnly` rejects parameter properties, enums and namespaces. On a branch push or pull request, CI runs `make lint` and the attribution scan. The verification job skips changes confined to `docs/` when CI can compare against the base commit. Changes outside `docs/`, including `README.md`, and events without a usable base also run `make check`, then provision, pack and upload the committed release artifacts. Game projects test their own adapters and authored output; no game build is part of the package gate.

## Version and licence

The package version is the `version` in `node/package.json`. Compatible fixes increment the patch version and additive features the minor version. An incompatible public API change needs a coordinated bump and release notes before consumers migrate: the minor version before 1.0.0, the major version after. The exact Git revision identifies each payload. Helper code here is MIT licensed; test fonts keep their SIL OFL licence and are excluded from release artifacts. Generated assets, fonts and client code keep their own licences.

## Released dependency

### Upgrading to 0.34

- Validation errors read `<subject> must <constraint>` across every subpath. Error types, check
  order and `buildCommand` exit statuses are unchanged; update any test or caller that matches
  message text.
- `build/glyphAtlas` exports `GlyphAtlas`, the return type of `buildBitmapFontFromGlyphs`, and
  `build/rgbaImage` exports the `Point` and `Rect` types used in public options.
- Sprite sheets render through the shared raster frame code with identical PNG, RGBA and JSON
  output. Import paths are unchanged after the internal source reorganization.

The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. Consumers pin that URL with the tarball's SHA-256 from `SHA256SUMS`, plus the exact peers, through their own dependency integration. The tarball holds compiled ESM, `.d.ts` files, the published `package.json`, `LICENSE` and `SOURCE_COMMIT`; no source, fonts, game assets or tooling.

Tag `v<version>` only after every required CI workflow has passed on the exact release commit on `main`. Use that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` to run the [checksum and fresh-install commands](#try-a-released-build) before publishing the three files as release assets.
