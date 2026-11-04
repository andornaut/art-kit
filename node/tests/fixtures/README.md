# Test fixtures

## Frozen references

These fixtures are frozen reference outputs. Their generators are not in this tree; tag v0.13.0 holds them. Change a fixture only together with a deliberate contract change, and record the new reference's source.

| Fixture | Contents | Generator in v0.13.0 |
| --- | --- | --- |
| `draw.json` | Pillow 13.0.0 `ImageDraw.Draw(image)` RGBA results for every `draw` operation | `node/tests/draw_fixtures.py` |
| `raster/pillow.json` | Pillow 13.0.0 RGBA results for the `raster` operations, including partial alpha; generator cases for operations the package does not provide are omitted | `tests/raster_reference.py` |
| `gif-ico/pillow.json` | GIF and ICO inputs with Pillow 13.0.0 decodes of its own saves | `tests/gif_ico_reference.py` |
| `bmfont-packed.json` | Glyph inputs with art_kit v0.10.0 `fonts.pack` and `bmfont_xml` outputs (cases without antialiasing also match v0.5.0); its Liberation Sans cases are rasterized from the fonts below | `node/tests/bmfont_fixtures.py` |

## Aseprite exports

`sprite-sheet/` holds Aseprite 1.2.30 (the 1.2.30-1 amd64 package, x86-64 with SSE4.2 and PCLMUL) `aseprite -b --sheet --data --format json-hash --list-tags` exports, with `--list-slices` and `--sheet-columns` where a case sets margins or columns. `cases.json` lists each case's key, `meta.image` and options. `generated` cases also hold their input tags: frames are rows of palette indices, `.` for clear; they were exported through `aseprite.export` from art-kit 0.15.0 and cover single frames, partial and wide column layouts, slices, empty frames, escaped tag names, duration truncation and clamping, and streams that slide the deflate window. The `archies-dog-walks` and `chibis-way-home` cases are those games' committed exports (`public/art/sprites/<key>.png` and `.json`); their inputs are read back from the sheet and data, and `archie-tour-group` spans two IDAT chunks.

`quantise-golden.json` is the committed output of the Node `quantise` subpath, not a Pillow reference.

## Fonts

Unmodified Liberation Sans Regular and Bold from Debian fonts-liberation 1:2.1.5-3 (upstream 2.1.5). Source: https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5

These test-only fonts retain the SIL Open Font License 1.1 in LICENSE.txt. They are not helper-code MIT assets. Release payloads include compiled Node dist only, excluding this directory.

SHA256:

```text
4659bc0c58c5028dd488ec928d41d9265db43d9b669fc14ca8b0832daca7b144  LiberationSans-Regular.ttf
3973aa5054fb467dd5627245d3dc82e37bf16fe075756156a570455871351582  LiberationSans-Bold.ttf
```
