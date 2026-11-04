# art-kit

Shared TypeScript mechanisms for scripted pixel art and atlas builds. Source lives in `node/src` and compiles to the ESM package `@andornaut/art-kit`, released as a GitHub release tarball with no registry publication.

## Boundaries

The package ships TypeScript declarations and these subpaths. Import each explicitly, for example `@andornaut/art-kit/raster`.

| Subpath       | Owns                                                                                     | Client supplies                                                  |
| ------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `atlasBuild`  | Atlas page drawing and encoded page assembly                                             | Read, decode and encode functions, blits, extrusion and metadata |
| `atlasLayout` | Shelf packing and candidate selection                                                    | Items, order comparator, candidate widths and size limits        |
| `build`       | Sequential art builds in dependency order, a byte-snapshot check and its command wrapper | Named build steps, their needs and the check paths               |
| `colour`      | Six-digit hex RGB, WCAG contrast, sRGB to Oklab and OKLCH, and OKLCH to sRGB             | Resolved hex colours and colour triples                          |
| `draw`        | Pillow 13.0.0-exact shape drawing into RGBA buffers                                      | Colours, points, bounds, widths and the target image             |
| `fonts`       | Skia glyph rasterization, line metrics and pair kerning                                  | Font path, size, characters, antialiasing, hinting and kerning   |
| `gif`         | Animated GIF encoding with exact palettes and binary alpha                               | Frames, durations, loop and disposal                             |
| `glyphAtlas`  | BMFont atlas packing and XML for supplied RGBA glyphs                                    | Glyph images, offsets, advances and font metrics                 |
| `grid`        | Pixel-frame drawing, outlines, opaque extents and mirroring                              | Palette, colour names and edge colour rule                       |
| `ico`         | ICO encoding with PNG entries                                                            | One pre-sized RGBA image per entry                               |
| `indexedPng`  | Indexed PNG encoding                                                                     | RGBA image and compression options                               |
| `png`         | PNG decoding to RGBA, and RGBA and opaque RGB PNG encoding                               | Encoded bytes, or an RGBA image and compression options          |
| `quantise`    | Deterministic median-cut reduction to one shared palette                                 | Frames and the colour limit                                      |
| `raster`      | Pillow 13.0.0-exact RGBA operations, frame rendering, sheets and contact sheets          | Images, planes, colours, frames, colour resolver and geometry    |
| `rgbaImage`   | RGBA allocation, alpha bounds and extruded blitting                                      | Image dimensions, pixels, rectangles and bounds                  |
| `spriteSheet` | Sprite sheet PNG and json-hash data byte-identical to Aseprite 1.2.30, without Aseprite  | Key, image name, tags, optional columns and slice margins, paths |
| `webp`        | Lossless WebP encoding                                                                   | RGBA images                                                      |

Geometry and image types are local structural types; the package has no `game-kit` dependency. Clients own palettes and ramps, sprite definitions, font files and glyph policy, camera and depth geometry, manifests, tile sizes, frame tags, grouping, ordering, paths, filenames and Vite asset emission. No module imports a game or discovers its repository from the working directory. Options and context come before the subject; invalid geometry, colours and sizes throw `RangeError`. Only `fonts` needs Skia; every other subpath is canvas-free with exact integer arithmetic.

## Pixel frames and images

A `Frame` is rows of hex colours (opaque) or `null` (clear). An `RgbaImage` is `{ data, width, height }` with straight (non-premultiplied) RGBA bytes; an opaque (RGB) image has alpha 255. A `Tag` is `[name, frames, milliseconds]`, with one duration for every frame or one each.

```ts
import { Grid } from "@andornaut/art-kit/grid";
import { frameToRgba } from "@andornaut/art-kit/raster";

const grid = new Grid({ fill: "ffffff" }, 16, 16, { edge: () => "000000" });
grid.ell(8, 8, 4, 4, "fill");
const image = frameToRgba(grid.palette, grid.outlined());
```

