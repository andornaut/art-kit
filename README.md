# art-kit

Shared TypeScript mechanisms for scripted pixel art and atlas builds. Source lives in `node/src` and compiles to the ESM package `@andornaut/art-kit`, released as a GitHub release tarball with no registry publication.

## Boundaries

The compiled package includes TypeScript declarations and these public subpaths:

| Subpath | Owns | Client supplies |
| --- | --- | --- |
| `atlasBuild` | Atlas drawing and encoded page assembly | Read/decode/encode functions, blits, extrusion and metadata |
| `atlasLayout` | Shelf packing and candidate selection | Items, grouping, order comparator, candidate widths and size limits |
| `colour` | Hex RGB, WCAG contrast, sRGB to Oklab and OKLCH, and OKLCH to sRGB | Resolved hex colours, sRGB triples and OKLCH triples |
| `draw` | Polygon, ellipse, line, arc, point, rectangle and rounded-rectangle drawing into RGBA buffers, pixel-exact with Pillow 13.0.0 | Colours, points, bounds, widths and the target image |
| `fonts` | Skia glyph rendering, atlas packing, BMFont XML and metadata | Font path, size, characters, atlas width, kerning and coverage policy |
| `frames` | Opaque extents, reflection, frame rendering, sheets and contact sheets | Pixel frames, colour resolver, background, grounds, scale and cell size |
| `generate` | Consolidated Skia generation entry for grids, colours, frames and sprite sheets | The options of the modules it re-exports |
| `gif` | Animated GIF encoding with exact palettes and binary alpha | Frames, durations, loop and disposal |
| `glyphAtlas` | Atlas packing and BMFont XML for supplied RGBA glyphs | Glyph images, offsets, advances and font metrics |
| `grid` | Shape drawing and outline traversal | Palette, colour names and edge colour rule |
| `ico` | ICO encoding with PNG entries | One pre-sized RGBA image per entry |
| `indexedPng` | Indexed PNG encoding | RGBA image and compression options |
| `png` | PNG decoding to RGBA, RGBA PNG encoding and opaque RGB PNG encoding | Encoded bytes or an RGBA image and compression options |
| `quantise` | Deterministic median-cut reduction to one shared palette | Frames and the colour limit |
| `raster` | Straight-alpha RGBA fill, paste, compositing, crop, nearest resize and rotation, channel extraction and mapping, and contact sheets | Images, planes, colours, positions, rectangles, sizes, angles and channel tables |
| `rgbaImage` | RGBA allocation, alpha bounds and extruded blitting | Image dimensions, pixels, rectangles and bounds |
| `spriteSheet` | Sprite sheet PNG and json-hash data byte-identical to Aseprite 1.2.30's export, without Aseprite | Key, image name, tags, optional columns and slice margins, and paths for the writer |
| `webp` | Lossless WebP encoding | RGBA images |

Import subpaths explicitly, for example `@andornaut/art-kit/atlasLayout`. Geometry and RGBA interfaces are local structural types; the package has no `game-kit` dependency. Clients own palettes and ramps, sprite definitions, font files and glyph policy, camera/depth geometry, manifests, tile sizes, frame tags, grouping, ordering policy, paths, filenames and Vite asset emission. No module imports a game or discovers its repository from the working directory.

```ts
import { Grid } from '@andornaut/art-kit/grid';

const grid = new Grid({ fill: 'ffffff' }, 16, 16, { edge: () => '000000' });
grid.ell(8, 8, 4, 4, 'fill');
const frame = grid.outlined();
```

A client can subclass `Grid` to retain its existing constructor and outline signature. `px`, `w`, `h`, `edge` and `close` are mutable.

