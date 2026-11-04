"""Write node/tests/fixtures/draw.json: Pillow 13.0.0 ImageDraw results for the draw subpath contract.

Run through node/tests/draw-fixtures.sh, which supplies Pillow in an offline python:3.12 container. Each case
records its arguments, with colours named by key, and the SHA-256 (first 64 bits) of the RGBA buffer after
drawing on a patterned background; a few cases also record the full buffer. The generator also checks that
drawing on mode "1" and "L" targets covers the same pixels as drawing on RGBA, and records the counts.
"""

# ruff: noqa: INP001
import base64
import hashlib
import json
import sys
from pathlib import Path

import PIL
from PIL import Image, ImageDraw

FILL = (220, 40, 60, 160)
OUTLINE = (20, 200, 90, 255)
COLOURS = {"F": FILL, "O": OUTLINE}
SIZES = ((13, 11), (16, 12))
LARGE = (96, 64)
FULL_BUFFER_EVERY = 97


def background(width, height):
    image = Image.new("RGBA", (width, height))
    image.putdata(
        [
            ((x * 29 + y * 7) & 255, (x * 11 + y * 31) & 255, (x * 5 + y * 13 + 90) & 255, (x * 3 + y * 17 + 20) & 255)
            for y in range(height)
            for x in range(width)
        ]
    )
    return image


def lcg(seed):
    state = seed
    while True:
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        yield state


def styles(width_values):
    yield {"fill": FILL}
    for width in width_values:
        yield {"outline": OUTLINE, "width": width}
        yield {"fill": FILL, "outline": OUTLINE, "width": width}
    yield {"fill": FILL, "outline": FILL, "width": 2}
    yield {}


def boxes():
    origins = ((0, 0), (1, 2), (2.5, 1.7), (-2, -1), (-0.5, 3.9))
    extents = ((0, 0), (1, 1), (2, 3), (3, 2), (4, 4), (5, 7), (8, 5), (9, 9), (11, 8), (14, 13))
    for x0, y0 in origins:
        for w, h in extents:
            yield [x0, y0, x0 + w, y0 + h]


