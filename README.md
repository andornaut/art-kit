# art-kit

Shared TypeScript mechanisms for scripted pixel art and atlas builds. Source lives in `node/src` and compiles to the ESM package `@andornaut/art-kit`, released as a GitHub release tarball with no registry publication.

## Boundaries

The compiled package includes TypeScript declarations and these public subpaths:

| Subpath | Owns | Client supplies |
| --- | --- | --- |
| `atlasBuild` | Atlas drawing and encoded page assembly | Read/decode/encode functions, blits, extrusion and metadata |
| `atlasLayout` | Shelf packing and candidate selection | Items, grouping, order comparator, candidate widths and size limits |
| `build` | Sequential art build runs in dependency order, downstream selection, a byte-snapshot `--check` and a `[--check] [SET...]` command wrapper | Named build steps, their needs and the check paths |
| `colour` | Six-digit hex RGB, WCAG contrast, sRGB to Oklab and OKLCH, and OKLCH to sRGB | Resolved hex colours, sRGB triples and OKLCH triples |
| `draw` | Polygon, ellipse, line, arc, point, rectangle and rounded-rectangle drawing into RGBA buffers, pixel-exact with Pillow 13.0.0 | Colours, points, bounds, widths and the target image |
| `fonts` | Skia glyph rasterization, line metrics and pair kerning | Font path, size, characters, antialiasing, hinting and kerning policy |
| `gif` | Animated GIF encoding with exact palettes and binary alpha | Frames, durations, loop and disposal |
| `glyphAtlas` | Atlas packing and BMFont XML for supplied RGBA glyphs | Glyph images, offsets, advances and font metrics |
| `grid` | Shape drawing, outline traversal, opaque extents and reflection of pixel frames | Palette, colour names and edge colour rule |
| `ico` | ICO encoding with PNG entries | One pre-sized RGBA image per entry |
| `indexedPng` | Indexed PNG encoding | RGBA image and compression options |
| `png` | PNG decoding to RGBA, RGBA PNG encoding and opaque RGB PNG encoding | Encoded bytes or an RGBA image and compression options |
| `quantise` | Deterministic median-cut reduction to one shared palette | Frames and the colour limit |
| `raster` | Straight-alpha RGBA fill, paste, compositing, crop, nearest resize and rotation, channel extraction and mapping, frame rendering, sheets and contact sheets, and the frame, tag and sprite types | Images, planes, colours, frames, colour resolver, positions, rectangles, sizes, angles and channel tables |
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

A client can subclass `Grid` to retain its existing constructor and outline signature. `px`, `w`, `h`, `edge` and `close` are mutable. An `Edge` rule returns the outline colour for a clear pixel beside a colour, or `null` to leave it clear. `opaqueRows(frames)` and `opaqueCols(frames)` return the first and last rows or columns holding any colour across the frames, or `null` when all are clear, and `flipped(frame)` mirrors a frame left to right.

`spriteSheet.spriteSheet({ key, image, columns, margins }, tags)` returns `{ sheet, data }`: the PNG bytes and json-hash text that Aseprite 1.2.30's command-line sheet export writes, byte for byte, with no executable, source file or filesystem access. A `Tag` (defined in `raster` and re-exported here) is `[name, frames, milliseconds]`, with one duration for every frame or one each; every frame has the first frame's size, and every pixel is a hex colour (opaque) or `null` (clear), so the palette is not needed. Frames run left to right in tag order, in one row or wrapping after `columns`. `key` names the frames `<key> <index>.aseprite` (`<key>.aseprite` when there is one frame) and the slice; `image` is written as `meta.image`. `margins: [left, top, right, bottom]` adds `meta.slices` with one slice over frame 0 whose centre lies inside the margins; they are whole pixels that leave a centre. Durations are stored as Aseprite stores them: truncated to whole milliseconds within 1..65535, so 1001 becomes 1000. Invalid columns, margins, durations or frame sizes throw `RangeError`. `writeSpriteSheet({ sheet, data }, { key, columns, margins }, tags)` writes both files, creating their directories, with the sheet's file name as `meta.image`. The PNG is colour type 6 with an `sRGB` chunk, libpng 1.6.38's filter choice and IDAT chunking, and the deflate stream of the Chromium zlib inside Aseprite 1.2.30 on an x86-64 CPU with SSE4.2 and PCLMUL, which differs from `node:zlib` and upstream zlib. The Node tests compare it with the frozen Aseprite exports in `node/tests/fixtures/sprite-sheet`. It does not need Skia.