`spriteSheet.spriteSheet({ key, image, columns, margins }, tags)` returns `{ sheet, data }`: the PNG bytes and json-hash text that Aseprite 1.2.30's command-line sheet export writes, byte for byte, with no executable, source file or filesystem access. A `Tag` is `[name, frames, milliseconds]`, with one duration for every frame or one each; every frame has the first frame's size, and every pixel is a hex colour (opaque) or `null` (clear), so the palette is not needed. Frames run left to right in tag order, in one row or wrapping after `columns`. `key` names the frames `<key> <index>.aseprite` (`<key>.aseprite` when there is one frame) and the slice; `image` is written as `meta.image`. `margins: [left, top, right, bottom]` adds `meta.slices` with one slice over frame 0 whose centre lies inside the margins; they are whole pixels that leave a centre. Durations are stored as Aseprite stores them: truncated to whole milliseconds within 1..65535, so 1001 becomes 1000. Invalid columns, margins, durations or frame sizes throw `RangeError`. `writeSpriteSheet({ sheet, data }, { key, columns, margins }, tags)` writes both files, creating their directories, with the sheet's file name as `meta.image`. The PNG is colour type 6 with an `sRGB` chunk, libpng 1.6.38's filter choice and IDAT chunking, and the deflate stream of the Chromium zlib inside Aseprite 1.2.30 on an x86-64 CPU with SSE4.2 and PCLMUL, which differs from `node:zlib` and upstream zlib. The Node tests compare it with the frozen Aseprite exports in `node/tests/fixtures/sprite-sheet`. It does not need Skia.

`rgbaImage.opaqueRect(within, image)` returns the alpha bounds within the supplied rectangle, or `undefined` when that region is clear. Callers choose trimming and clear-frame handling.