def cases():
    lines = (
        [[1, 1], [10, 1]],
        [[1, 1], [1, 9]],
        [[1, 1], [11, 9]],
        [[11, 1], [2, 9]],
        [[2, 9], [6, 2], [11, 8]],
        [[1, 2], [10, 2], [10, 9], [3, 6]],
        [[1.5, 2.7], [9.9, 3.2], [4.4, 9.6]],
        [[-3, 4], [6, 6], [6, 6], [16, -2]],
        [[5, 5]],
        [[5, 5], [5, 5]],
        [[2, 2], [8, 3], [3, 4], [9, 8], [1, 9]],
    )
    out = [
        {"op": "line", "args": {"fill": FILL, "width": width, "joint": joint, "points": points}}
        for width in (1, 2, 3, 4, 5, 6, 9, 10)
        for joint in (None, "curve")
        for points in lines
    ]
    out.append({"op": "line", "args": {"fill": FILL, "width": 0, "joint": None, "points": [[1, 1], [9, 9]]}})
    out.extend(
        {"op": "point", "args": {"fill": FILL, "points": points}}
        for points in (
            [[0, 0], [12, 10], [5, 5], [-1, 3], [20, 4], [3, -2], [12, 0]],
            [[0.9, 0.9], [-0.9, 2.2], [4.99, 5.01], [12.999, 10.5]],
        )
    )
    polygons = [
        [[1, 1], [10, 2], [5, 9]],
        [[2, 1], [10, 1], [10, 8], [2, 8]],
        [[1, 1], [6, 5], [11, 1], [11, 9], [1, 9]],
        [[1, 5], [4, 5], [7, 5], [9, 1], [11, 9]],
        [[6, 0], [12, 5], [6, 10], [0, 5]],
        [[1, 1], [9, 9]],
        [[1, 1], [9, 1]],
        [[2, 2], [2, 2], [2, 2]],
        [[1.5, 1.2], [10.8, 3.9], [7.1, 9.99], [0.2, 6.6]],
        [[-4, -3], [15, 2], [4, 14]],
        [[3, 1], [9, 1], [11, 4], [9, 8], [3, 8], [1, 4]],
        [[1, 9], [3, 2], [5, 7], [7, 1], [9, 7], [11, 3], [12, 9]],
    ]
    random = lcg(20261103)
    for _ in range(12):
        count = 3 + next(random) % 5
        polygons.append([[next(random) % 15 - 1, next(random) % 13 - 1] for _ in range(count)])
    out.extend(
        {"op": "polygon", "args": {**style, "points": points}} for points in polygons for style in styles((1, 2, 3, 4))
    )
    for box in boxes():
        out.extend({"op": "ellipse", "args": {**style, "box": box}} for style in styles((1, 2, 3, 4)))
        out.extend({"op": "rectangle", "args": {**style, "box": box}} for style in styles((1, 2, 3)))
    out.append({"op": "ellipse", "args": {"fill": FILL, "box": [5, 5, 4, 6]}})
    out.append({"op": "ellipse", "args": {"fill": FILL, "box": [5.6, 5, 5.2, 6]}})
    out.append({"op": "rectangle", "args": {"fill": FILL, "box": [5, 6, 7, 5]}})
    angles = (
        (0, 90),
        (45, 135),
        (90, 270),
        (190, 345),
        (190, 275),
        (300, 30),
        (-45, 45),
        (0, 360),
        (10, 10),
        (370, 400),
        (-200, -100),
        (12.5, 197.25),
        (180, 0),
        (89.9, 90.1),
        (0, 720),
    )
    for box in ([1, 1, 11, 9], [0, 2, 12, 7], [2, 0, 9, 10], [3.6, 2.2, 9.9, 9.1], [1, 1, 2, 2], [4, 4, 4, 4]):
        out.extend(
            {"op": "arc", "args": {"fill": FILL, "width": width, "box": box, "start": start, "end": end}}
            for start, end in angles
            for width in (1, 2, 3, 4)
        )
    out.append({"op": "arc", "args": {"fill": FILL, "width": 0, "box": [1, 1, 9, 9], "start": 0, "end": 90}})
    out.append({"op": "arc", "args": {"fill": FILL, "width": 2, "box": [9, 1, 1, 9], "start": 0, "end": 90}})
    corner_sets = (None, [True, False, True, False], [False, True, False, False], [False, False, False, False])
    for box in ([0, 0, 12, 10], [1, 2, 11, 6], [2, 1, 6, 10], [1.4, 1.5, 10.5, 9.6], [3, 3, 5, 4], [2, 2, 2, 2]):
        for radius in (0, 1, 2, 2.5, 3, 4, 6):
            for corners in corner_sets:
                for style in styles((1, 2)):
                    args = {**style, "radius": radius, "box": box}
                    if corners is not None:
                        args["corners"] = corners
                    out.append({"op": "roundedRectangle", "args": args})
    for index, case in enumerate(out):
        case["size"] = list(SIZES[index % len(SIZES)])
    for case in large_cases():
        case["size"] = list(LARGE)
        out.append(case)
    return out


