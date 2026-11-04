"""Write node/tests/fixtures/bmfont-packed.json: Python art_kit fonts.pack and bmfont_xml results.

Usage: python -I bmfont_fixtures.py <reference directory> <font directory> <output JSON>
Run through node/tests/bmfont-fixtures.sh, which supplies Pillow 13.0.0 in an offline python:3.12 container.
The reference directory holds fonts_v0100.py and fonts_v050.py from `git show <tag>:src/art_kit/fonts.py`.
Outputs come from v0.10.0. Every case without antialiasing must also match v0.5.0, which predates the flag.

Node supplies RGBA glyphs. A coverage ("L") glyph is recorded as the RGBA that Pillow paints for it on a clear
canvas of its own size, so the Node input copies exactly what pack pastes. Atlases are recorded by SHA-256.
"""

# ruff: noqa: INP001
import base64
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

CHARS = [chr(c) for c in range(32, 127)] + ["·"]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def noise(seed, count):
    # A fixed linear congruential sequence keeps the inputs reproducible without a random module.
    out = bytearray()
    for _ in range(count):
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        out.append((seed >> 16) & 0xFF)
    return bytes(out)


def mask(width, height, seed, *, binary=False):
    data = noise(seed, width * height)
    if binary:
        data = bytes(255 if value & 1 else 0 for value in data)
    return Image.frombytes("L", (width, height), data)


def rgba(width, height, seed):
    data = bytearray(noise(seed, width * height * 4))
    # Every third pixel is invisible with non-zero RGB, which pack must copy unchanged.
    for index in range(3, len(data), 12):
        data[index] = 0
    return Image.frombytes("RGBA", (width, height), bytes(data))


def node_input(image):
    if image is None:
        return None
    if image.mode == "L":
        painted = Image.new("RGBA", image.size, (0, 0, 0, 0))
        painted.paste(Image.new("RGBA", image.size, (255, 255, 255, 255)), (0, 0), image)
        image = painted
    return {"width": image.width, "height": image.height, "data": base64.b64encode(image.tobytes()).decode("ascii")}


def chibi_case(fonts, name, face, path, *, antialias):
    # Chibi's build: 16 px, printable ASCII and the middle dot, a 256 px atlas and every nonzero pair kerning.
    glyphs, ascent, descent = fonts.rasterize(str(path), 16, CHARS, antialias=antialias)
    font = sys.modules["PIL.ImageFont"].truetype(str(path), 16)
    advances = {char: font.getlength(char) for char in CHARS}
    kernings = [
        (first, second, amount)
        for first in CHARS
        for second in CHARS
        if (amount := round(font.getlength(first + second) - advances[first] - advances[second]))
    ]
    info = {"key": name, "face": face, "size": 16, "line_height": ascent + descent + 1, "base": ascent}
    return {"name": name, "width": 256, "info": info, "antialias": antialias, "glyphs": glyphs, "kernings": kernings}


