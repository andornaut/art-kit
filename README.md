# art-kit

Shared Python mechanisms for scripted pixel art. One root package, one `src/art_kit` tree, no registry publication.

## Boundaries

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

## Runtime and checks

Python 3.12 or newer, Pillow 13.0.0 and optional Aseprite for exports. Ruff is pinned to 0.17.2. Colour and grid do not import Pillow; image and font facilities do. The source fonts and their licences remain in the client repositories.

Run `scripts/check.sh` with explicit read-only Pillow, Ruff binary and build-dependency paths as documented by its usage. Checks run offline inside `python:3.12`, with four CPUs, a read-only source checkout and writable scratch only. The standard gate runs library tests and builds the wheel. Game projects assume library contracts are correct and test their own adapters and authored output. No game build or generation is part of the package gate.

## Version and licence

The package version is declared in `pyproject.toml`. Compatible fixes increment the patch version; additive public features increment the minor version. Incompatible public API changes require an explicitly coordinated compatibility bump and release notes before consumer migration: increment the minor version before 1.0.0 and the major version thereafter. Never introduce an incompatible change in a patch release. Exact Git revision identifies each payload. Generated assets, fonts and client code retain their existing licences. Extracted helper code in this repository is MIT licensed.


## Released dependency

The public source repository is [andornaut/art-kit](https://github.com/andornaut/art-kit). For the version declared in `pyproject.toml`, the release artifact URL is `https://github.com/andornaut/art-kit/releases/download/v<version>/art_kit-<version>-py3-none-any.whl`. After publication, consumers pin the resolved URL with `#sha256=` and the wheel's exact published hash from `SHA256SUMS` in `requirements-art.txt`, alongside `Pillow==13.0.0`. Do not commit placeholder hashes or fetch unpublished URLs. Install into the explicit `.venv-art` virtual environment; no PyPI or other registry publication is used. Install the wheel without resolving additional packages when Pillow 13.0.0 is supplied separately.

Released clients use `.venv-art/bin/python -I` and the wheel installed into that virtual environment. Python isolated mode (`-I`) retains the interpreter's installed site packages. Released scripts use installed site packages only, without a vendor bootstrap, `PYTHONPATH` or editable fallback.

`bash scripts/pack.sh <build-dependency-directory> <output-directory>` builds the committed revision offline in a four-CPU container. Supply an empty output directory and the pinned build dependencies declared in `pyproject.toml`. It emits the wheel, `SHA256SUMS` (covering the wheel and `SOURCE_COMMIT`) and `SOURCE_COMMIT`. The wheel includes `art_kit/SOURCE_COMMIT`, generated from that exact source revision. No fonts, Aseprite application data, game assets or local tooling are included. Source CI checks the package, verifies isolated installed-wheel imports and source identity, and uploads artifacts for review.

Before creating the immutable `v<version>` tag for the version declared in `pyproject.toml`, verify that every required CI workflow has completed successfully on the exact release commit on `main`. Publish that commit's checked wheel, `SHA256SUMS` and `SOURCE_COMMIT` as GitHub release assets; do not substitute an earlier artifact. Consumers adopt the published URL and checksum through their own integration process.
