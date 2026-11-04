"""Pillow 13.0.0 references for the Node GIF and ICO encoders.

node/tests/fixtures/gif-ico/pillow.sh runs both commands inside python:3.12 with Pillow 13.0.0:

    python tests/gif_ico_reference.py generate node/tests/fixtures/gif-ico/pillow.json
    python tests/gif_ico_reference.py crosscheck node/tests/fixtures/gif-ico/pillow.json <directory>

generate builds deterministic inputs, saves them with the Pillow options each case names and
records what Pillow decodes from its own files. crosscheck decodes the <case>.gif and <case>.ico
files node/tests/fixtures/gif-ico/encode.mjs wrote and compares them with that record.
"""

import base64
import io
import json
import sys
import zlib
from pathlib import Path

import PIL
from PIL import Image

assert PIL.__version__ == "13.0.0", PIL.__version__  # noqa: S101

PURPLE = (74, 52, 110, 255)
CLEAR = (0, 0, 0, 0)


def lcg(seed):
    state = seed
    while True:
        state = (state * 1103515245 + 12345) % 2**31
        yield state >> 8


def canvas(size, ground, sprites):
    im = Image.new("RGBA", size, ground)
    for (x, y, w, h), colour in sprites:
        for dy in range(h):
            for dx in range(w):
                im.putpixel((x + dx, y + dy), colour)
    return im


def walk(ground, count):
    colours = [(250, 240, 230, 255), (20, 30, 40, 255), (200, 60, 50, 255)]
    return [
        canvas((24, 12), ground, [((2 + 3 * i, 3, 4, 4), colours[i % 3]), ((20 - i, 8, 2, 2), colours[(i + 1) % 3])])
        for i in range(count)
    ]


def noise(seed, size, offset):
    rand = lcg(seed)
    order = list(range(256))
    for i in range(255, 0, -1):
        j = next(rand) % (i + 1)
        order[i], order[j] = order[j], order[i]
    im = Image.new("RGBA", (size, size))
    for i in range(size * size):
        c = order[i % 256] if i < 256 else next(rand) % 256
        im.putpixel((i % size, i // size), ((c * 7 + offset) % 256, (c * 13) % 256, c, 255))
    return im


def gif_cases():
    pigeon = walk(PURPLE, 5)
    pigeon.insert(2, pigeon[1].copy())
    opening = walk((90, 140, 200, 255), 4)
    opening[2:2] = [opening[1].copy(), opening[1].copy()]
    sprite = walk(CLEAR, 4)
    return {
        # pigeon_antagonist preview: opaque RGBA, per-frame durations, loop=0, no disposal.
        "pigeon": (pigeon, {"duration": [120, 80, 40, 15, 0, 200], "loop": 0}),
        # opening preview: RGB frames, one duration, loop=0, disposal=2.
        "opening": ([im.convert("RGB") for im in opening], {"duration": 100, "loop": 0, "disposal": 2}),
        "transparent": (sprite, {"duration": [60, 60, 70, 80]}),
        "transparent-disposal": (sprite, {"duration": 50, "loop": 3, "disposal": 2}),
        # RGB keeps Pillow's quantization exact at 256 colours; RGBA input would not.
        "noise": ([noise(1, 96, 0).convert("RGB"), noise(2, 96, 128).convert("RGB")], {"duration": [50, 0], "loop": 0}),
        "single": ([sprite[0], sprite[0].copy()], {"duration": [30, 40]}),
    }


def ico_cases():
    def icon(side):
        im = Image.new("RGBA", (side, side))
        for y in range(side):
            for x in range(side):
                a = (0, 128, 255)[(x // 3 + y // 5) % 3]
                im.putpixel((x, y), (x * 255 // side, y * 255 // side, (x ^ y) % 4 * 60, a))
        return im

    return {
        # icons.py favicon: the 32 saves with sizes 16 and 32 and the 16 appended.
        "favicon": [icon(32), icon(16)],
        "large": [icon(256), icon(48)],
    }


def encode(im):
    return {
        "width": im.width,
        "height": im.height,
        "rgba": base64.b64encode(zlib.compress(im.convert("RGBA").tobytes(), 9)).decode(),
    }


def decode_gif(data):
    im = Image.open(io.BytesIO(data))
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append({"duration": im.info.get("duration"), "disposal": im.disposal_method, "image": encode(im)})
    return {"size": list(im.size), "loop": im.info.get("loop"), "frames": frames}


def decode_ico(data):
    im = Image.open(io.BytesIO(data))
    return [{"size": list(size), "image": encode(im.ico.getimage(size))} for size in sorted(im.ico.sizes())]


def pillow_gif(frames, options):
    out = io.BytesIO()
    frames[0].save(out, "GIF", save_all=True, append_images=frames[1:], **options)
    return out.getvalue()


def pillow_ico(images):
    out = io.BytesIO()
    images[0].save(out, "ICO", sizes=sorted(im.size for im in images), append_images=images[1:])
    return out.getvalue()


def generate(path):
    fixture = {"pillow": PIL.__version__, "gif": {}, "ico": {}}
    for name, (frames, options) in gif_cases().items():
        fixture["gif"][name] = {
            "options": options,
            "frames": [encode(im) for im in frames],
            "pillow": decode_gif(pillow_gif(frames, options)),
        }
    for name, images in ico_cases().items():
        reference = decode_ico(pillow_ico(images))
        inputs = sorted((encode(im) for im in images), key=lambda e: (e["width"], e["height"]))
        if [entry["image"] for entry in reference] != inputs:
            raise AssertionError(f"Pillow resized or altered ICO case {name}")
        fixture["ico"][name] = {"images": [encode(im) for im in images], "pillow": reference}
    with Path(path).open("w") as f:
        json.dump(fixture, f, indent=1)
        f.write("\n")


def crosscheck(path, directory):
    with Path(path).open() as f:
        fixture = json.load(f)
    failures = 0
    for kind, decode in (("gif", decode_gif), ("ico", decode_ico)):
        for name, case in fixture[kind].items():
            actual = decode(Path(directory, f"{name}.{kind}").read_bytes())
            same = actual == case["pillow"]
            failures += not same
            print(f"{kind} {name}: {'match' if same else 'MISMATCH'}")
    print(f"Pillow {PIL.__version__}: {failures} mismatches")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    if sys.argv[1:2] == ["generate"] and len(sys.argv) == 3:
        generate(sys.argv[2])
    elif sys.argv[1:2] == ["crosscheck"] and len(sys.argv) == 4:
        crosscheck(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