| Export                                                                             | Contract                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grid.Grid`                                                                        | Draws palette names or hex colours into `px`; `outlined()` adds an edge-rule outline. `px`, `w`, `h`, `edge` and `close` are mutable; subclassable       |
| `grid.opaqueRows(frames)`, `opaqueCols(frames)`                                    | First and last rows or columns holding colour across the frames, or `null` when all are clear                                                            |
| `grid.flipped(frame)`                                                              | The frame mirrored left to right                                                                                                                         |
| `raster.frameToRgba(context, frame)`                                               | Resolves through a palette (unlisted names are hex) or a `resolveRgb` callback; `null` is (0,0,0,0)                                                      |
| `raster.composeSheet({ columns, cellWidth, cellHeight }, images)`                  | Row-order cells, RGBA copied exactly and clipped to each cell; unused cells are clear                                                                    |
| `raster.composeContactSheet(options, sprites, grounds)`                            | Opaque preview, one row per sprite and ground; `cellSize` is `"largest-frame"` or `"row-first-frame"`                                                    |
| `raster.fill`, `paste`, `composite`                                                | Mutate the target: replace or coverage-blend a rect, replace or mask-blend a source, straight-alpha source-over                                          |
| `raster.filledImage`, `crop`, `resizeNearest`, `rotateNearest`                     | New images; crop zero-fills outside the source, resampling copies RGBA exactly including RGB under clear alpha                                           |
| `raster.opaque`, `grayscale`, `channel`, `mapChannels`                             | Alpha set to 255, ITU-R 601-2 luma plane, one channel plane, per-channel 256-byte tables                                                                 |
| `draw.point`, `line`, `polygon`, `ellipse`, `rectangle`, `roundedRectangle`, `arc` | Pillow `ImageDraw.Draw(image)` output byte for byte, ink written without blending. `Bounds` corners are inclusive; arcs run clockwise from three o'clock |
| `rgbaImage.blankImage(width, height)`                                              | A clear image                                                                                                                                            |
| `rgbaImage.opaqueRect(within, image)`                                              | Alpha bounds inside `within`, or `undefined` when clear                                                                                                  |
| `rgbaImage.blitExtruded({ from, extrude, at, bounds }, source, target)`            | Copies `from` to `at` with `extrude` pixels of border repeating the edges of `bounds` (default `from`)                                                   |
| `colour.rgb(hex)`                                                                  | Bytes of exactly six hex digits without `#`; any other string throws                                                                                     |
| `colour.contrast`, `srgbToOklab`, `srgbToOklch`, `oklchToSrgb`                     | WCAG contrast ratio and colour-space conversion; `oklchToSrgb` reduces chroma at fixed lightness and hue to reach the gamut                              |

The `raster` and `draw` fixtures in `node/tests/fixtures` are frozen Pillow 13.0.0 output, including partial alpha, and the tests compare every operation byte for byte.

## Encoders and atlases

| Export                                                                    | Contract                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `png.decodePng(bytes)`                                                    | RGBA image                                                                                                                                                                 |
| `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` | The bytes pngjs 7.0.0 `PNG.sync.write` writes, streamed row by row                                                                                                         |
| `png.encodeRgbPng(options, image)`                                        | Colour type 2 bytes, as pngjs writes them; throws when any alpha is not 255                                                                                                |
| `indexedPng.encodeIndexedPng({ level, memLevel }, image)`                 | Indexed PNG bytes, or `undefined` above 256 RGBA colours                                                                                                                   |
| `webp.encodeLosslessWebp(image)`                                          | Lossless WebP through the non-SIMD WASM codec of `@jsquash/webp`                                                                                                           |
| `gif.encodeGif({ durations, loop, disposal }, frames)`                    | Animated GIF; durations stored in hundredths, truncated                                                                                                                    |
| `ico.encodeIco(images)`                                                   | ICO with one PNG entry per image                                                                                                                                           |
| `quantise.quantise({ maxColours }, frames)`                               | One shared median-cut palette and the remapped frames                                                                                                                      |
| `spriteSheet.spriteSheet({ key, image, columns, margins }, tags)`         | `{ sheet, data }`: the PNG and json-hash text that Aseprite 1.2.30's command-line sheet export writes, byte for byte, including its zlib deflate stream                    |
| `spriteSheet.writeSpriteSheet({ sheet, data }, options, tags)`            | Writes both files, creating directories, with the sheet's file name as `meta.image`                                                                                        |
| `atlasLayout.packAtlas(policy, items)`                                    | Items sorted by `compare` and shelf-packed at each candidate width, each item on one page; the candidate with fewest pages, then least area, or `undefined` when none fits |
| `atlasBuild.drawAtlasPage(extrude, images, page)`                         | One page of extruded blits                                                                                                                                                 |
| `atlasBuild.buildAtlasPages(dependencies, pages)`                         | Reads, decodes, draws and encodes each page with the supplied functions                                                                                                    |

Callers choose indexed-first fallback, PNG versus WebP and output metadata. The sprite sheet tests compare with frozen Aseprite exports in `node/tests/fixtures/sprite-sheet`.

## Builds

`build` runs a game's art build sets one at a time. The module uses only Node built-ins and spawns nothing.

