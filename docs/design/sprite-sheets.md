# Sprite sheets

`atlasLayout` shelf-packs items against candidate widths and size limits, with optional padding
between cells, and `atlasBuild` draws and encodes the pages with at most 16 reads and encodes in
flight. `spriteSheet` reproduces Aseprite 1.2.30's decoded RGBA and exact json-hash text without
Aseprite. It uses the shared RGBA PNG encoder, so PNG bytes can differ from Aseprite's exports.
The encoders are `png` (decoding, RGBA and opaque RGB encoding, streamed and
byte-identical to pngjs 7.0.0), `indexedPng`, `webp` (lossless, and lossy with four explicit
settings), `gif` (exact palettes and binary alpha) and `ico` (PNG entries). Callers choose formats,
fallback order, paths and metadata.

Reference: [Encoders and atlases](../../README.md#encoders-and-atlases).

## Work items

| ID      | Title                                                         | Link                             |
| ------- | ------------------------------------------------------------- | -------------------------------- |
| ak-0002 | Add the opaque RGB PNG encoder                                | [ak-0002.md](../work/ak-0002.md) |
| ak-0005 | Add exact GIF and ICO encoders                                | [ak-0005.md](../work/ak-0005.md) |
| ak-0010 | Bound PNG encoder memory by streaming row filtering           | [ak-0010.md](../work/ak-0010.md) |
| ak-0012 | Add spriteSheet without Aseprite                              | [ak-0012.md](../work/ak-0012.md) |
| ak-0013 | Remove the aseprite subpath                                   | [ak-0013.md](../work/ak-0013.md) |
| ak-0019 | Bound atlas page reads and encodes                            | [ak-0019.md](../work/ak-0019.md) |
| ak-0022 | Remove the spriteSheet Tag alias and unused container options | [ak-0022.md](../work/ak-0022.md) |
| ak-0031 | Add configurable lossy WebP encoding                          | [ak-0031.md](../work/ak-0031.md) |
| ak-0040 | Pad packAtlas cells and shelves                               | [ak-0040.md](../work/ak-0040.md) |
| ak-0044 | Decode WebP to RGBA                                           | [ak-0044.md](../work/ak-0044.md) |