def synthetic_cases():
    mixed = {
        "A": (mask(5, 7, 1, binary=True), 0, 2, 6),
        " ": (None, 0, 0, 3),
        "g": (mask(4, 9, 2), -1, 4, 5),
        "♥": (mask(7, 6, 3, binary=True), 0, 1, 8),
        "W": (rgba(9, 7, 4), 1, 2, 10),
        "\U0001d400": (mask(6, 8, 5), 0, 0, 7),
        "i": (mask(1, 7, 6, binary=True), 1, 2, 3),
        "&": (mask(11, 3, 7), -2, -1, 9),
    }
    wide = {"M": (mask(8, 4, 10), 0, 0, 9), "N": (mask(3, 4, 11, binary=True), 0, 0, 4), "O": (rgba(4, 3, 12), 0, 1, 5)}
    exact = {"a": (rgba(3, 2, 13), 0, 0, 4), "b": (rgba(3, 2, 14), 0, 0, 4), "c": (rgba(7, 2, 15), 0, 0, 8)}
    return [
        {
            "name": "mixed glyphs, row wrap, non-BMP and kernings",
            "width": 24,
            "info": {"key": "body&<\"'>", "face": "Body \"x\" 'y' &<>\n\t\r", "size": 9, "line_height": 11, "base": 8},
            "antialias": False,
            "glyphs": mixed,
            "kernings": [("A", "W", -1), ("♥", " ", 2), ("g", "\U0001d400", -3), ("A", "W", 0)],
        },
        {
            "name": "mixed glyphs with antialias",
            "width": 24,
            "info": {"key": "body", "face": "Body", "size": 9, "line_height": 11, "base": 8},
            "antialias": True,
            "glyphs": mixed,
            "kernings": [("\U0001d400", "A", -1)],
        },
        {
            "name": "empty kernings and a face holding only double quotes",
            "width": 16,
            "info": {"key": 'say "hi"', "face": 'Say "hi"', "size": 5, "line_height": 7, "base": 5},
            "antialias": False,
            "glyphs": {"a": (mask(3, 3, 8, binary=True), 0, 2, 4), "b": (mask(3, 5, 9, binary=True), 0, 0, 4)},
            "kernings": [],
        },
        {
            "name": "empty kernings with antialias and a face holding only single quotes",
            "width": 16,
            "info": {"key": "it's", "face": "It's", "size": 5, "line_height": 7, "base": 5},
            "antialias": True,
            "glyphs": {"a": (rgba(3, 3, 16), 0, 2, 4), " ": (None, 2, -1, 2)},
            "kernings": [],
        },
        {
            "name": "glyph as wide as the atlas and power-of-two growth",
            "width": 8,
            "info": {"key": "wide", "face": "Wide", "size": 8, "line_height": 9, "base": 7},
            "antialias": False,
            "glyphs": wide,
            "kernings": [("M", "N", -1)],
        },
        {
            "name": "row filled to one pixel short of the atlas width",
            "width": 8,
            "info": {"key": "exact", "face": "Exact", "size": 4, "line_height": 5, "base": 4},
            "antialias": True,
            "glyphs": exact,
            "kernings": [("a", "b", 1), ("b", "c", -1)],
        },
        {
            "name": "only empty glyphs",
            "width": 4,
            "info": {"key": "blank", "face": "Blank", "size": 4, "line_height": 5, "base": 4},
            "antialias": False,
            "glyphs": {" ": (None, 0, 0, 2), "　": (None, 0, 0, 8)},
            "kernings": [],
        },
        {
            "name": "no glyphs",
            "width": 1,
            "info": {"key": "none", "face": "None", "size": 1, "line_height": 1, "base": 0},
            "antialias": True,
            "glyphs": {},
            "kernings": [],
        },
    ]


def sha256(image):
    return hashlib.sha256(image.tobytes()).hexdigest()


def run(fonts, case, *, antialias=True):
    atlas, places = fonts.pack(case["width"], case["glyphs"])
    info = fonts.FontInfo(**case["info"])
    options = {"kernings": tuple(case["kernings"])}
    if antialias:
        options["antialias"] = case["antialias"]
    return atlas, places, fonts.bmfont_xml(info, atlas.size, places, case["glyphs"], **options)


def main():
    references, font_dir, output = (Path(arg) for arg in sys.argv[1:])
    current = load(references / "fonts_v0100.py", "fonts_v0100")
    legacy = load(references / "fonts_v050.py", "fonts_v050")
    regular, bold = font_dir / "LiberationSans-Regular.ttf", font_dir / "LiberationSans-Bold.ttf"
    cases = [
        chibi_case(current, "font-body", "Liberation Sans Regular", regular, antialias=True),
        chibi_case(current, "font-title", "Liberation Sans Bold", bold, antialias=True),
        chibi_case(current, "font-body-binary", "Liberation Sans Regular", regular, antialias=False),
        *synthetic_cases(),
    ]
    records = []
    legacy_matches = 0
    for case in cases:
        atlas, places, xml = run(current, case)
        if not case["antialias"]:
            old_atlas, old_places, old_xml = run(legacy, case, antialias=False)
            if (old_atlas.tobytes(), old_places, old_xml) != (atlas.tobytes(), places, xml):
                raise SystemExit(f"v0.5.0 differs from v0.10.0: {case['name']}")
            legacy_matches += 1
        records.append(
            {
                "name": case["name"],
                "width": case["width"],
                "info": case["info"],
                "antialias": case["antialias"],
                "glyphs": [
                    {"char": char, "image": node_input(image), "xoffset": ox, "yoffset": oy, "xadvance": advance}
                    for char, (image, ox, oy, advance) in case["glyphs"].items()
                ],
                "kernings": [{"first": ord(a), "second": ord(b), "amount": n} for a, b, n in case["kernings"]],
                "places": [[char, x, y] for char, (x, y) in places.items()],
                "atlas": {"width": atlas.width, "height": atlas.height, "sha256": sha256(atlas)},
                "xml": xml,
            }
        )
    document = {
        "source": "art_kit v0.10.0 src/art_kit/fonts.py; cases without antialias also match v0.5.0",
        "pillow": sys.modules["PIL"].__version__,
        "legacy_matches": legacy_matches,
        "cases": records,
    }
    output.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    print(f"{len(records)} cases, {legacy_matches} also match v0.5.0")


if __name__ == "__main__":
    main()