| Export                                                       | Contract                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BuildSets`                                                  | Set name to `{ build, needs? }`; `needs` names the sets whose outputs it reads                                                                                                                             |
| `buildOrder(sets, selected?)`                                | Each set after its needs, ties in declaration order. Selected sets run with everything downstream, not their needs. Unknown needs and cycles throw `RangeError`; unknown selected names throw `UsageError` |
| `runBuilds({ sets, check?, log? }, selected?)`               | Logs `build <set>` before each and resolves to `{ changes?, order }`. A failing build throws `BuildError` with `set` and `cause`                                                                           |
| `check: { paths }`                                           | SHA-256 snapshot of every file under each path before and after (symbolic links by target); any difference throws `CheckError` with sorted `{ added, changed, removed }`                                   |
| `buildCommand({ sets, check?, usage?, log?, error? }, argv)` | `[--check] [SET...]`; resolves to 0, 1 for a failing build, check differences or invalid sets, or 2 for a usage error followed by `usage`                                                                  |

The check compares the tree before and after the rebuild without Git, so it works in a copy with no `.git`. It ignores differences that existed before the run and includes ignored files under the check paths: run it on a clean checkout to compare the rebuild with the committed outputs. Relative paths resolve against the working directory.

```ts
import { buildCommand } from "@andornaut/art-kit/build";

process.exitCode = await buildCommand(
  {
    check: { paths: ["public/art"] },
    sets: {
      silhouettes: { build: silhouettes.build, needs: ["sprites"] },
      sprites: { build: sprites.build },
    },
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
| `glyphAtlas.buildBitmapFontFromGlyphs(options, glyphs)`                          | `{ image, metadata, xml }`: glyphs packed in insertion order with BMFont XML; bytes copied exactly, without blending. Atlas height is limited to 16384 px                                                                                                  |
| `layout: "padded"` (default)                                                     | Insets and spaces glyphs by `padding` (default 1), fits the height to the last row and always writes a kernings element                                                                                                                                    |
| `layout: "packed"`                                                               | Requires `antialias`, rejects `padding`: 1 px spacing from (0, 0), a power-of-two height, every info attribute, and no kernings element when there are none                                                                                                |

Antialiasing and hinting default to true; synthesis and cross-glyph substitutions are disabled. Skia may substitute a system font for characters the file lacks. The tests run both games' font pipelines over the fixture fonts and compare them byte for byte with frozen references in `node/tests/fixtures/fonts` and `node/tests/fixtures/bmfont-packed.json`.

```ts
import { writeFile } from "node:fs/promises";

import { rasteriseGlyphs } from "@andornaut/art-kit/fonts";
import { buildBitmapFontFromGlyphs } from "@andornaut/art-kit/glyphAtlas";
import { encodeRgbaPng } from "@andornaut/art-kit/png";

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

## Runtime and checks

Node 24.21.0 or newer with the exact peers `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas@4.0.0` for `fonts`. Source fonts and their licences stay in the client repositories.

The `scripts/*.sh` wrappers run `scripts/container.mts` with host Node through type stripping; it only orchestrates Docker and copies files. Every check, build and download runs in a `node:24.21.0` container as uid 19001 (`--user 19001:19001 -e HOME=/tmp`), which owns nothing on the host, with four CPUs, a read-only root, no capabilities and no network except while provisioning. Host paths are bind-mounted read-only with `--mount`, never `-v`, and must be readable by uid 19001 through their group or world bits. Writable state lives in a per-run volume at `/tmp`, results leave through `docker cp`, and the container and volume are removed on exit. Commands start only below one-minute load 24 and discard results when Git status or file contents change during the run.

| Command                                                 | Effect                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/provision.sh <empty-directory>`           | Downloads the pinned dependencies from `node/package.json` into `<empty-directory>/node/node_modules`                                                                                                                           |
| `bash scripts/check.sh <node_modules>`                  | Copies the working tree, runs `prettier --check` and `eslint --max-warnings 0`, compiles, packs and installs the tarball, imports every subpath (all but `fonts` without Skia), checks the declarations and runs the Node tests |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` from the committed `HEAD`                                                                                                                                      |

Formatting follows `.prettierrc`; `node/tests/fixtures` is excluded because the tests compare it byte for byte. Lint rules are in `eslint.config.mjs` and the shared `eslint.config.base.mjs`. CI runs the same three commands and uploads the pack output. Game projects test their own adapters and authored output; no game build is part of the package gate.

## Version and licence

The package version is the `version` in `node/package.json`. Compatible fixes increment the patch version and additive features the minor version. An incompatible public API change needs a coordinated bump and release notes before consumers migrate: the minor version before 1.0.0, the major version after. The exact Git revision identifies each payload. Helper code here is MIT licensed; test fonts keep their SIL OFL licence and are excluded from release artifacts. Generated assets, fonts and client code keep their own licences.

## Released dependency

The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. Consumers pin that URL with the tarball's SHA-256 from `SHA256SUMS`, plus the exact peers, through their own dependency integration. The tarball holds compiled ESM, `.d.ts` files, `LICENSE` and `SOURCE_COMMIT`; no source, fonts, game assets or tooling.

Tag `v<version>` only after every required CI workflow has passed on the exact release commit on `main`. Publish that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` as release assets after checking the checksums and a fresh install.
