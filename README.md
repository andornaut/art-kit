# art-kit

Shared Python and Node mechanisms for scripted pixel art and atlas builds. Python source lives in `src/art_kit`; Node source lives in `node/src`. Both artifacts share one canonical version, with no registry publication.

## Boundaries

### Python

| Module | Owns | Client supplies |
| --- | --- | --- |
| `aseprite` | Frame/tag Lua and PNG/JSON export | Executable, palette, tags, paths, optional slice |
| `colour` | Hex RGB and WCAG contrast | Resolved hex colours |
| `fonts` | Glyph rasterization, atlas packing, BMFont XML | Font path, characters, glyph overrides, metrics, kerning |
| `frames` | Opaque extents, reflection, RGBA conversion, contact sheets and tile sheets | Pixel frames, colour resolver, background, grounds, scale and tile size |
| `grid` | Shape drawing and outline traversal | Colour names and edge colour rule |

Clients own palettes and ramps, sprite definitions, font files and glyph policy, camera/depth geometry, output directories, manifest schemas, contact-sheet inputs and saving, and command-line behaviour. No module imports a game or discovers its repository from the working directory. Import owning modules explicitly rather than relying on root re-exports.

```python
from art_kit.grid import Grid

palette = {"fill": "ffffff"}
grid = Grid(palette, 16, 16, edge=lambda colour: "000000")
grid.ell(8, 8, 4, 4, "fill")
frame = grid.outlined()
```

`frames.contact_sheet(resolve_rgb, sprites, grounds, background=..., scale=3, gap=4)` returns the RGB preview image; callers retain output paths and saving. `frames.tile_sheet(tile_size, columns, tiles)` returns the RGBA sheet. Item naming, pieces, hitboxes and manifest entries remain local.

A client can subclass `Grid` to retain its existing constructor and outline signature. Keep mutable `px`, `w`, `h`, `edge` and `close` semantics when adapting existing drawing scripts. `fonts.pack(width, glyphs)` preserves glyph insertion order, one-pixel spacing and power-of-two atlas height; it supports monochrome masks and coloured RGBA glyphs. A glyph image wider than the atlas raises `ValueError`, identifying the character, actual width and atlas limit. Font overrides and baseline adjustments remain local. `fonts.bmfont_xml` returns text, without writing a manifest.

`fonts.rasterize_glyph(font, char, *, antialias=False)` and `fonts.rasterize(path, size, chars, *, antialias=False)` opt into native grayscale coverage with `antialias=True`, returning white RGBA glyph images with coverage in alpha; empty glyphs retain `None` images. Antialiased glyphs retain the full native coverage mask and signed ink offsets, including negative left bearings. Callers still supply the font path, size and characters. Set `antialias=True` on `fonts.bmfont_xml(..., kernings=(), antialias=False)` to emit `smooth="1"` and `aa="1"`. Omitted arguments preserve binary masks and XML defaults; glyph tuples, `FontInfo` and packing defaults are unchanged. Callers own font/sprite page segregation and texture filtering; atlas assembly uses explicit blits and metadata and does not smooth shared sprite pages.

`aseprite.export(executable, palette, tags, source, sheet, data, *, key=None, margins=None, columns=None)` accepts an optional positive integer `columns` to set the exported sheet column count. For example, `columns=6` arranges twelve frames in six columns and two rows. Omit it to retain the default sheet layout; source frames, tags, durations and slices are unchanged.

### Node

The compiled ESM package `@andornaut/art-kit` includes TypeScript declarations and these public subpaths:

| Subpath | Owns | Client supplies |
| --- | --- | --- |
| `atlasBuild` | Atlas drawing and encoded page assembly | Read/decode/encode functions, blits, extrusion and metadata |
| `atlasLayout` | Shelf packing and candidate selection | Items, grouping, order comparator, candidate widths and size limits |
| `indexedPng` | Indexed PNG encoding | RGBA image and compression options |
| `png` | PNG decoding to RGBA, RGBA PNG encoding and opaque RGB PNG encoding | Encoded bytes or an RGBA image and compression options |
| `raster` | Straight-alpha RGBA fill, paste, compositing, crop, flip, nearest resize and rotation, channel operations and contact sheets | Images, planes, colours, positions, rectangles, sizes, angles and channel tables |
| `rgbaImage` | RGBA allocation, alpha bounds and extruded blitting | Image dimensions, pixels, rectangles and bounds |
| `webp` | Lossless WebP encoding, decoding and RGBA comparison | Images or encoded bytes |

Import subpaths explicitly, for example `@andornaut/art-kit/atlasLayout`. Geometry and RGBA interfaces are local structural types; the package has no `game-kit` dependency. Callers own manifests, tile sizes, frame tags, grouping, ordering policy, paths, filenames and Vite asset emission. Node helpers run without a Python subprocess.

`rgbaImage.opaqueRect(within, image)` returns the alpha bounds within the supplied rectangle, or `undefined` when that region is clear. Callers choose trimming and clear-frame handling.

