"""Pillow 13.0.0 reference outputs for the Node raster subpath.

Usage: PYTHONPATH=<Pillow-directory>:<art_kit-0.5.0-src> python tests/raster_reference.py
node/tests/fixtures/raster/pillow.json, inside python:3.12, where the art_kit sources come from
git archive v0.5.0 src. Inputs are deterministic and include
partial alpha. Every image is stored as RGBA bytes; a mode "RGB" image is stored with alpha 255.
"""

import base64
import json
import sys
from pathlib import Path

import PIL
from PIL import Image, ImageOps

from art_kit._composition import contact_sheet

assert PIL.__version__ == "13.0.0", PIL.__version__  # noqa: S101


class Lcg:
    def __init__(self, seed):
        self.state = seed

    def byte(self):
        self.state = (self.state * 1103515245 + 12345) % 2**31
        return self.state >> 23


def rgba(rng, width, height):
    pixels = []
    for i in range(width * height):
        alpha = (0, 255, rng.byte())[i % 3]
        pixels.append((rng.byte(), rng.byte(), rng.byte(), alpha))
    image = Image.new("RGBA", (width, height))
    image.putdata(pixels)
    return image


def plane(rng, width, height):
    image = Image.new("L", (width, height))
    image.putdata([(0, 255, rng.byte())[i % 3] for i in range(width * height)])
    return image


def encode(image):
    data = image.convert("RGBA").tobytes() if image.mode != "L" else image.tobytes()
    return {"width": image.width, "height": image.height, "data": base64.b64encode(data).decode()}


rng = Lcg(20261103)
inputs = {
    "a": rgba(rng, 5, 4),
    "b": rgba(rng, 3, 3),
    "target": rgba(rng, 6, 5),
    "rgb": rgba(rng, 6, 5).convert("RGB"),
    "rgbSource": rgba(rng, 3, 2).convert("RGB"),
    "mask": plane(rng, 3, 3),
    "alpha": plane(rng, 5, 4),
}
cases = []


def case(op, expected, **args):
    cases.append({"op": op, **args, "expected": encode(expected)})


for x, y in ((1, 1), (-1, 2), (4, 3)):
    out = inputs["target"].copy()
    out.paste(inputs["b"], (x, y))
    case("paste", out, at=[x, y], source="b", target="target")
    out = inputs["rgb"].copy()
    out.paste(inputs["rgbSource"], (x, y))
    case("paste", out, at=[x, y], source="rgbSource", target="rgb")
    out = inputs["target"].copy()
    out.paste(inputs["b"], (x, y), inputs["mask"])
    case("paste", out, at=[x, y], source="b", mask="mask", target="target")
    out = inputs["target"].copy()
    out.paste(inputs["b"], (x, y), inputs["b"])
    case("paste", out, at=[x, y], source="b", mask="alpha", target="target")
    out = inputs["rgb"].copy()
    out.paste(inputs["b"], (x, y), inputs["b"])
    case("paste", out, at=[x, y], source="b", mask="alpha", keepAlpha=True, target="rgb")
    out = inputs["rgb"].copy()
    out.paste(inputs["b"], (x, y), inputs["mask"])
    case("paste", out, at=[x, y], source="b", mask="mask", keepAlpha=True, target="rgb")
    for colour in ((200, 10, 50, 128), (0, 0, 0, 0), (9, 99, 199, 255)):
        out = inputs["target"].copy()
        out.paste(colour, (x, y), inputs["mask"])
        rect = [x, y, inputs["mask"].width, inputs["mask"].height]
        case("fill", out, rgba=list(colour), rect=rect, mask="mask", target="target")
    out = inputs["target"].copy()
    out.alpha_composite(inputs["b"], (x, y))
    case("composite", out, at=[x, y], source="b", target="target")
    out = inputs["target"].copy()
    out.alpha_composite(inputs["a"], (x, y))
    case("composite", out, at=[x, y], source="a", target="target")

for box, colour in (((1, 1, 4, 3), (10, 20, 30, 255)), ((3, 2, 9, 9), (0, 0, 0, 0)), ((-2, -1, 2, 2), (5, 6, 7, 100))):
    out = inputs["target"].copy()
    out.paste(colour, box)
    rect = [box[0], box[1], box[2] - box[0], box[3] - box[1]]
    case("fill", out, rgba=list(colour), rect=rect, target="target")

