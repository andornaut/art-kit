# art-kit

Shared TypeScript mechanisms for scripted pixel art and atlas builds. Source lives in `node/src` and compiles to the ESM package `@andornaut/art-kit`, released as a GitHub release tarball with no registry publication.

## Boundaries

The package ships TypeScript declarations and these subpaths. Import each explicitly, for example `@andornaut/art-kit/raster`.

| Subpath       | Owns                                                                                                                                      | Client supplies                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `atlasBuild`  | Atlas page drawing and encoded page assembly                                                                                              | Read, decode and encode functions, blits, extrusion and metadata         |
| `atlasLayout` | Shelf packing and candidate selection                                                                                                     | Items, order comparator, candidate widths and size limits                |
| `build`       | Sequential art builds in dependency order, set table self-checks, snapshot and Git index checks, node process steps and a command wrapper | Named build steps, their needs, the module directory and the check paths |
| `colour`      | Six-digit hex RGB, WCAG contrast, sRGB to Oklab and OKLCH, and OKLCH to sRGB                                                              | Resolved hex colours and colour triples                                  |
| `draw`        | Pillow 13.0.0-exact shape drawing into RGBA buffers                                                                                       | Colours, points, bounds, widths and the target image                     |
| `fonts`       | Skia glyph rasterization, font coverage, line metrics and pair kerning                                                                    | Font path, size, characters, antialiasing, hinting and kerning           |
| `gif`         | Animated GIF encoding with exact palettes and binary alpha                                                                                | Frames, durations and loop                                               |
| `glyphAtlas`  | BMFont atlas packing and XML for supplied RGBA glyphs                                                                                     | Glyph images, offsets, advances and font metrics                         |
| `grid`        | Pixel-frame drawing, outlines, opaque extents and mirroring                                                                               | Palette, colour names and edge colour rule                               |
| `ico`         | ICO encoding with PNG entries                                                                                                             | One pre-sized RGBA image per entry                                       |
| `indexedPng`  | Indexed PNG encoding                                                                                                                      | RGBA image and compression options                                       |
| `png`         | PNG decoding to RGBA, and RGBA and opaque RGB PNG encoding                                                                                | Encoded bytes, or an RGBA image and compression options                  |
| `raster`      | Pillow 13.0.0-exact RGBA operations, frame rendering, sheets and contact sheets                                                           | Images, planes, colours, frames, colour resolver and geometry            |
| `rgbaImage`   | RGBA allocation, alpha bounds and extruded blitting                                                                                       | Image dimensions, pixels, rectangles and bounds                          |
| `spriteSheet` | Sprite sheet PNG and json-hash data byte-identical to Aseprite 1.2.30, without Aseprite                                                   | Key, image name, tags, optional columns and slice margins, paths         |
| `webp`        | Lossless WebP encoding                                                                                                                    | RGBA images                                                              |

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
| `raster.opaque`, `grayscale`, `channel`                                 | Alpha set to 255, ITU-R 601-2 luma plane, one channel plane                                                                                                             |
| `draw.point`, `line`, `polygon`, `ellipse`, `rectangle`, `arc`          | Pillow `ImageDraw.Draw(image)` output byte for byte, ink written without blending. `Bounds` corners are inclusive; arcs run clockwise from three o'clock                |
| `rgbaImage.blankImage(width, height)`                                   | A clear image                                                                                                                                                           |
| `rgbaImage.opaqueRect(within, image)`                                   | Alpha bounds inside `within`, or `undefined` when clear                                                                                                                 |
| `rgbaImage.blitExtruded({ from, extrude, at, bounds }, source, target)` | Copies `from` to `at` with `extrude` pixels of border repeating the edges of `bounds` (default `from`)                                                                  |
| `colour.rgb(hex)`                                                       | Bytes of exactly six hex digits without `#`; any other string throws                                                                                                    |
| `colour.contrast`, `srgbToOklab`, `srgbToOklch`, `oklchToSrgb`          | WCAG contrast ratio and colour-space conversion; `oklchToSrgb` reduces chroma at fixed lightness and hue to reach the gamut                                             |

The `raster` and `draw` fixtures in `node/tests/fixtures` are frozen Pillow 13.0.0 output, including partial alpha, and the tests compare every operation byte for byte.

## Encoders and atlases