def large_cases():
    """Consumer-scale shapes: the game call patterns and wide joints on a larger image."""
    jets = ([[34, 49], [28, 42], [29, 36], [33, 40], [36, 46]], [[62, 48], [66, 40], [71, 36], [70, 43], [66, 49]])
    out = [
        {"op": "ellipse", "args": {"fill": FILL, "box": [29, 39, 73, 55]}},
        {"op": "ellipse", "args": {"fill": FILL, "box": [31, 40, 71, 52]}},
        {"op": "arc", "args": {"fill": FILL, "width": 2, "box": [31, 40, 70, 52], "start": 190, "end": 345}},
        {"op": "arc", "args": {"fill": FILL, "width": 2, "box": [11, 21, 37, 32], "start": 190, "end": 275}},
        {"op": "arc", "args": {"fill": FILL, "width": 2, "box": [17, 12, 52, 42], "start": 190, "end": 275}},
        {"op": "ellipse", "args": {"fill": FILL, "box": [23, 32, 26, 35]}},
        {"op": "ellipse", "args": {"fill": FILL, "box": [68, 28, 71, 32]}},
        {"op": "ellipse", "args": {"fill": FILL, "box": [54, 40, 119, 57]}},
        {"op": "roundedRectangle", "args": {"fill": FILL, "radius": 10, "box": [4, 4, 90, 60]}},
        {"op": "roundedRectangle", "args": {"fill": FILL, "radius": 6, "box": [10, 8, 70, 30]}},
        {
            "op": "roundedRectangle",
            "args": {"fill": FILL, "outline": OUTLINE, "width": 3, "radius": 9, "box": [6, 5, 80, 50]},
        },
        {
            "op": "polygon",
            "args": {"fill": FILL, "outline": OUTLINE, "points": [[9, 12], [0, 4], [8, 1], [25, 10], [18, 19]]},
        },
        {
            "op": "polygon",
            "args": {"fill": FILL, "points": [[88, 44], [100, 48], [98, 60], [78, 79], [35, 91], [54, 73]]},
        },
        {"op": "line", "args": {"fill": FILL, "width": 3, "joint": None, "points": [[10, 20], [40, 22]]}},
        {"op": "line", "args": {"fill": FILL, "width": 2, "joint": None, "points": [[40, 18], [40, 2], [44, 2]]}},
    ]
    for points in jets:
        out.append({"op": "polygon", "args": {"fill": FILL, "points": points}})
        out.append({"op": "line", "args": {"fill": FILL, "width": 2, "joint": None, "points": points[:3]}})
    zigzag = [[6, 50], [20, 10], [34, 52], [50, 12], [64, 50], [90, 30], [70, 6]]
    out.extend(
        {"op": "line", "args": {"fill": FILL, "width": width, "joint": "curve", "points": zigzag}}
        for width in (5, 7, 8, 9, 12, 15)
    )
    out.extend(
        {"op": "ellipse", "args": {"outline": OUTLINE, "width": width, "box": [3, 2, 3 + w, 2 + h]}}
        for width in (1, 2, 4, 7)
        for w, h in ((90, 58), (41, 60), (60, 60), (77, 13))
    )
    out.extend(
        {"op": "arc", "args": {"fill": FILL, "width": width, "box": [5, 3, 5 + w, 3 + h], "start": start, "end": end}}
        for width in (1, 3, 6)
        for w, h in ((85, 57), (30, 58))
        for start, end in ((0, 90), (100, 260), (190, 345), (300, 60), (-30, 200))
    )
    return out


def colour(mode, value, mapping):
    if value is None:
        return None
    return mapping[mode][tuple(value)]


def apply(draw, case, mode, mapping):
    args = case["args"]
    fill = colour(mode, args.get("fill"), mapping)
    outline = colour(mode, args.get("outline"), mapping)
    width = args.get("width", 1)
    op = case["op"]
    if op == "point":
        draw.point([tuple(p) for p in args["points"]], fill=fill)
    elif op == "line":
        draw.line([tuple(p) for p in args["points"]], fill=fill, width=width, joint=args["joint"])
    elif op == "polygon":
        draw.polygon([tuple(p) for p in args["points"]], fill=fill, outline=outline, width=width)
    elif op == "ellipse":
        draw.ellipse(args["box"], fill=fill, outline=outline, width=width)
    elif op == "rectangle":
        draw.rectangle(args["box"], fill=fill, outline=outline, width=width)
    elif op == "arc":
        draw.arc(args["box"], args["start"], args["end"], fill=fill, width=width)
    elif op == "roundedRectangle":
        corners = args.get("corners")
        draw.rounded_rectangle(
            args["box"],
            radius=args["radius"],
            fill=fill,
            outline=outline,
            width=width,
            corners=None if corners is None else tuple(corners),
        )