`raster` operates on straight (non-premultiplied) `RgbaImage` buffers with exact integer rounding and no canvas or Skia dependency; an opaque (RGB) image is one whose alpha is 255. Pillow 13.0.0 is the parity reference: the frozen fixtures in `node/tests/fixtures/raster` must match byte for byte, including partial alpha. Options and context precede the subject image, and every operation clips to the image on all sides. `fill({rect, mask?}, rgba, image)`, `paste({at, mask?, keepAlpha?}, source, image)` and `composite(at, source, image)` mutate `image`; every other function returns a new image or plane. `fill` replaces the rect, or with an 8-bit `Plane` mask sized to the rect blends each channel by coverage; a fully transparent pixel takes the full colour in RGB wherever coverage is nonzero. `paste` replaces target pixels, or with a mask plane sized to the source (or `"alpha"` for the source's own alpha) blends from target to source by the mask value; `keepAlpha: true` writes RGB only, for opaque targets. `composite` is straight-alpha source-over. `frameToRgba(context, frame)` resolves colours as `frames.renderFrame` does. `crop` zero-fills outside the source. `resizeNearest(width, height, image)` samples nearest pixel centres and replicates pixels exactly at integer factors; `rotateNearest(angle, image)` rotates counter-clockwise about the centre at the same size, leaving uncovered pixels clear. Both copy RGBA exactly, including RGB under clear alpha. `grayscale` returns ITU-R 601-2 luma, `channel(index, image)` one channel, `opaque` a copy with alpha 255 and RGB kept, and `mapChannels(luts, image)` a copy with each channel mapped through its 256-byte table. `composeContactSheet({resolveRgb, background, cellSize, scale, gap}, sprites, grounds)` builds the preview in memory, so its size is not limited by a canvas. `cellSize` is required: `"largest-frame"` sizes every cell from the largest frame and matches `frames.renderContactSheet`; `"row-first-frame"` takes cell width from the widest first frame and each row's height from its first frame, paints empty cells in the ground colour and lets later frames overwrite earlier overflow. Invalid geometry, colours, channel indexes, tables and plane sizes throw `RangeError`.

`draw` renders shapes into `RgbaImage` buffers with output byte-identical to Pillow 13.0.0 `ImageDraw.Draw(image)`, without Skia. Style precedes geometry and the image comes last; each call mutates the image: `point(rgba, points, image)`, `line({fill, width, joint}, points, image)`, `polygon({fill, outline, width}, points, image)`, `ellipse`, `rectangle` and `roundedRectangle` with `({fill, outline, width}, bounds, image)` (`roundedRectangle` also takes `radius` and optional `corners`), and `arc({fill, width}, bounds, start, end, image)` with degrees clockwise from three o'clock. Colours are `raster` `Rgba` values written directly, without blending; for an opaque (RGB) target, use alpha 255. Points are `{x, y}` objects and `Bounds` is `{x0, y0, x1, y1}` with inclusive corner pixels, so `x0 = x1` is one pixel wide. Fractional coordinates are truncated toward zero, and `roundedRectangle` rounds its bounds half to even first. A shape given neither fill nor outline draws a white outline, and an outline equal to the fill is skipped. Pillow mode `"L"` and `"1"` targets cover the same pixels as RGBA (for `"1"`, one ink per shape), so a mask is any channel of a white-on-clear RGBA drawing. Bounds with `x1 < x0` or `y1 < y0`, or an ellipse, arc or rounded corner spanning 8192 pixels or more, throw `RangeError`. The Node tests compare every operation exactly with the frozen Pillow fixtures in `node/tests/fixtures/draw.json`.

`indexedPng.encodeIndexedPng({ level, memLevel }, image)` returns encoded bytes, or `undefined` when the image has more than 256 distinct RGBA colours. `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` returns RGBA PNG bytes. `png.encodeRgbPng` takes the same options and returns colour type 2 bytes that decode to the image, throwing `RangeError` when any alpha is not 255; bytes are not matched to Pillow. Both write the bytes pngjs 7.0.0 `PNG.sync.write` writes for the same options. They filter rows straight from `image.data` into a streamed deflate, so memory beyond the input is the compressed output plus a few rows; deflate level 0 and inputs pngjs treats specially go through pngjs. Compression context precedes the image; callers choose indexed-first fallback, PNG versus WebP and output metadata.

`colour.srgbToOklab(rgb)` and `srgbToOklch(rgb)` return Oklab and OKLCH triples. `oklchToSrgb(lch)` clamps lightness to 0..1, limits chroma to the search bound, wraps hue in degrees and reduces out-of-gamut chroma at fixed lightness and hue, then clamps linear channels and quantizes to bytes. Neutral hue is zero. Palette targets and perceptual contrast policy remain caller-owned.

## Generation

Generation uses CPU Skia canvases for `frames` and `fonts`; `raster` is the canvas-free path that reproduces Pillow's RGBA arithmetic exactly. Install the optional exact peer `skia-canvas@4.0.0` for `fonts`, `frames` and `generate`; no other subpath requires it.

`frames.renderFrame(paletteOrResolver, frame)`, `composeSheet({columns, cellWidth, cellHeight}, images)` and `renderContactSheet(options, sprites, grounds)` return Canvas objects. Keep those objects through composition and use their `saveAs` or `toBuffer` methods at the output boundary. Composition uses Skia source-over and nearest-neighbour image scaling, without promising preservation of arbitrary invisible RGB or Pillow rounding. Exact RGBA copy/extrusion remains in the separate buffer APIs.

`fonts.buildBitmapFont({path, size, key, characters, atlasWidth, ...})` returns `{image, xml, metadata}`. It measures and renders directly into the final CPU atlas. Antialiasing and hinting default to true; synthesis and cross-glyph ligature/contextual substitutions are disabled. Callers may specify padding, maximum height, line height and the pairs for which kerning is derived. Font files remain immutable after registration. Optional `face` and `base` set the BMFont face label and baseline explicitly; `lineHeight` remains caller-controlled. `coverage: "strict"` loads the optional exact peer `fontkit@2.0.4` to preflight every requested code point against the selected single-face font file. Missing characters fail with code-point diagnostics; font collections are rejected. This cmap preflight does not disable Skia's internal fallback or guarantee glyph shaping. The default `coverage: "system"` requires no parser and preserves existing behaviour. `kerning: "all"` evaluates all ordered pairs for at most 256 unique characters and emits nonzero integer adjustments; it cannot be combined with `kerningPairs`. The default `kerning: "requested"` preserves the explicit-pair interface.

```ts
import { buildBitmapFont } from '@andornaut/art-kit/fonts';
import { writeFile } from 'node:fs/promises';

const font = buildBitmapFont({
  path: 'body.ttf', size: 16, key: 'body',
  characters: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ', atlasWidth: 256,
});
await font.image.saveAs('body.png');
await writeFile('body.fnt', font.xml);
```

`generate` re-exports `Grid`, `rgb`, `contrast`, `flipped`, `renderFrame`, `composeSheet` and `renderContactSheet` and `spriteSheet` and `writeSpriteSheet` with their types, for a generator that needs several of them from one import. It requires the optional Skia peer and belongs in Node art/build scripts, not browser bundles.

`glyphAtlas.buildBitmapFontFromGlyphs(options, glyphs)` packs a `ReadonlyMap<string, SuppliedBitmapGlyph>` in insertion order. Each supplied glyph contains a structural RGBA `image` (or `undefined` for empty ink), signed integer `xoffset`/`yoffset` and integer `xadvance`. Options explicitly supply `key`, `face`, `size`, `base`, `lineHeight` and `atlasWidth`, with optional `maxHeight` and `kernings`. `layout` selects the placement and XML shape, and `metadata.layout` reports it. `"padded"` (the default) insets and spaces glyphs by `padding` (default 1), fits the atlas height to the last row and always writes a kernings element. `"packed"` requires a boolean `antialias` and rejects `padding`: insertion order from (0, 0), 1 px spacing with a glyph wrapping when it and its trailing spacing pixel overflow the row, a power-of-two atlas height, every info attribute (`charset`, `stretchH`, `smooth` and `aa` from `antialias`, `padding`, `spacing`), single-quoted attributes for values that hold double but no single quotes, and no kernings element when there are no kernings. The Node tests compare it byte for byte with the frozen references in `node/tests/fixtures/bmfont-packed.json`, whose coverage glyphs are white with coverage in every channel. The returned `{image, xml, metadata}` uses an RGBA buffer rather than a Canvas. Packing copies straight-alpha bytes exactly, including invisible RGB, without rasterization or blending. Callers retain glyph design and metric policy and encode the atlas themselves, for example with `png.encodeRgbaPng`. The subpath requires neither Skia nor fontkit.

See [implementation comparison](docs/implementation-comparison.md) for measured size and font output quality.

## Runtime and checks

Node 24.21.0 or newer with exact peer dependencies `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional peers above. WebP uses the non-SIMD WASM codecs supplied by that peer package. The source fonts and their licences remain in the client repositories.

The `scripts/*.sh` wrappers check their arguments and run `scripts/container.mts` with host Node 24.21.0 or newer, which runs TypeScript through type stripping. The module only orchestrates Docker and copies files on the host. Every check, build and provisioning step runs in a `node:24.21.0` container as the dedicated uid 19001 (`--user 19001:19001 -e HOME=/tmp`), which owns nothing on the host, with four CPUs, a read-only root, no capabilities and no network except while provisioning. Host paths are bind-mounted with `--mount type=bind,...,readonly`, never `-v`, so a missing source fails instead of being created, and must be readable by uid 19001 through their group or world bits; the container receives each mounted path's group. Writable state lives in a per-run named volume at `/tmp`, results are copied out with `docker cp` as the host user, and the container and volume are removed on exit. No host credential store or socket is mounted. Commands start only below one-minute load 24 and discard results when Git status or listed file contents change during the run.

| Command | Effect |
| --- | --- |
| `bash scripts/provision.sh <empty-directory>` | Downloads the pinned dependencies from `node/package.json` into `node/node_modules` |
| `bash scripts/check.sh <node_modules>` | Copies the current tree into the container, compiles it, packs and installs the tarball into `node_modules/@andornaut/art-kit`, checks that every subpath except `fonts`, `frames` and `generate` imports without the optional peers, checks the declarations, then runs the Node tests against the installed package with `node:test`; evidence goes to a new directory under `.claude/` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds the release artifacts from the committed `HEAD` |

CI runs the same commands. Game projects assume library contracts are correct and test their own adapters and authored output. No game build or generation is part of the package gate.

## Version and licence

The package version is the `version` in `node/package.json`. Compatible fixes increment the patch version; additive public features increment the minor version. Incompatible public API changes require an explicitly coordinated compatibility bump and release notes before consumer migration: increment the minor version before 1.0.0 and the major version thereafter. Never introduce an incompatible change in a patch release. Exact Git revision identifies each payload. Generated assets, fonts and client code retain their existing licences. Extracted helper code in this repository is MIT licensed.

## Released dependency

The public source repository is [andornaut/art-kit](https://github.com/andornaut/art-kit). The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. After publication, consumers pin that URL with the tarball's exact SHA-256 from `SHA256SUMS`, and pin the exact peers, through their own dependency integration, without registry publication or a source fallback. Do not commit placeholder hashes or fetch unpublished URLs. The tarball contains compiled ESM and `.d.ts` files, `LICENSE` and `SOURCE_COMMIT`, not source TypeScript as runtime code. No fonts, game assets or local tooling are included.

`bash scripts/pack.sh <node_modules> <empty-directory>` archives the committed `HEAD` and builds offline in a four-CPU container. It emits `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` (covering the tarball and `SOURCE_COMMIT`). Source CI runs the check and pack and uploads those artifacts for review.

Before creating the immutable `v<version>` tag for the version in `node/package.json`, verify that every required CI workflow has completed successfully on the exact release commit on `main`. Publish that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` as GitHub release assets after checking the checksums and a fresh install; do not substitute an earlier artifact. Consumers adopt the published URL and checksum through their own integration process.