| Export                                                                    | Contract                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `png.decodePng(bytes)`                                                    | RGBA image                                                                                                                                                                 |
| `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` | The bytes pngjs 7.0.0 `PNG.sync.write` writes, streamed row by row                                                                                                         |
| `png.encodeRgbPng(options, image)`                                        | Colour type 2 bytes, as pngjs writes them; throws when any alpha is not 255                                                                                                |
| `indexedPng.encodeIndexedPng({ level, memLevel }, image)`                 | Indexed PNG bytes, or `undefined` above 256 RGBA colours                                                                                                                   |
| `webp.encodeLosslessWebp(image)`                                          | Lossless WebP through the non-SIMD WASM codec of `@jsquash/webp`                                                                                                           |
| `gif.encodeGif({ durations, loop }, frames)`                              | Animated GIF with unspecified disposal; durations stored in hundredths, truncated                                                                                          |
| `ico.encodeIco(images)`                                                   | ICO with one PNG entry per image                                                                                                                                           |
| `spriteSheet.spriteSheet({ key, image, columns, margins }, tags)`         | `{ sheet, data }`: the PNG and json-hash text that Aseprite 1.2.30's command-line sheet export writes, byte for byte, including its zlib deflate stream                    |
| `spriteSheet.writeSpriteSheet({ sheet, data }, options, tags)`            | Writes both files, creating directories, with the sheet's file name as `meta.image`                                                                                        |
| `atlasLayout.packAtlas(policy, items)`                                    | Items sorted by `compare` and shelf-packed at each candidate width, each item on one page; the candidate with fewest pages, then least area, or `undefined` when none fits |
| `atlasBuild.drawAtlasPage(extrude, images, page)`                         | One page of extruded blits                                                                                                                                                 |
| `atlasBuild.buildAtlasPages(dependencies, pages)`                         | Reads, decodes, draws and encodes each page with the supplied functions                                                                                                    |

Callers choose indexed-first fallback, PNG versus WebP and output metadata. The sprite sheet tests compare with frozen Aseprite exports in `node/tests/fixtures/sprite-sheet`.

## Builds

`build` runs a game's art build sets one at a time. The module uses only Node built-ins; it spawns a process only for a `nodeBuild` step and runs `git` only for a check with `index: true`.

| Export                                                                               | Contract                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BuildSets`                                                                          | Set name to `{ build, needs? }`; `needs` names the sets whose outputs it reads                                                                                                                                                      |
| `buildOrder(sets, selected?)`                                                        | Each set after its needs, ties in declaration order. Selected sets run with everything downstream, not their needs. Unknown needs and cycles throw `RangeError`; unknown selected names throw an error named `UsageError`           |
| `checkSets({ strictOrder?, modules? }, sets)`                                        | Startup self-checks, all off by default; every problem found is listed in one `RangeError`                                                                                                                                          |
| `runBuilds({ sets, check?, strictOrder?, modules?, log? }, selected?)`               | Runs `checkSets`, then logs `build <set>` before each and resolves to `{ changes?, order }`. A failing build throws an error named `BuildError` with `set` and `cause`                                                              |
| `check: { paths, index? }`                                                           | SHA-256 snapshot of every file under each path before and after (symbolic links by target); any difference throws an error named `CheckError` whose `changes` holds sorted `{ added, changed, removed }` (and `dirty`, `untracked`) |
| `nodeBuild({ directory, extension?, args? }, set)`                                   | A build step running `node <directory>/<set><extension> ...args` (defaults `.ts` and `["build"]`) with `process.execPath` and inherited stdio; throws `exit <status>` or `signal <name>`                                            |
| `buildCommand({ sets, check?, strictOrder?, modules?, usage?, log?, error? }, argv)` | `[--check] [SET...]`; resolves to 0, 1 for a failed self-check, a failing build, check differences or invalid sets, or 2 for a usage error followed by `usage`                                                                      |

### Self-checks

`strictOrder: true` requires the declared order to meet every need and throws `<set> is declared before <need>, which it needs` instead of reordering; a table that passes runs in declaration order. `modules: { directory, nonSets, extension? }` reconciles a directory of one module per set (`.ts` by default) with the table: it lists each module that is neither a set nor in `nonSets`, each set or non-set without a module, and each name listed as both. Both are off by default so tables built in process, without modules or with a dependent declared first, keep working. `buildCommand` runs them after `--help` and before parsing the sets, so a failed self-check exits 1 even when the arguments also hold an unknown set.

### Command line

A sole `--help` or `-h` prints `usage` (or `Usage: [--check] [SET...]` when none is given) through `log`, which defaults to stdout, and returns 0 without running the self-checks. With other arguments either is an unknown option, exit 2.

### Check modes

The default check compares the tree before and after the rebuild without Git, so it works in a copy with no `.git`. It ignores differences that existed before the run and includes ignored files under the check paths: run it on a clean checkout to compare the rebuild with the committed outputs. Relative paths resolve against the working directory.

`index: true` adds the Git index state from before the run: tracked files under the check paths whose working tree content differs from the index (`dirty`, printed as `~\tpath`) and untracked files that `.gitignore` does not exclude (`untracked`, printed as `?\tpath`), keyed like the snapshot. Staged changes count as clean and ignored files are skipped. A pass then means the tree under the check paths matched the index before the run and the rebuild changed nothing, so it also works on a dirty checkout. It runs `git` in the working directory without taking the index lock; Git must be on `PATH` and must trust the repository (`safe.directory` when the checkout belongs to another user), and a Git failure propagates as an `Error`.

```ts
import { buildCommand, nodeBuild } from "@andornaut/art-kit/build";

