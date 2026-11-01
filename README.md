# art-kit

Shared Python mechanisms for scripted pixel art. One root package, one `src/art_kit` tree, no registry publication.

## Boundaries

| Module | Owns | Client supplies |
| --- | --- | --- |
| `aseprite` | Frame/tag Lua and PNG/JSON export | Executable, palette, tags, paths, optional slice |
| `colour` | Hex RGB and WCAG contrast | Resolved hex colours |
| `fonts` | Glyph rasterization, atlas packing, BMFont XML | Font path, characters, glyph overrides, metrics, kerning |
| `frames` | Opaque extents, reflection, RGBA conversion | Pixel frames |
| `grid` | Shape drawing and outline traversal | Colour names and edge colour rule |

Clients own palettes and ramps, sprite definitions, font files and glyph policy, camera/depth geometry, output directories, manifest schemas, contact generation and command-line behaviour. No module imports a game or discovers its repository from the working directory. Import owning modules explicitly rather than relying on root re-exports.

```python
from art_kit.grid import Grid

palette = {"fill": "ffffff"}
grid = Grid(palette, 16, 16, edge=lambda colour: "000000")
grid.ell(8, 8, 4, 4, "fill")
frame = grid.outlined()
```

A client can subclass `Grid` to retain its existing constructor and outline signature. Keep mutable `px`, `w`, `h`, `edge` and `close` semantics when adapting existing drawing scripts. `fonts.pack(width, glyphs)` preserves glyph insertion order, one-pixel spacing and power-of-two atlas height; it supports monochrome masks and coloured RGBA glyphs. Font overrides and baseline adjustments remain local. `fonts.bmfont_xml` returns text, without writing a manifest.

## Runtime and checks

Python 3.12 or newer, Pillow 13.0.0 and optional Aseprite for exports. Ruff is pinned to 0.17.2. Colour and grid do not import Pillow; image and font facilities do. The source fonts and their licences remain in the client repositories.

Run `scripts/check.sh` with explicit read-only Pillow, Ruff binary and build-dependency paths as documented by its usage. Checks run offline inside `python:3.12`, with four CPUs, a read-only source checkout and writable scratch only. Tests compare shared drawing and font output against pinned game source snapshots when those snapshots are supplied. No game build or generation is part of the package gate.

## Exact-revision vendoring

Run `bash scripts/sync-into.sh <consumer>` to copy the committed package payload into `vendor/art-kit`. `bash scripts/sync-into.sh --check <consumer>` checks every payload file and rejects extra files. `ART_KIT_COMMIT` pins the exact canonical revision. Sync changes only the vendor directory; client adapters are reviewed separately. No registry, account or service is required.

For isolated Python (`python -I`), an explicit client bootstrap must add the resolved `vendor/art-kit/src` directory, calculated from the script's own file path, to `sys.path` before importing `art_kit`. Isolated mode ignores `PYTHONPATH`. Keep this bootstrap in one client-owned module and import it from the local compatibility adapters. An installed local package also works; never rely on the current working directory.

## Version and licence

Version 0.1.0. Exact Git revision identifies each payload. Preserve public functions and keyword semantics within a minor version; document additive changes and explicitly coordinate breaking changes before client migration. Generated assets and client code retain their existing licences. Extracted helper code in this repository is MIT licensed.
