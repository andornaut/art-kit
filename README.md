# art-kit

Shared TypeScript mechanisms for scripted pixel art and atlas builds. Source lives in `node/src` and compiles to the ESM package `@andornaut/art-kit`, released as a GitHub release tarball with no registry publication.

## Boundaries

The compiled package includes TypeScript declarations and these public subpaths:

| Subpath | Owns | Client supplies |
| --- | --- | --- |
| `aseprite` | Frame/tag Lua and PNG/JSON export | Executable, palette, tags, paths, optional slice and sheet columns |
| `atlasBuild` | Atlas drawing and encoded page assembly | Read/decode/encode functions, blits, extrusion and metadata |
| `atlasLayout` | Shelf packing and candidate selection | Items, grouping, order comparator, candidate widths and size limits |
| `colour` | Hex RGB, WCAG contrast, Oklab and OKLCH | Resolved hex colours and sRGB triples |
| `draw` | Polygon, ellipse, line, arc, point, rectangle and rounded-rectangle drawing into RGBA buffers, pixel-exact with Pillow 13.0.0 | Colours, points, bounds, widths and the target image |
| `fonts` | Skia glyph rendering, atlas packing, BMFont XML and metadata | Font path, size, characters, atlas width, kerning and coverage policy |
| `frames` | Opaque extents, reflection, frame rendering, sheets and contact sheets | Pixel frames, colour resolver, background, grounds, scale and cell size |
| `generate` | Consolidated generation entry and one-call font export | The options of the modules it re-exports, plus output paths |
| `gif` | Animated GIF encoding with exact palettes and binary alpha | Frames, durations, loop and disposal |
| `glyphAtlas` | Atlas packing and BMFont XML for supplied RGBA glyphs | Glyph images, offsets, advances and font metrics |
| `grid` | Shape drawing and outline traversal | Palette, colour names and edge colour rule |
| `ico` | ICO encoding with PNG entries | One pre-sized RGBA image per entry |
| `indexedPng` | Indexed PNG encoding | RGBA image and compression options |
| `png` | PNG decoding to RGBA, RGBA PNG encoding and opaque RGB PNG encoding | Encoded bytes or an RGBA image and compression options |
| `quantise` | Deterministic median-cut reduction to one shared palette | Frames and the colour limit |
| `raster` | Straight-alpha RGBA fill, paste, compositing, crop, flip, nearest resize and rotation, channel operations and contact sheets | Images, planes, colours, positions, rectangles, sizes, angles and channel tables |
| `rgbaImage` | RGBA allocation, alpha bounds and extruded blitting | Image dimensions, pixels, rectangles and bounds |
| `webp` | Lossless WebP encoding, decoding and RGBA comparison | Images or encoded bytes |

Import subpaths explicitly, for example `@andornaut/art-kit/atlasLayout`. Geometry and RGBA interfaces are local structural types; the package has no `game-kit` dependency. Clients own palettes and ramps, sprite definitions, font files and glyph policy, camera/depth geometry, manifests, tile sizes, frame tags, grouping, ordering policy, paths, filenames and Vite asset emission. No module imports a game or discovers its repository from the working directory.

```ts
import { Grid } from '@andornaut/art-kit/grid';

const grid = new Grid({ fill: 'ffffff' }, 16, 16, { edge: () => '000000' });
grid.ell(8, 8, 4, 4, 'fill');
const frame = grid.outlined();
```

A client can subclass `Grid` to retain its existing constructor and outline signature. `px`, `w`, `h`, `edge` and `close` are mutable.

`aseprite.export(executable, palette, tags, source, sheet, data, { key, margins, columns })` accepts an optional positive integer `columns` to set the exported sheet column count. For example, `columns: 6` arranges twelve frames in six columns and two rows. Omit it to retain the default sheet layout; source frames, tags, durations and slices are unchanged.

`rgbaImage.opaqueRect(within, image)` returns the alpha bounds within the supplied rectangle, or `undefined` when that region is clear. Callers choose trimming and clear-frame handling.