const tools = { directory: "art/tools" };
process.exitCode = await buildCommand(
  {
    check: { paths: ["public/art"] },
    modules: { ...tools, nonSets: ["build", "pixel"] },
    sets: {
      sprites: { build: nodeBuild(tools, "sprites") },
      silhouettes: { build: nodeBuild(tools, "silhouettes"), needs: ["sprites"] },
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

Antialiasing and hinting default to true; synthesis and cross-glyph substitutions are disabled. Requiring every character in the file's cmap keeps Skia from substituting a system font. The tests run both games' font pipelines over the fixture fonts and compare them byte for byte with frozen references in `node/tests/fixtures/fonts` and `node/tests/fixtures/bmfont-packed.json`.

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

Node 24.22.2 or newer with the exact peers `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas@4.0.0` for `fonts`. Source fonts and their licences stay in the client repositories.

Automation and CI use `make check` for the full package gate: lint, test and build. `make lint`, `make test` and `make build` run one phase; only `make build` writes into the checkout, replacing ignored `node/dist`. Format and TypeScript checks belong to lint; test builds and installs the package before testing its public imports. Checks do not publish or change the package version or consumer assets.

The npm commands run directly on the host, without Make or Docker:

| Command                       | Effect                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm --prefix node run check` | Runs native lint, test and build                                                                 |
| `npm --prefix node run lint`  | Runs formatting, ESLint, TypeScript, ShellCheck and Markdown checks                              |
| `npm --prefix node run test`  | Builds and installs the package, checks public imports and declarations, and runs the Node tests |
| `npm --prefix node run build` | Exports compiled modules to ignored `node/dist`                                                  |

Supply the exact Node peers and development toolchain from `node/package.json` through `node/node_modules` or `ART_KIT_NODE_MODULES`. Native lint also requires ShellCheck on the host and the exact Markdown tools installed with `npm ci --prefix tests/container --ignore-scripts --no-audit --no-fund`. The scoped security overrides and their removal criteria are documented in [Markdown tooling](tests/container/README.md). The native CLI runs ShellCheck and the Markdown CLI against its sanitized scratch source, so ignored worktree paths do not suppress Markdown discovery.

`node scripts/native-check.mts lint-node` runs formatting, ESLint and TypeScript without the ShellCheck and Markdown phases; native `lint` and `check` run all three.

Make runs `tests/container/check-stock`, which uses stock images pinned in `tests/container/images` and no Dockerfile. One Node container installs the development and peer dependencies, downloads the Skia prebuild and runs native `lint-node`, `test` and `build`. Lint adds a Markdown container and a read-only ShellCheck container. The shared `tests/container/stock` functions copy the Git-listed source into `/work` without Git metadata or credentials and run each container as uid 19001 with a read-only root, four CPUs and bounded memory and scratch. Node and Markdown containers use the network to install dependencies; ShellCheck has none. Each container starts only while the one-minute load is below 20.

`make check` is the check entry point. `scripts/provision.sh` and `scripts/pack.sh` remain container controllers with explicit dependency paths for provisioning and committed release packaging. They run `scripts/container.mts` with host Node through type stripping; it only orchestrates Docker and copies files. Their builds and downloads run in a `node:24.22.2` container as uid 19001 (`--user 19001:19001 -e HOME=/tmp`), with four CPUs, a read-only root and no network except while provisioning. Host paths are read-only bind mounts. Writable state lives in a per-run `/tmp` volume, outputs leave through `docker cp`, and owned containers and volumes are removed on exit.

| Command                                                 | Effect                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bash scripts/provision.sh <empty-directory>`           | Downloads the pinned dependencies from `node/package.json` into `<empty-directory>/node/node_modules` |
| `bash scripts/pack.sh <node_modules> <empty-directory>` | Builds `art-kit-<version>.tgz`, `SOURCE_COMMIT` and `SHA256SUMS` from the committed `HEAD`            |

Formatting follows `.prettierrc`; `node/tests/fixtures` is excluded because the tests compare it byte for byte. Lint rules are in `eslint.config.mjs` and the shared `eslint.config.base.mjs`. CI runs `make check`, then provisions, packs and uploads the committed release artifacts, and scans for attributions. Game projects test their own adapters and authored output; no game build is part of the package gate.

## Version and licence

The package version is the `version` in `node/package.json`. Compatible fixes increment the patch version and additive features the minor version. An incompatible public API change needs a coordinated bump and release notes before consumers migrate: the minor version before 1.0.0, the major version after. The exact Git revision identifies each payload. Helper code here is MIT licensed; test fonts keep their SIL OFL licence and are excluded from release artifacts. Generated assets, fonts and client code keep their own licences.

## Released dependency

The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. Consumers pin that URL with the tarball's SHA-256 from `SHA256SUMS`, plus the exact peers, through their own dependency integration. The tarball holds compiled ESM, `.d.ts` files, `LICENSE` and `SOURCE_COMMIT`; no source, fonts, game assets or tooling.

Tag `v<version>` only after every required CI workflow has passed on the exact release commit on `main`. Publish that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` as release assets after checking the checksums and a fresh install.