def run(image, case, mode, mapping):
    try:
        apply(ImageDraw.Draw(image), case, mode, mapping)
    except ValueError:
        return True
    return False


EQUIVALENCE = {
    "RGBA": {FILL: (255, 255, 255, 255), OUTLINE: (128, 128, 128, 255)},
    "L": {FILL: 255, OUTLINE: 128},
    "1": {FILL: 1, OUTLINE: 1},
}


def equivalence(case):
    """Compare mode "L" and "1" coverage with RGBA as (L matched, "1" checked, "1" matched), or None."""
    size = tuple(case["size"])
    if not {"fill", "outline"} & case["args"].keys():
        # The default ink is mode-specific: white on RGBA, 0 on "L".
        return None
    rgba = Image.new("RGBA", size)
    run(rgba, case, "RGBA", EQUIVALENCE)
    red = rgba.getchannel("R").tobytes()
    grey = Image.new("L", size)
    run(grey, case, "L", EQUIVALENCE)
    grey_match = grey.tobytes() == red
    inks = {tuple(case["args"][key]) for key in ("fill", "outline") if key in case["args"]}
    if len(inks) > 1:
        return grey_match, False, False
    mask = Image.new("1", size)
    run(mask, case, "1", EQUIVALENCE)
    alpha = rgba.getchannel("A").tobytes()
    return grey_match, True, [v != 0 for v in mask.convert("L").tobytes()] == [v != 0 for v in alpha]


def main(output):
    if PIL.__version__ != "13.0.0":
        raise SystemExit(f"Pillow 13.0.0 required, found {PIL.__version__}")
    direct = {"RGBA": {FILL: FILL, OUTLINE: OUTLINE}}
    records = []
    grey_cases = grey_matched = mask_cases = mask_matched = 0
    mismatches = []
    for index, case in enumerate(cases()):
        image = background(*case["size"])
        error = run(image, case, "RGBA", direct)
        data = image.tobytes()
        names = {value: key for key, value in COLOURS.items()}
        args = {
            key: names[tuple(value)] if key in {"fill", "outline"} else value for key, value in case["args"].items()
        }
        record = {"op": case["op"], "size": case["size"], "args": args}
        if error:
            record["error"] = True
        record["sha256"] = hashlib.sha256(data).hexdigest()[:16]
        if index % FULL_BUFFER_EVERY == 0:
            record["rgba"] = base64.b64encode(data).decode()
        records.append(record)
        result = None if error else equivalence(case)
        if result is not None:
            grey_match, mask_checked, mask_match = result
            grey_cases += 1
            grey_matched += grey_match
            mask_cases += mask_checked
            mask_matched += mask_match
            if not grey_match or (mask_checked and not mask_match):
                mismatches.append(index)
    fixture = {
        "pillow": PIL.__version__,
        "colours": COLOURS,
        "background": "rgba(x * 29 + y * 7, x * 11 + y * 31, x * 5 + y * 13 + 90, x * 3 + y * 17 + 20) & 255",
        "equivalence": {
            "L": {"cases": grey_cases, "matched": grey_matched},
            "1": {"cases": mask_cases, "matched": mask_matched},
            "mismatches": mismatches,
        },
    }
    # One case per line keeps fixture diffs reviewable.
    header = json.dumps(fixture, separators=(",", ":"))[:-1]
    body = ",\n".join(json.dumps(record, separators=(",", ":")) for record in records)
    Path(output).write_text(f'{header},"cases":[\n{body}\n]}}\n')
    print(f"{len(records)} cases; L {grey_matched}/{grey_cases}; 1 {mask_matched}/{mask_cases}")


if __name__ == "__main__":
    main(sys.argv[1])
