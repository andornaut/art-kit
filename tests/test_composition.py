import unittest

from PIL import Image

from art_kit.colour import rgb
from art_kit.composition import contact_sheet, tileset


class CompositionTests(unittest.TestCase):
    def test_contact_sheet_retains_tag_order_ground_rows_and_empty_cell_background(self):
        red = [["ff0000", None]]
        blue = [[None, "0000ff"]]
        sprites = [("two", [("idle", [red], 80), ("tap", [blue], 60)]), ("one", [("idle", [[["ffffff"]]], 80)])]
        image = contact_sheet(rgb, (24, 20, 37), ["000000", "ffffff"], sprites, scale=2, gap=1)
        assert image.size == (12, 16)
        assert image.getpixel((0, 0)) == (255, 0, 0)
        assert image.getpixel((2, 0)) == (0, 0, 0)
        assert image.getpixel((8, 0)) == (0, 0, 255)
        assert image.getpixel((2, 4)) == (255, 255, 255)
        assert image.getpixel((10, 8)) == (24, 20, 37)
        assert red == [["ff0000", None]]

    def test_tileset_preserves_alpha_and_unused_row_cells(self):
        red = Image.new("RGBA", (2, 2), (255, 0, 0, 255))
        clear = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
        blue = Image.new("RGBA", (2, 2), (0, 0, 255, 255))
        image = tileset(2, 2, [red, clear, blue])
        assert image.size == (4, 4)
        assert image.getpixel((0, 0)) == (255, 0, 0, 255)
        assert image.getpixel((2, 0)) == (0, 0, 0, 0)
        assert image.getpixel((0, 2)) == (0, 0, 255, 255)
        assert image.getpixel((2, 2)) == (0, 0, 0, 0)
        assert red.size == (2, 2)
