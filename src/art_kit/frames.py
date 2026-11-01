"""Frame conversion and opaque extents without game geometry policy."""

from PIL import Image

from art_kit._composition import contact_sheet, tile_sheet
from art_kit.colour import rgb

__all__ = ["contact_sheet", "flipped", "opaque_cols", "opaque_rows", "tile_sheet", "to_image"]


def opaque_rows(frames):
    rows = [y for frame in frames for y, row in enumerate(frame) if any(row)]
    return (min(rows), max(rows)) if rows else None


def opaque_cols(frames):
    cols = [x for frame in frames for row in frame for x, colour in enumerate(row) if colour]
    return (min(cols), max(cols)) if cols else None


def flipped(frame):
    return [list(reversed(row)) for row in frame]


def to_image(frame):
    image = Image.new("RGBA", (len(frame[0]), len(frame)), (0, 0, 0, 0))
    for y, row in enumerate(frame):
        for x, colour in enumerate(row):
            if colour:
                image.putpixel((x, y), (*rgb(colour), 255))
    return image