`rgbaImage.opaqueRect(within, image)` returns the alpha bounds within the supplied rectangle, or `undefined` when that region is clear. Callers choose trimming and clear-frame handling. `blitExtruded({ from, extrude, at, bounds }, source, target)` copies the `from` rect of `source` to `at` in `target` with `extrude` pixels of border on every side, repeating the edge pixels of `bounds` (the whole frame a trimmed rect was cut from, defaulting to `from`).

`raster` operates on straight (non-premultiplied) `RgbaImage` buffers with exact integer rounding and no canvas or Skia dependency; an opaque (RGB) image is one whose alpha is 255. Pillow 13.0.0 is the parity reference: the frozen fixtures in `node/tests/fixtures/raster` must match byte for byte, including partial alpha. Options and context precede the subject image, and every operation clips to the image on all sides. `fill({rect, mask?}, rgba, image)`, `paste({at, mask?, keepAlpha?}, source, image)` and `composite(at, source, image)` mutate `image`; every other function returns a new image or plane. `fill` replaces the rect, or with an 8-bit `Plane` mask sized to the rect blends each channel by coverage; a fully transparent pixel takes the full colour in RGB wherever coverage is nonzero. `paste` replaces target pixels, or with a mask plane sized to the source (or `"alpha"` for the source's own alpha) blends from target to source by the mask value; `keepAlpha: true` writes RGB only, for opaque targets. `composite` is straight-alpha source-over. `frameToRgba(context, frame)` resolves a frame through a palette (names not in it are hex colours) or a `resolveRgb` callback: `null` cells are (0,0,0,0) and the rest opaque. `composeSheet({columns, cellWidth, cellHeight}, images)` places images in row order, one per cell, copying RGBA exactly and clipping each to its cell; unused cells are clear. `crop` zero-fills outside the source. `resizeNearest(width, height, image)` samples nearest pixel centres and replicates pixels exactly at integer factors; `rotateNearest(angle, image)` rotates counter-clockwise about the centre at the same size, leaving uncovered pixels clear. Both copy RGBA exactly, including RGB under clear alpha. `grayscale` returns ITU-R 601-2 luma, `channel(index, image)` one channel, `opaque` a copy with alpha 255 and RGB kept, and `mapChannels(luts, image)` a copy with each channel mapped through its 256-byte table. `composeContactSheet({resolveRgb, background, cellSize, scale, gap}, sprites, grounds)` builds the preview in memory, so its size is not limited by a canvas. `cellSize` is required: `"largest-frame"` sizes every cell from the largest frame and draws each frame over its ground; `"row-first-frame"` takes cell width from the widest first frame and each row's height from its first frame, paints empty cells in the ground colour and lets later frames overwrite earlier overflow. Invalid geometry, colours, channel indexes, tables and plane sizes throw `RangeError`.

`draw` renders shapes into `RgbaImage` buffers with output byte-identical to Pillow 13.0.0 `ImageDraw.Draw(image)`, without Skia. Style precedes geometry and the image comes last; each call mutates the image: `point(rgba, points, image)`, `line({fill, width, joint}, points, image)`, `polygon({fill, outline, width}, points, image)`, `ellipse`, `rectangle` and `roundedRectangle` with `({fill, outline, width}, bounds, image)` (`roundedRectangle` also takes `radius` and optional `corners`), and `arc({fill, width}, bounds, start, end, image)` with degrees clockwise from three o'clock. Colours are `raster` `Rgba` values written directly, without blending; for an opaque (RGB) target, use alpha 255. Points are `{x, y}` objects and `Bounds` is `{x0, y0, x1, y1}` with inclusive corner pixels, so `x0 = x1` is one pixel wide. Fractional coordinates are truncated toward zero, and `roundedRectangle` rounds its bounds half to even first. A shape given neither fill nor outline draws a white outline, and an outline equal to the fill is skipped. Pillow mode `"L"` and `"1"` targets cover the same pixels as RGBA (for `"1"`, one ink per shape), so a mask is any channel of a white-on-clear RGBA drawing. Bounds with `x1 < x0` or `y1 < y0`, or an ellipse, arc or rounded corner spanning 8192 pixels or more, throw `RangeError`. The Node tests compare every operation exactly with the frozen Pillow fixtures in `node/tests/fixtures/draw.json`.

`indexedPng.encodeIndexedPng({ level, memLevel }, image)` returns encoded bytes, or `undefined` when the image has more than 256 distinct RGBA colours. `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` returns RGBA PNG bytes. `png.encodeRgbPng` takes the same options and returns colour type 2 bytes that decode to the image, throwing `RangeError` when any alpha is not 255; bytes are not matched to Pillow. Both write the bytes pngjs 7.0.0 `PNG.sync.write` writes for the same options. They filter rows straight from `image.data` into a streamed deflate, so memory beyond the input is the compressed output plus a few rows; deflate level 0 and inputs pngjs treats specially go through pngjs. Compression context precedes the image; callers choose indexed-first fallback, PNG versus WebP and output metadata.

`colour.rgb(hex)` returns the bytes of exactly six hexadecimal digits without `#` and throws `RangeError` for any other string. `colour.srgbToOklab(rgb)` and `srgbToOklch(rgb)` return Oklab and OKLCH triples. `oklchToSrgb(lch)` clamps lightness to 0..1, limits chroma to the search bound, wraps hue in degrees and reduces out-of-gamut chroma at fixed lightness and hue, then clamps linear channels and quantizes to bytes. Neutral hue is zero. Palette targets and perceptual contrast policy remain caller-owned.

## Builds

`build` runs a game's art build sets one at a time. `BuildSets` maps each set name to `{ build, needs? }`, where `build` returns nothing or a promise and `needs` names the sets whose outputs it reads. `buildOrder(sets, selected?)` returns the run order: each set after every set it needs, with ties broken by declaration (insertion) order, so the earliest-declared ready set runs next; a table declared in a valid order runs in exactly that order. Selected names run with every set downstream of them, directly or transitively, in the same order; the sets they need are not rebuilt. An unknown need or a cycle throws `RangeError` naming them (`a needs unknown set b`, `build sets form a cycle: a -> c -> b -> a`), and unknown selected names throw `UsageError`.

`runBuilds({ sets, check?, log? }, selected?)` logs `build <set>` before each set and resolves to `{ order, changes? }`. A build that throws or rejects stops the run with `BuildError`, whose `set` names it and whose `cause` is the original error. With `check: { paths }`, the files under each path (a file or a directory, recursively; a missing path holds none) are snapshotted by SHA-256 before the first build and after the last, symbolic links by target, and any added, removed or changed path throws `CheckError` with `changes: { added, removed, changed }`, each sorted. Paths are reported joined to the check path as given, and relative paths resolve against the process working directory.

The check compares the tree before and after the rebuild, without Git, so it works in a copy with no `.git`. Unlike a check against the Git index, it does not flag a difference or untracked file that existed before the run and that the rebuild leaves unchanged, and it does include ignored files under the check paths. Run it on a clean checkout to compare the rebuild with the committed outputs.

`buildCommand({ sets, check?, usage?, log?, error? }, argv)` handles `[--check] [SET...]` and resolves to an exit status: 0 on success; 1 for a failing build (the cause's stack, then `<set> build failed: <message>`), check differences (`A`, `D` or `M`, a tab and the path, sorted by path, then a summary) or invalid sets; and 2 for a usage error (an unknown option or set, or `--check` without check paths), followed by `usage`. `log` and `error` default to `console.log` and `console.error`. The module uses only Node built-ins and spawns nothing; a step that runs another program spawns it itself.

```ts
import { buildCommand } from '@andornaut/art-kit/build';

process.exitCode = await buildCommand({
  sets: {
    sprites: { build: sprites.build },
    silhouettes: { build: silhouettes.build, needs: ['sprites'] },
  },
  check: { paths: ['public/art'] },
  usage: 'Usage: node art/tools/build.ts [--check] [SET...]',
}, process.argv.slice(2));
```

## Fonts

`fonts` is the only subpath that renders through CPU Skia and needs the optional exact peer `skia-canvas@4.0.0`; it belongs in Node art/build scripts, not browser bundles. Every other subpath, `raster` frame rendering and composition included, is canvas-free.

`fonts.rasteriseGlyphs({path, size, characters, antialias, hinting, kerning})` returns `{glyphs, base, lineHeight, ascent, descent, kernings}`. `glyphs` maps each unique character, in order, to a `glyphAtlas` `SuppliedBitmapGlyph`: the glyph drawn alone in white and trimmed to the pixels Skia covers, whose RGB is white and alpha the coverage, every other pixel (0,0,0,0), or `undefined` without ink, with integer `xoffset` from the pen, `yoffset` from the line's top and rounded `xadvance`. `base` is the face's ascent rounded up, which `yoffset` counts from, and `lineHeight` the ascent plus descent rounded up; `ascent` and `descent` are Skia's unrounded font-box values for callers with their own line policy. Antialiasing and hinting default to true; synthesis and cross-glyph ligature/contextual substitutions are disabled. Font files remain immutable after registration, and Skia may substitute a system fallback font for characters the file lacks. `kerning: "all"` evaluates all ordered pairs for at most 256 unique characters and returns nonzero integer adjustments as `GlyphKerning` values; the default `"none"` returns none.

```ts
import { rasteriseGlyphs } from '@andornaut/art-kit/fonts';
import { buildBitmapFontFromGlyphs } from '@andornaut/art-kit/glyphAtlas';
import { encodeRgbaPng } from '@andornaut/art-kit/png';
import { writeFile } from 'node:fs/promises';

const { glyphs, base, lineHeight, kernings } = rasteriseGlyphs({
  path: 'body.ttf', size: 16, characters: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ', kerning: 'all',
});
const font = buildBitmapFontFromGlyphs(
  { key: 'body', face: 'Body', size: 16, base, lineHeight, atlasWidth: 256, kernings }, glyphs,
);
await writeFile('body.png', encodeRgbaPng({ deflateLevel: 9, deflateStrategy: 3, filterType: -1 }, font.image));
await writeFile('body.fnt', font.xml);
```

The Node tests run both games' font pipelines (rasterize, adjust and pack) over the fixture fonts and compare them byte for byte with frozen references in `node/tests/fixtures/fonts`.

`glyphAtlas.buildBitmapFontFromGlyphs(options, glyphs)` packs a `ReadonlyMap<string, SuppliedBitmapGlyph>` in insertion order. Each supplied glyph contains a structural RGBA `image` (or `undefined` for empty ink), signed integer `xoffset`/`yoffset` and integer `xadvance`. Options explicitly supply `key`, `face`, `size`, `base`, `lineHeight` and `atlasWidth`, with optional `kernings`; the atlas height is limited to 16384 px. `layout` selects the placement and XML shape, and `metadata.layout` reports it. `"padded"` (the default) insets and spaces glyphs by `padding` (default 1), fits the atlas height to the last row and always writes a kernings element. `"packed"` requires a boolean `antialias` and rejects `padding`: insertion order from (0, 0), 1 px spacing with a glyph wrapping when it and its trailing spacing pixel overflow the row, a power-of-two atlas height, every info attribute (`charset`, `stretchH`, `smooth` and `aa` from `antialias`, `padding`, `spacing`), single-quoted attributes for values that hold double but no single quotes, and no kernings element when there are no kernings. The Node tests compare it byte for byte with the frozen references in `node/tests/fixtures/bmfont-packed.json`, whose coverage glyphs are white with coverage in every channel. The returned `{image, xml, metadata}` uses an RGBA buffer. Packing copies straight-alpha bytes exactly, including invisible RGB, without rasterization or blending. Callers retain glyph design and metric policy and encode the atlas themselves, for example with `png.encodeRgbaPng`. The subpath does not require Skia.

See [implementation comparison](docs/implementation-comparison.md) for measured size and font output quality.

## Runtime and checks

Node 24.21.0 or newer with exact peer dependencies `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas` peer for `fonts`. WebP uses the non-SIMD WASM codecs supplied by that peer package. The source fonts and their licences remain in the client repositories.

The `scripts/*.sh` wrappers check their arguments and run `scripts/container.mts` with host Node 24.21.0 or newer, which runs TypeScript through type stripping. The module only orchestrates Docker and copies files on the host. Every check, build and provisioning step runs in a `node:24.21.0` container as the dedicated uid 19001 (`--user 19001:19001 -e HOME=/tmp`), which owns nothing on the host, with four CPUs, a read-only root, no capabilities and no network except while provisioning. Host paths are bind-mounted with `--mount type=bind,...,readonly`, never `-v`, so a missing source fails instead of being created, and must be readable by uid 19001 through their group or world bits; the container receives each mounted path's group. Writable state lives in a per-run named volume at `/tmp`, results are copied out with `docker cp` as the host user, and the container and volume are removed on exit. No host credential store or socket is mounted. Commands start only below one-minute load 24 and discard results when Git status or listed file contents change during the run.

| Command | Effect |
| --- | --- |
| `bash scripts/provision.sh <empty-directory>` | Downloads the pinned dependencies from `node/package.json` into `node/node_modules` |
| `bash scripts/check.sh <node_modules>` | Copies the current tree into the container, compiles it, packs and installs the tarball into `node_modules/@andornaut/art-kit`, checks that every subpath except `fonts` imports without the optional Skia peer, checks the declarations, then runs the Node tests against the installed package with `node:test`; evidence goes to a new directory under `.claude/` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds the release artifacts from the committed `HEAD` |

CI runs the same commands. Game projects assume library contracts are correct and test their own adapters and authored output. No game build or generation is part of the package gate.

## Version and licence

The package version is the `version` in `node/package.json`. Compatible fixes increment the patch version; additive public features increment the minor version. Incompatible public API changes require an explicitly coordinated compatibility bump and release notes before consumer migration: increment the minor version before 1.0.0 and the major version thereafter. Never introduce an incompatible change in a patch release. Exact Git revision identifies each payload. Generated assets, fonts and client code retain their existing licences. Extracted helper code in this repository is MIT licensed.

## Released dependency

The public source repository is [andornaut/art-kit](https://github.com/andornaut/art-kit). The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. After publication, consumers pin that URL with the tarball's exact SHA-256 from `SHA256SUMS`, and pin the exact peers, through their own dependency integration, without registry publication or a source fallback. Do not commit placeholder hashes or fetch unpublished URLs. The tarball contains compiled ESM and `.d.ts` files, `LICENSE` and `SOURCE_COMMIT`, not source TypeScript as runtime code. No fonts, game assets or local tooling are included.

`bash scripts/pack.sh <node_modules> <empty-directory>` archives the committed `HEAD` and builds offline in a four-CPU container. It emits `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` (covering the tarball and `SOURCE_COMMIT`). Source CI runs the check and pack and uploads those artifacts for review.

Before creating the immutable `v<version>` tag for the version in `node/package.json`, verify that every required CI workflow has completed successfully on the exact release commit on `main`. Publish that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` as GitHub release assets after checking the checksums and a fresh install; do not substitute an earlier artifact. Consumers adopt the published URL and checksum through their own integration process.
