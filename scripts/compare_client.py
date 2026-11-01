"""Compare mechanisms with one explicit, immutable client snapshot.

Run each client in its own process because its local modules use common names.
"""

import argparse
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import ImageFont

from art_kit import aseprite, fonts, frames
from art_kit.grid import Grid


def require_equal(actual, expected, label):
    if actual != expected:
        raise ValueError(f"Client parity failed: {label}")


def compare(root):
    sys.path.insert(0, str(root / "art/tools"))
    pixel = importlib.import_module("pixel")
    original_fonts = importlib.import_module("fonts")
    dog = hasattr(pixel, "depth_settled")
    # The fixture root is explicit; only the comparison process changes directory.
    os.chdir(root)
    edge = lambda colour: pixel.DARKER[pixel.DARKER[colour]]  # noqa: E731 - Mirrors the client callback.
    shapes = [
        ("rect", (1, 2, 3, 2, "white")),
        ("ell", (7, 8, 4, 6, "white", "slate", "cream")),
        ("blob", (7, 8, 4, 6, "white", "slate", "cream")),
        ("tri", ((1, 1), (12, 3), (4, 13), "white")),
    ]
    if hasattr(pixel.Grid, "line"):
        shapes.append(("line", (0, 1, 14, 12, "white")))
    if hasattr(pixel.Grid, "cel"):
        shapes.append(("cel", (7, 8, 4, 6, "white", "slate", "cream")))
    for method, args in shapes:
        legacy, shared = pixel.Grid(16, 16), Grid(pixel.K, 16, 16, edge=edge)
        getattr(legacy, method)(*args)
        getattr(shared, method)(*args)
        require_equal(shared.px, legacy.px, f"Grid.{method} pixels")
        expected = legacy.outlined() if dog else legacy.outlined(edge)
        require_equal(shared.outlined(), expected, f"Grid.{method} outline")
    legacy, shared = pixel.Grid(8, 8), Grid(pixel.K, 8, 8, edge=edge)
    legacy.rect(2, 5, 4, 3, "white")
    shared.rect(2, 5, 4, 3, "white")
    if dog:
        legacy.close, shared.close = True, True
        require_equal(shared.outlined(), legacy.outlined(), "closed outline")
        require_equal(shared.outlined(enabled=False), legacy.outlined(False), "disabled outline")
    frame = shared.px
    require_equal(
        frames.to_image(frame).tobytes(),
        bytes(component for row in frame for c in row for component in ((*pixel.rgb(c), 255) if c else (0, 0, 0, 0)))
        if not dog
        else pixel.to_image(frame).tobytes(),
        "RGBA pixels",
    )
    glyph_count = 0
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory)
        for key, (face, path, size) in original_fonts.FONTS.items():
            glyphs, ascent, descent = original_fonts.glyphs(path, size)
            atlas, places = fonts.pack(original_fonts.ATLAS_W, glyphs)
            old_atlas, old_places = original_fonts.pack(glyphs)
            require_equal(
                (atlas.size, atlas.tobytes(), places), (old_atlas.size, old_atlas.tobytes(), old_places), f"{key} atlas"
            )
            font = ImageFont.truetype(path, size)
            excluded = (
                set(original_fonts.DRAWN.get(path, {}))
                | set(original_fonts.REPEAT.get(path, {}))
                | original_fonts.LOWERED.get(path, set())
                | {"♥"}
                if dog
                else set()
            )
            for char, expected in glyphs.items():
                if char in excluded:
                    continue
                actual = fonts.rasterize_glyph(font, char)
                require_equal(actual[1:], expected[1:], f"{key}:{char} metrics")
                require_equal(
                    actual[0].tobytes() if actual[0] else None,
                    expected[0].tobytes() if expected[0] else None,
                    f"{key}:{char} glyph",
                )
            line_height = ascent + descent + 1
            base = ascent + (original_fonts.BASE_DROP.get(path, 0) if dog else 0)
            kerns = original_fonts.KERNS.get(path, ()) if dog else ()
            info = fonts.FontInfo(key, face, size, line_height, base)
            actual_xml = fonts.bmfont_xml(info, atlas.size, places, glyphs, kernings=kerns)
            if dog:
                os.chdir(output)
                original_fonts.write_font(key, face, size, line_height, base, glyphs, kerns)
                old_xml = (output / "public/art/fonts" / f"{key}.fnt").read_text()
                os.chdir(root)
            else:
                original_fonts.OUT = str(output)
                original_fonts.build_font(key, face, path, size)
                old_xml = (output / f"{key}.fnt").read_text()
            require_equal(actual_xml, old_xml, f"{key} BMFont bytes")
            glyph_count += len(glyphs)
        tags = [("idle", [frame, list(reversed(frame))], [80, 120])]
        colours = pixel.PALETTE
        old_lua = pixel._lua(tags, "sprite.aseprite") if dog else pixel._lua(tags, "sprite.aseprite", "sprite")  # noqa: SLF001 - Compare the existing serialization boundary.
        new_lua = aseprite.lua(colours, tags, "sprite.aseprite")
        require_equal(new_lua, old_lua.replace("\n\nspr:saveAs", "\nspr:saveAs"), "Lua frames/tags/durations")
    result = {
        "client": "Dog" if dog else "Chibi",
        "shapes": len(shapes),
        "glyphs": glyph_count,
        "fontAtlases": len(original_fonts.FONTS),
        "bmfontBytes": "equal",
        "lua": "equal",
    }
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    compare(parser.parse_args().snapshot.resolve())