`raster` operates on straight (non-premultiplied) `RgbaImage` buffers with exact integer rounding and no canvas or Skia dependency; an opaque (RGB) image is one whose alpha is 255. Pillow 13.0.0 is the parity reference: committed fixtures generated by `tests/raster_reference.py` must match byte for byte, including partial alpha. Options and context precede the subject image, and every operation clips to the image on all sides. `fill({rect, mask?}, rgba, image)`, `paste({at, mask?, keepAlpha?}, source, image)` and `composite(at, source, image)` mutate `image`; every other function returns a new image or plane. `fill` replaces the rect, or with an 8-bit `Plane` mask sized to the rect blends each channel by coverage; a fully transparent pixel takes the full colour in RGB wherever coverage is nonzero. `paste` replaces target pixels, or with a mask plane sized to the source (or `"alpha"` for the source's own alpha) blends from target to source by the mask value; `keepAlpha: true` writes RGB only, for opaque targets. `composite` is straight-alpha source-over. `frameToRgba(context, frame)` resolves colours as `frames.renderFrame` does. `crop` zero-fills outside the source and `flipX` mirrors horizontally. `resizeNearest(width, height, image)` samples nearest pixel centres and replicates pixels exactly at integer factors; `rotateNearest(angle, image)` rotates counter-clockwise about the centre at the same size, leaving uncovered pixels clear. Both copy RGBA exactly, including RGB under clear alpha. `grayscale` returns ITU-R 601-2 luma, `channel(index, image)` one channel, `withChannel(index, plane | byte, image)` a copy with one channel replaced, `opaque` a copy with alpha 255 and RGB kept, and `mapChannels(luts, image)` a copy with each channel mapped through its 256-byte table. `composeContactSheet({resolveRgb, background, cellSize, scale, gap}, sprites, grounds)` builds the preview in memory, so its size is not limited by a canvas. `cellSize` is required: `"largest-frame"` matches `frames.renderContactSheet`, and `"row-first-frame"` sizes cells from first frames as Python `frames.contact_sheet` 0.5.0 did. Invalid geometry, colours, channel indexes, tables and plane sizes throw `RangeError`.

`indexedPng.encodeIndexedPng({ level, memLevel }, image)` returns encoded bytes, or `undefined` when the image has more than 256 distinct RGBA colours. The subpath also exports `MAX_PALETTE` and `COLOUR_TYPE_INDEXED`. `png.encodeRgbaPng({ deflateLevel, deflateStrategy, filterType }, image)` returns RGBA PNG bytes. `png.encodeRgbPng` takes the same options and returns colour type 2 bytes that decode to the image, throwing `RangeError` when any alpha is not 255; bytes are not matched to Pillow. Compression context precedes the image; callers choose indexed-first fallback, PNG versus WebP and output metadata.

`colour.srgb_to_oklab(rgb_bytes)` and `srgb_to_oklch(rgb_bytes)` return Oklab and OKLCH triples. `oklab_to_srgb(lab)` clamps linear channels on conversion to bytes. `oklch_to_srgb(lch)` clamps lightness to 0..1, limits chroma to the search bound, wraps hue in degrees and reduces out-of-gamut chroma at fixed lightness and hue before byte quantization. Neutral hue is zero. Node exports the corresponding camelCase functions. Palette targets and perceptual contrast policy remain caller-owned.

## Side-by-side drawing and font implementations

Python remains available alongside the Node `aseprite`, `colour`, `fonts`, `frames` and `grid` modules. Existing Python APIs and Node atlas/codecs remain unchanged. TypeScript generation uses CPU Skia canvases for `frames` and `fonts`, not Python subprocesses; `raster` is the canvas-free path that reproduces Pillow's RGBA arithmetic exactly. Install the optional exact peer `skia-canvas@4.0.0` for `frames` and `fonts`; codec-only imports do not require it.

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

Use the consolidated Node-only import when a generator needs several facilities:

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

`glyphAtlas.buildBitmapFontFromGlyphs(options, glyphs)` packs a `ReadonlyMap<string, SuppliedBitmapGlyph>` in insertion order. Each supplied glyph contains a structural RGBA `image` (or `undefined` for empty ink), signed integer `xoffset`/`yoffset` and integer `xadvance`. Options explicitly supply `key`, `face`, `size`, `base`, `lineHeight` and `atlasWidth`, with optional `padding`, `maxHeight` and `kernings`. The returned `{image, xml, metadata}` uses an RGBA buffer rather than a Canvas. Packing copies straight-alpha bytes exactly, including invisible RGB, without rasterization or blending. Callers retain glyph design and metric policy.

`exportBitmapFontFromGlyphs({font, glyphs, output: {png, fnt}})` writes that atlas through the exact RGBA PNG encoder. `font` supplies the same options except `key`, which is derived from output paths. The helper uses the same explicit path validation, relative XML page reference and non-atomic output contract as `exportBitmapFont`. Both helpers and their types are available from `@andornaut/art-kit/generate`; the standalone atlas builder and types are available from `@andornaut/art-kit/glyphAtlas`. The supplied-glyph subpath requires neither Skia nor fontkit; the consolidated generation entry still requires Skia.

Version 0.8 replaces the 0.7 Node frame conversion/composition and low-level font APIs without compatibility aliases. Python and existing Node atlas/codec consumers need no API changes. See [implementation comparison](docs/implementation-comparison.md) for measured size, output quality and the recommendation. No consumer assets, font choices or dependency pins change automatically.

## Runtime and checks

Python 3.12 or newer, Pillow 13.0.0 and optional Aseprite for exports. Ruff is pinned to 0.17.2. Colour and grid do not import Pillow; image and font facilities do. The source fonts and their licences remain in the client repositories.

Node requires 24.21.0 or newer and exact peer dependencies `pngjs@7.0.0` and `@jsquash/webp@1.5.0`. WebP uses the non-SIMD WASM codecs supplied by that peer package.

Every check, build and provisioning step runs in a container as the dedicated uid 19001 (`--user 19001:19001 -e HOME=/tmp`), which owns nothing on the host, with four CPUs, a read-only root, no capabilities and no network except while provisioning. Host paths are read-only bind mounts and must be readable by uid 19001 through their group or world bits; the container receives each mounted path's group. Writable state lives in a per-run named volume at `/tmp`, results are copied out with `docker cp` as the host user, and the container and volume are removed on exit. No host credential store or socket is mounted. Scripts start only below one-minute load 24 and discard results when Git status or listed file contents change during the run.

`bash scripts/provision.sh <empty-directory>` downloads the pinned dependencies into `python/` (Pillow, Ruff, setuptools, wheel) and `node/node_modules`. CI runs the same scripts with those paths.

Run `scripts/check.sh` with explicit Pillow, Ruff binary and build-dependency paths as documented by its usage. It runs offline inside `python:3.12` against the read-only checkout, runs library tests and builds the wheel. Game projects assume library contracts are correct and test their own adapters and authored output. No game build or generation is part of the package gate.

`bash scripts/check-node.sh <node_modules>` copies the current tree into the container, compiles it, packs and installs the compiled tarball into `node_modules/@andornaut/art-kit`, then runs the Node tests against that installed package with `node:test`. Both checks copy their evidence to a new directory under `.claude/`.

## Version and licence

The package version is declared in `pyproject.toml`. Compatible fixes increment the patch version; additive public features increment the minor version. Incompatible public API changes require an explicitly coordinated compatibility bump and release notes before consumer migration: increment the minor version before 1.0.0 and the major version thereafter. Never introduce an incompatible change in a patch release. Exact Git revision identifies each payload. Generated assets, fonts and client code retain their existing licences. Extracted helper code in this repository is MIT licensed.


## Released dependency

The public source repository is [andornaut/art-kit](https://github.com/andornaut/art-kit). For the version declared in `pyproject.toml`, the release artifact URL is `https://github.com/andornaut/art-kit/releases/download/v<version>/art_kit-<version>-py3-none-any.whl`. After publication, consumers pin the resolved URL with `#sha256=` and the wheel's exact published hash from `SHA256SUMS` in `requirements-art.txt`, alongside `Pillow==13.0.0`. Do not commit placeholder hashes or fetch unpublished URLs. Install into the explicit `.venv-art` virtual environment; no PyPI or other registry publication is used. Install the wheel without resolving additional packages when Pillow 13.0.0 is supplied separately.

Released clients use `.venv-art/bin/python -I` and the wheel installed into that virtual environment. Python isolated mode (`-I`) retains the interpreter's installed site packages. Released scripts use installed site packages only, without a vendor bootstrap, `PYTHONPATH` or editable fallback.

`bash scripts/pack.sh <build-dependency-directory> <output-directory>` builds the committed revision offline in a four-CPU container. Supply an empty output directory and the pinned build dependencies declared in `pyproject.toml`. It emits the wheel, `SHA256SUMS` (covering the wheel and `SOURCE_COMMIT`) and `SOURCE_COMMIT`. The wheel includes `art_kit/SOURCE_COMMIT`, generated from that exact source revision. No fonts, Aseprite application data, game assets or local tooling are included. Source CI checks the package, verifies isolated installed-wheel imports and source identity, and uploads artifacts for review.

The Node release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`, using the same version from `pyproject.toml`. Consumers pin the published tarball and exact peers through their own dependency integration, without registry publication or a source fallback. The tarball contains compiled ESM and `.d.ts` files, not source TypeScript as runtime code.

After building the wheel, run `bash scripts/pack-node.sh <node_modules> <output-directory>` with the same output directory. It archives exact `HEAD`, requires the existing `SOURCE_COMMIT` to match that commit, adds `art-kit-<version>.tgz` and recomputes the combined `SHA256SUMS`. Both artifacts share the same source identity.

Before creating the immutable `v<version>` tag for the version declared in `pyproject.toml`, verify that every required CI workflow has completed successfully on the exact release commit on `main`. Publish that commit's checked wheel, Node tarball, `SHA256SUMS` and `SOURCE_COMMIT` as GitHub release assets; do not substitute an earlier artifact. Consumers adopt the published URL and checksum through their own integration process.
