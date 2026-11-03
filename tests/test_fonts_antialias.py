import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw, ImageFont

from art_kit import fonts


class AntialiasTests(unittest.TestCase):
    def setUp(self):
        self.font = ImageFont.load_default(size=16)
        assert isinstance(self.font, ImageFont.FreeTypeFont)

    def test_native_coverage_has_white_rgb_and_survives_packing(self):
        glyph = fonts.rasterize_glyph(self.font, "A", antialias=True)
        image, ox, oy, advance = glyph
        assert image.mode == "RGBA"
        assert any(0 < a < 255 for a in image.getchannel("A").getdata())
        assert all(pixel[:3] == (255, 255, 255) for pixel in image.getdata())
        atlas, places = fonts.pack(64, {"A": glyph})
        x, y = places["A"]
        assert atlas.crop((x, y, x + image.width, y + image.height)).tobytes() == image.tobytes()
        assert all(isinstance(value, int) for value in (ox, oy, advance))
        assert fonts.rasterize_glyph(self.font, " ", antialias=True) == (None, 0, 0, round(self.font.getlength(" ")))

    def test_default_matches_original_binary_rasterization(self):
        ascent, descent = self.font.getmetrics()
        canvas = Image.new("L", (self.font.size * 3, ascent + descent + 2), 0)
        draw = ImageDraw.Draw(canvas)
        draw.fontmode = "1"
        draw.text((0, 0), "A", font=self.font, fill=255)
        box = canvas.getbbox()
        image, *metrics = fonts.rasterize_glyph(self.font, "A")
        assert image.mode == "L"
        assert image.tobytes() == canvas.crop(box).tobytes()
        assert set(image.getdata()) <= {0, 255}
        assert metrics == [box[0], box[1], round(self.font.getlength("A"))]
        with patch.object(fonts.ImageFont, "truetype", return_value=self.font):
            glyphs, *font_metrics = fonts.rasterize("caller.ttf", 16, "A ", antialias=True)
        assert glyphs["A"][0].tobytes() == fonts.rasterize_glyph(self.font, "A", antialias=True)[0].tobytes()
        assert font_metrics == [ascent, descent]

    def test_xml_opt_in_changes_only_smoothing_flags(self):
        glyphs = {"A": fonts.rasterize_glyph(self.font, "A", antialias=True)}
        atlas, places = fonts.pack(64, glyphs)
        info = fonts.FontInfo("body", "Caller face", 16, 20, 16)
        kwargs = {"kernings": (("A", "V", -1),)}
        default = fonts.bmfont_xml(info, atlas.size, places, glyphs, **kwargs)
        explicit = fonts.bmfont_xml(info, atlas.size, places, glyphs, antialias=False, **kwargs)
        smooth = fonts.bmfont_xml(info, atlas.size, places, glyphs, antialias=True, **kwargs)
        assert default == explicit
        assert smooth == default.replace('smooth="0" aa="0"', 'smooth="1" aa="1"')
        root = ET.fromstring(smooth)  # noqa: S314 - XML is generated locally by the library.
        assert root.find("info").get("aa") == "1"
        assert root.find("kernings/kerning").get("amount") == "-1"
        assert root.find("common").get("base") == "16"
