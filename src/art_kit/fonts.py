"""Bitmap glyph rasterization, ordered atlas packing and BMFont XML."""

from dataclasses import dataclass
from xml.sax.saxutils import quoteattr

from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class FontInfo:
    key: str
    face: str
    size: int
    line_height: int
    base: int


def rasterize_glyph(font, char, *, antialias=False):
    ascent, descent = font.getmetrics()
    canvas = Image.new("L", (font.size * 3, ascent + descent + 2), 0)
    draw = ImageDraw.Draw(canvas)
    draw.fontmode = "L" if antialias else "1"
    draw.text((0, 0), char, font=font, fill=255)
    box = canvas.getbbox()
    advance = round(font.getlength(char))
    if not box:
        return None, 0, 0, advance
    image = canvas.crop(box)
    if antialias:
        coverage = image
        image = Image.new("RGBA", coverage.size, (255, 255, 255, 255))
        image.putalpha(coverage)
    return image, box[0], box[1], advance


def rasterize(path, size, chars, *, antialias=False):
    font = ImageFont.truetype(path, size)
    return {char: rasterize_glyph(font, char, antialias=antialias) for char in chars}, *font.getmetrics()


def pack(atlas_width, glyphs):
    """Preserve glyph insertion order, 1px spacing and power-of-two atlas height."""
    x = y = row_height = 0
    places = {}
    for char, (image, *_rest) in glyphs.items():
        if image is None:
            places[char] = (0, 0)
            continue
        if image.width > atlas_width:
            raise ValueError(f"Glyph {char!r} width {image.width} exceeds atlas width {atlas_width}")
        if x + image.width + 1 > atlas_width:
            x, y, row_height = 0, y + row_height + 1, 0
        places[char] = (x, y)
        x += image.width + 1
        row_height = max(row_height, image.height)
    height = 1
    while height < y + row_height + 1:
        height *= 2
    atlas = Image.new("RGBA", (atlas_width, height), (0, 0, 0, 0))
    for char, (image, *_rest) in glyphs.items():
        if image is None:
            continue
        if image.mode == "L":
            atlas.paste(Image.new("RGBA", image.size, (255, 255, 255, 255)), places[char], image)
        else:
            atlas.paste(image, places[char])
    return atlas, places


def bmfont_xml(info: FontInfo, atlas_size, places, glyphs, *, kernings=(), antialias=False):
    width, height = atlas_size
    lines = [
        '<?xml version="1.0"?>',
        "<font>",
        (
            f'  <info face={quoteattr(info.face)} size="{info.size}" bold="0" italic="0" charset="" unicode="1" '
            f'stretchH="100" smooth="{int(antialias)}" aa="{int(antialias)}" padding="0,0,0,0" spacing="1,1"/>'
        ),
        (
            f'  <common lineHeight="{info.line_height}" base="{info.base}" scaleW="{width}" '
            f'scaleH="{height}" pages="1" packed="0"/>'
        ),
        f'  <pages><page id="0" file={quoteattr(info.key + ".png")}/></pages>',
        f'  <chars count="{len(glyphs)}">',
    ]
    for char, (image, ox, oy, advance) in glyphs.items():
        x, y = places[char]
        w, h = image.size if image is not None else (0, 0)
        lines.append(
            f'    <char id="{ord(char)}" x="{x}" y="{y}" width="{w}" height="{h}" xoffset="{ox}" '
            f'yoffset="{oy}" xadvance="{advance}" page="0" chnl="15"/>'
        )
    lines.append("  </chars>")
    if kernings:
        lines.append(f'  <kernings count="{len(kernings)}">')
        lines.extend(f'    <kerning first="{ord(a)}" second="{ord(b)}" amount="{n}"/>' for a, b, n in kernings)
        lines.append("  </kernings>")
    lines.extend(["</font>", ""])
    return "\n".join(lines)