`raster` operates on straight (non-premultiplied) `RgbaImage` buffers with exact integer rounding and no canvas or Skia dependency; an opaque (RGB) image is one whose alpha is 255. Pillow 13.0.0 is the parity reference: the frozen fixtures in `node/tests/fixtures/raster` must match byte for byte, including partial alpha. Options and context precede the subject image, and every operation clips to the image on all sides. `fill({rect, mask?}, rgba, image)`, `paste({at, mask?, keepAlpha?}, source, image)` and `composite(at, source, image)` mutate `image`; every other function returns a new image or plane. `fill` replaces the rect, or with an 8-bit `Plane` mask sized to the rect blends each channel by coverage; a fully transparent pixel takes the full colour in RGB wherever coverage is nonzero. `paste` replaces target pixels, or with a mask plane sized to the source (or `"alpha"` for the source's own alpha) blends from target to source by the mask value; `keepAlpha: true` writes RGB only, for opaque targets. `composite` is straight-alpha source-over. `frameToRgba(context, frame)` resolves colours as `frames.renderFrame` does. `crop` zero-fills outside the source and `flipX` mirrors horizontally. `resizeNearest(width, height, image)` samples nearest pixel centres and replicates pixels exactly at integer factors; `rotateNearest(angle, image)` rotates counter-clockwise about the centre at the same size, leaving uncovered pixels clear. Both copy RGBA exactly, including RGB under clear alpha. `grayscale` returns ITU-R 601-2 luma, `channel(index, image)` one channel, `withChannel(index, plane | byte, image)` a copy with one channel replaced, `opaque` a copy with alpha 255 and RGB kept, and `mapChannels(luts, image)` a copy with each channel mapped through its 256-byte table. `composeContactSheet({resolveRgb, background, cellSize, scale, gap}, sprites, grounds)` builds the preview in memory, so its size is not limited by a canvas. `cellSize` is required: `"largest-frame"` matches `frames.renderContactSheet`, and `"row-first-frame"` sizes cells from first frames as art_kit 0.5.0 `frames.contact_sheet` did. Invalid geometry, colours, channel indexes, tables and plane sizes throw `RangeError`.

`draw` renders shapes into `RgbaImage` buffers with output byte-identical to Pillow 13.0.0 `ImageDraw.Draw(image)`, without Skia. Style precedes geometry and the image comes last; each call mutates the image: `point(rgba, points, image)`, `line({fill, width, joint}, points, image)`, `polygon({fill, outline, width}, points, image)`, `ellipse`, `rectangle` and `roundedRectangle` with `({fill, outline, width}, bounds, image)` (`roundedRectangle` also takes `radius` and optional `corners`), and `arc({fill, width}, bounds, start, end, image)` with degrees clockwise from three o'clock. Colours are `raster` `Rgba` values written directly, without blending; for an opaque (RGB) target, use alpha 255. Points are `geometry` `Point` values and `Bounds` is `{x0, y0, x1, y1}` with inclusive corner pixels, so `x0 = x1` is one pixel wide. Fractional coordinates are truncated toward zero, and `roundedRectangle` rounds its bounds half to even first. A shape given neither fill nor outline draws a white outline, and an outline equal to the fill is skipped. Pillow mode `"L"` and `"1"` targets cover the same pixels as RGBA (for `"1"`, one ink per shape), so a mask is any channel of a white-on-clear RGBA drawing. Bounds with `x1 < x0` or `y1 < y0`, or an ellipse, arc or rounded corner spanning 8192 pixels or more, throw `RangeError`. The Node tests compare every operation exactly with the frozen Pillow fixtures in `node/tests/fixtures/draw.json`.

`indexedPng.encodeIndexedPng({ level, memLevel }, image)` returns encoded bytes, or `undefined` when the image has more than 256 distinct RGBA colours. The subpath also exports `MAX_PALETTE` and `COLOUR_TYPE_INDEXED`. `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` returns RGBA PNG bytes. `png.encodeRgbPng` takes the same options and returns colour type 2 bytes that decode to the image, throwing `RangeError` when any alpha is not 255; bytes are not matched to Pillow. Both write the bytes pngjs 7.0.0 `PNG.sync.write` writes for the same options. They filter rows straight from `image.data` into a streamed deflate, so memory beyond the input is the compressed output plus a few rows; deflate level 0 and inputs pngjs treats specially go through pngjs. Compression context precedes the image; callers choose indexed-first fallback, PNG versus WebP and output metadata.

`colour.srgbToOklab(rgb)` and `srgbToOklch(rgb)` return Oklab and OKLCH triples. `oklabToSrgb(lab)` clamps linear channels on conversion to bytes. `oklchToSrgb(lch)` clamps lightness to 0..1, limits chroma to the search bound, wraps hue in degrees and reduces out-of-gamut chroma at fixed lightness and hue before byte quantization. Neutral hue is zero. Palette targets and perceptual contrast policy remain caller-owned.

## Generation

Generation uses CPU Skia canvases for `frames` and `fonts`; `raster` is the canvas-free path that reproduces Pillow's RGBA arithmetic exactly. Install the optional exact peer `skia-canvas@4.0.0` for `frames` and `fonts`; codec-only imports do not require it.

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

Use the consolidated import when a generator needs several facilities:

```ts
import { Grid, renderFrame, composeSheet, exportBitmapFont } from '@andornaut/art-kit/generate';

await exportBitmapFont({
  font: {
    path: 'body.ttf', size: 16,
    characters: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ', atlasWidth: 256,
  },
  output: { png: 'public/fonts/body.png', fnt: 'public/fonts/body.fnt' },
});
```

The helper creates parent directories and returns the built image, XML, metadata and resolved output paths. The XML page reference is relative to the FNT directory, so outputs may live in different directories. PNG output requires the exact `.png` extension. Build/encoding failures precede writes, but the two files are not an atomic transaction. This entry requires the optional Skia peer and belongs in Node art/build scripts, not browser bundles. Existing subpath imports remain available. Aseprite exports are named `exportAseprite` and `asepriteLua` in this consolidated entry.

`glyphAtlas.buildBitmapFontFromGlyphs(options, glyphs)` packs a `ReadonlyMap<string, SuppliedBitmapGlyph>` in insertion order. Each supplied glyph contains a structural RGBA `image` (or `undefined` for empty ink), signed integer `xoffset`/`yoffset` and integer `xadvance`. Options explicitly supply `key`, `face`, `size`, `base`, `lineHeight` and `atlasWidth`, with optional `maxHeight` and `kernings`. `layout` selects the placement and XML shape, and `metadata.layout` reports it. `"padded"` (the default) insets and spaces glyphs by `padding` (default 1), fits the atlas height to the last row and always writes a kernings element. `"packed"` requires a boolean `antialias` and rejects `padding`; it reproduces art_kit 0.10.0 `fonts.pack` and `fonts.bmfont_xml` byte for byte: insertion order from (0, 0), 1 px spacing with the same row-wrap rule, a power-of-two atlas height, every info attribute (`charset`, `stretchH`, `smooth` and `aa` from `antialias`, `padding`, `spacing`), `xml.sax.saxutils.quoteattr` quoting and no kernings element when there are no kernings. That release pasted a coverage glyph as white with coverage in every channel; supply that RGBA to match it. The Node tests compare against the frozen references in `node/tests/fixtures/bmfont-packed.json`. The returned `{image, xml, metadata}` uses an RGBA buffer rather than a Canvas. Packing copies straight-alpha bytes exactly, including invisible RGB, without rasterization or blending. Callers retain glyph design and metric policy.

`exportBitmapFontFromGlyphs({font, glyphs, output: {png, fnt}})` writes that atlas through the exact RGBA PNG encoder. `font` supplies the same options except `key`, which is derived from output paths. The helper uses the same explicit path validation, relative XML page reference and non-atomic output contract as `exportBitmapFont`. Both helpers and their types are available from `@andornaut/art-kit/generate`; the standalone atlas builder and types are available from `@andornaut/art-kit/glyphAtlas`. The supplied-glyph subpath requires neither Skia nor fontkit; the consolidated generation entry still requires Skia.

See [implementation comparison](docs/implementation-comparison.md) for measured size and font output quality. No consumer assets, font choices or dependency pins change automatically.

## Runtime and checks

Node 24.21.0 or newer with exact peer dependencies `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional peers above. WebP uses the non-SIMD WASM codecs supplied by that peer package. `aseprite` exports require an Aseprite executable. The source fonts and their licences remain in the client repositories.

The `scripts/*.sh` wrappers check their arguments and run `scripts/container.mts` with host Node 24.21.0 or newer, which runs TypeScript through type stripping. The module only orchestrates Docker and copies files on the host. Every check, build and provisioning step runs in a `node:24.21.0` container as the dedicated uid 19001 (`--user 19001:19001 -e HOME=/tmp`), which owns nothing on the host, with four CPUs, a read-only root, no capabilities and no network except while provisioning. Host paths are bind-mounted with `--mount type=bind,...,readonly`, never `-v`, so a missing source fails instead of being created, and must be readable by uid 19001 through their group or world bits; the container receives each mounted path's group. Writable state lives in a per-run named volume at `/tmp`, results are copied out with `docker cp` as the host user, and the container and volume are removed on exit. No host credential store or socket is mounted. Commands start only below one-minute load 24 and discard results when Git status or listed file contents change during the run.

| Command | Effect |
| --- | --- |
| `bash scripts/provision.sh <empty-directory>` | Downloads the pinned dependencies from `node/package.json` into `node/node_modules` |
| `bash scripts/check.sh <node_modules>` | Copies the current tree into the container, compiles it, packs and installs the tarball into `node_modules/@andornaut/art-kit`, checks imports without the optional peers and the declarations, then runs the Node tests against the installed package with `node:test`; evidence goes to a new directory under `.claude/` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds the release artifacts from the committed `HEAD` |

CI runs the same commands. Game projects assume library contracts are correct and test their own adapters and authored output. No game build or generation is part of the package gate.

## Version and licence

The package version is the `version` in `node/package.json`. Compatible fixes increment the patch version; additive public features increment the minor version. Incompatible public API changes require an explicitly coordinated compatibility bump and release notes before consumer migration: increment the minor version before 1.0.0 and the major version thereafter. Never introduce an incompatible change in a patch release. Exact Git revision identifies each payload. Generated assets, fonts and client code retain their existing licences. Extracted helper code in this repository is MIT licensed.

## Released dependency

The public source repository is [andornaut/art-kit](https://github.com/andornaut/art-kit). The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. After publication, consumers pin that URL with the tarball's exact SHA-256 from `SHA256SUMS`, and pin the exact peers, through their own dependency integration, without registry publication or a source fallback. Do not commit placeholder hashes or fetch unpublished URLs. The tarball contains compiled ESM and `.d.ts` files, `LICENSE` and `SOURCE_COMMIT`, not source TypeScript as runtime code. No fonts, Aseprite application data, game assets or local tooling are included.

`bash scripts/pack.sh <node_modules> <empty-directory>` archives the committed `HEAD` and builds offline in a four-CPU container. It emits `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` (covering the tarball and `SOURCE_COMMIT`). Source CI runs the check and pack and uploads those artifacts for review.

Before creating the immutable `v<version>` tag for the version in `node/package.json`, verify that every required CI workflow has completed successfully on the exact release commit on `main`. Publish that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` as GitHub release assets after checking the checksums and a fresh install; do not substitute an earlier artifact. Consumers adopt the published URL and checksum through their own integration process. Tags up to v0.13.0 also carry the retired Python wheel.
