import unittest
from xml.etree import ElementTree as ET

from PIL import Image

from art_kit import fonts


class CoverageFont:
    size = 16

    def __init__(self, coverage, offset):
        self.coverage = coverage
        self.offset = offset

    def getmetrics(self):
        return 15, 4

    def getlength(self, char):
        return 5.75

    def getmask2(self, char, mode="", *args, **kwargs):
        assert mode == "L"
        return self.coverage.im, self.offset


class BearingTests(unittest.TestCase):
    def test_trimmed_native_mask_preserves_negative_bearings_and_packed_alpha(self):
        coverage = Image.new("L", (5, 4), 0)
        coverage.putdata([0, 0, 0, 0, 0, 0, 255, 64, 0, 0, 0, 128, 255, 32, 0, 0, 0, 0, 0, 0])
        font = CoverageFont(coverage, (-3, -4))

        glyph = fonts.rasterize_glyph(font, "j", antialias=True)
        image, ox, oy, advance = glyph

        assert (ox, oy, advance) == (-2, -3, 6)
        assert image.mode == "RGBA"
        assert image.size == (3, 2)
        assert image.getchannel("A").tobytes() == bytes([255, 64, 0, 128, 255, 32])
        assert all(pixel[:3] == (255, 255, 255) for pixel in image.get_flattened_data())

        glyphs = {"j": glyph}
        atlas, places = fonts.pack(8, glyphs)
        x, y = places["j"]
        assert atlas.crop((x, y, x + 3, y + 2)).tobytes() == image.tobytes()
        xml = fonts.bmfont_xml(fonts.FontInfo("body", "Test", 16, 20, 15), atlas.size, places, glyphs, antialias=True)
        root = ET.fromstring(xml)  # noqa: S314 - XML is generated locally by the library.
        char = root.find("chars/char")
        assert {key: char.get(key) for key in ("xoffset", "yoffset", "xadvance", "width", "height")} == {
            "xoffset": "-2",
            "yoffset": "-3",
            "xadvance": "6",
            "width": "3",
            "height": "2",
        }

    def test_empty_native_coverage_retains_advance_without_ink_offsets(self):
        for size in ((3, 2), (0, 0)):
            with self.subTest(size=size):
                font = CoverageFont(Image.new("L", size, 0), (-3, -4))
                assert fonts.rasterize_glyph(font, " ", antialias=True) == (None, 0, 0, 6)