for box in ((-1, -1, 4, 3), (3, 2, 8, 7), (1, 0, 4, 4)):
    case("crop", inputs["a"].crop(box), rect=[box[0], box[1], box[2] - box[0], box[3] - box[1]], source="a")
case("flipX", inputs["a"].transpose(Image.Transpose.FLIP_LEFT_RIGHT), source="a")
for factor in (1, 3):
    size = (inputs["a"].width * factor, inputs["a"].height * factor)
    case("resizeNearest", inputs["a"].resize(size, Image.Resampling.NEAREST), size=list(size), source="a")
for size in ((7, 5), (3, 3), (4, 6), (6, 2), (11, 9), (2, 1), (13, 3)):
    case("resizeNearest", inputs["a"].resize(size, Image.Resampling.NEAREST), size=list(size), source="a")
case("opaque", inputs["a"].convert("RGB"), source="a")
case("grayscale", inputs["a"].convert("L"), source="a")
assert ImageOps.grayscale(inputs["a"]).tobytes() == inputs["a"].convert("L").tobytes()  # noqa: S101
for index in range(4):
    case("channel", inputs["a"].getchannel(index), index=index, source="a")
for index, band in enumerate(inputs["a"].split()):
    case("channel", band, index=index, source="a")
out = inputs["a"].copy()
out.putalpha(inputs["alpha"])
case("withChannel", out, index=3, value="alpha", source="a")
out = inputs["a"].copy()
out.putalpha(77)
case("withChannel", out, index=3, value=77, source="a")
luts = [[rng.byte() for _ in range(256)] for _ in range(4)]
case("mapChannels", inputs["a"].point([value for lut in luts for value in lut]), luts=luts, source="a")
case("copy", inputs["a"].copy(), source="a")

rotation_rng = Lcg(20)
frame = Image.new("RGBA", (32, 48))
frame.putdata(
    [
        (x * 7 % 256, y * 5 % 256, (x * y) % 256, 255 if (x - 16) ** 2 / 144 + (y - 24) ** 2 / 400 <= 1 else 0)
        for y in range(48)
        for x in range(32)
    ]
)
for name, image in (
    ("rotateOdd", rgba(rotation_rng, 5, 5)),
    ("rotateEven", rgba(rotation_rng, 6, 6)),
    ("rotateWide", rgba(rotation_rng, 7, 4)),
    ("rotateTall", rgba(rotation_rng, 6, 9)),
    ("rotateFrame", frame),
):
    inputs[name] = image
    for angle in (-20, 20, 45, 90, 180, 33.3, 359, 270, -90, 0, 720.5):
        case("rotateNearest", image.rotate(angle, Image.Resampling.NEAREST), angle=angle, source=name)

palette = {"r": (200, 30, 40), "g": (20, 180, 60), "b": (30, 40, 220), "s": (90, 80, 70), "t": (250, 240, 200)}
sprites = [
    [
        "mixed",
        [
            ["idle", [[["r", None, "g"], [None, "b", None]], [["g", "g"], ["r", None], [None, "b"], ["b", "b"]]], 1],
            ["walk", [[["b", None, None, "r", "g"]]], 1],
        ],
    ],
    ["tall", [["only", [[["g"], [None], ["r"]], [["b", "r", "g", "b"], [None, "g", None, "r"]]], 1]]],
]
ground_names = ["s", "t"]
for scale, gap in ((1, 0), (2, 1), (3, 4)):
    sheet = contact_sheet(lambda name: palette[name], sprites, ground_names, background=(1, 2, 3), scale=scale, gap=gap)
    case(
        "composeContactSheet",
        sheet,
        cellSize="row-first-frame",
        scale=scale,
        gap=gap,
        background=[1, 2, 3],
        sprites=sprites,
        grounds=ground_names,
    )

# A mode "RGB" target keeps its alpha when an RGBA source is pasted without a mask.
for x, y in ((1, 1), (-1, 2), (4, 3)):
    out = inputs["rgb"].copy()
    out.paste(inputs["b"], (x, y))
    case("paste", out, at=[x, y], source="b", keepAlpha=True, target="rgb")

document = {
    "pillow": PIL.__version__,
    "palette": palette,
    "inputs": {name: encode(image) for name, image in inputs.items()},
    "cases": cases,
}
Path(sys.argv[1]).write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
