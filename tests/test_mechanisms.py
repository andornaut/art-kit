import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

from PIL import Image

from art_kit import aseprite, colour, fonts, frames
from art_kit.grid import Grid, outline


class DrawingTests(unittest.TestCase):
    def test_outline_preserves_neighbour_priority_and_bottom_policy(self):
        frame = [[None, "ffffff", None], ["ff0000", None, None], [None, "ffffff", None]]
        expected = [
            ["edge:ff0000", "ffffff", "edge:ffffff"],
            ["ff0000", "edge:ffffff", None],
            ["edge:ff0000", "ffffff", "edge:ffffff"],
        ]
        assert outline(lambda c: f"edge:{c}", frame) == expected
        assert outline(lambda c: c, frame, enabled=False) == frame
        assert outline(lambda c: "000000", frame, close=True)[-1][1] == "000000"
        assert frame[-1][1] == "ffffff"

    def test_grid_clips_resolves_names_and_draws_shapes(self):
        grid = Grid({"white": "ffffff"}, 8, 8, edge=lambda c: "000000")
        grid.p(-1, 2, "white")
        grid.line(0, 0, 7, 7, "white")
        assert sum(c == "ffffff" for row in grid.px for c in row) == 8
        grid.ell(4, 4, 2, 2, "white")
        grid.blob(4, 4, 2, 2, "white")
        grid.cel(4, 4, 2, 2, "white")
        grid.tri((1, 1), (6, 1), (3, 6), "white")
        assert grid.outlined()[0][1] == "000000"
        assert frames.opaque_rows([grid.px]) == (0, 7)
        assert frames.opaque_cols([grid.px]) == (0, 7)
        assert frames.to_image(grid.px).getpixel((0, 0)) == (255, 255, 255, 255)
        assert frames.flipped([[None, "ffffff"]]) == [["ffffff", None]]
        assert abs(colour.contrast("000000", "ffffff") - 21) < 1e-7


class FontTests(unittest.TestCase):
    def test_pack_rejects_oversized_glyph_before_pasting(self):
        glyphs = {"W": (Image.new("L", (6, 2), 255), 0, 0, 6)}
        with patch.object(Image.Image, "paste") as paste:
            with self.assertRaisesRegex(ValueError, "Glyph 'W' width 6 exceeds atlas width 5"):  # noqa: PT027
                fonts.pack(5, glyphs)
            paste.assert_not_called()

    def test_pack_accepts_exact_width_and_preserves_row_spacing(self):
        glyphs = {
            "W": (Image.new("L", (5, 2), 255), 0, 0, 5),
            "i": (Image.new("L", (1, 1), 255), 0, 0, 1),
        }
        atlas, places = fonts.pack(5, glyphs)
        assert places == {"W": (0, 1), "i": (0, 4)}
        assert atlas.size == (5, 8)
        assert atlas.getpixel((4, 2)) == (255, 255, 255, 255)
        assert atlas.getpixel((0, 3)) == (0, 0, 0, 0)

    def test_bmfont_page_filename_round_trips_xml_special_characters(self):
        for key in ("ordinary", "menu&icons<test>\"'"):
            with self.subTest(key=key):
                info = fonts.FontInfo(key, "Test", 8, 10, 8)
                xml = fonts.bmfont_xml(info, (4, 4), {}, {})
                page = ET.fromstring(xml).find("pages/page")  # noqa: S314 - Parse only generated fixture XML.
                assert page.attrib["file"] == key + ".png"
                if key == "ordinary":
                    assert '<pages><page id="0" file="ordinary.png"/></pages>' in xml

    def test_pack_mask_colour_empty_and_metrics(self):
        glyphs = {
            " ": (None, 0, 0, 2),
            "A": (Image.new("L", (2, 3), 255), 1, 2, 3),
            "♥": (Image.new("RGBA", (2, 2), (255, 0, 0, 255)), 0, 1, 3),
        }
        atlas, places = fonts.pack(5, glyphs)
        assert atlas.size == (5, 8)
        assert places == {" ": (0, 0), "A": (0, 0), "♥": (0, 4)}
        assert atlas.getpixel((0, 4)) == (255, 0, 0, 255)
        info = fonts.FontInfo("test", 'Quoted "face"', 8, 10, 8)
        xml = fonts.bmfont_xml(info, atlas.size, places, glyphs, kernings=[("A", "♥", -1)])
        assert 'xoffset="1" yoffset="2" xadvance="3"' in xml
        assert 'first="65" second="9829" amount="-1"' in xml
        assert xml.endswith("</font>\n")


class ExportTests(unittest.TestCase):
    def test_lua_preserves_frame_order_duration_and_slice(self):
        tags = [("idle", [[["ffffff"]], [["000000"]]], [80, 120])]
        script = aseprite.lua(["ffffff", "000000"], tags, "out.aseprite", key="card", margins=(0, 0, 0, 0))
        assert "local durations = {0.08,0.12}" in script
        assert 't.name = "idle"' in script
        assert "s.center = Rectangle(0, 0, 1, 1)" in script
        with self.assertRaises(ValueError):  # noqa: PT027 - Keep the test runner in the standard library.
            aseprite.lua([], [("bad", tags[0][1], [10])], "out")

    def test_export_uses_explicit_paths_and_no_shell(self):
        with tempfile.TemporaryDirectory() as directory, patch("art_kit.aseprite.subprocess.run") as run:
            root = Path(directory)
            aseprite.export(
                "/tool/aseprite",
                ["ffffff"],
                [("idle", [[["ffffff"]]], 80)],
                root / "a.aseprite",
                root / "a.png",
                root / "a.json",
            )
            assert run.call_count == 2
            assert run.call_args.args[0][-3:] == ["--format", "json-hash", "--list-tags"]


class VendorTests(unittest.TestCase):
    def test_exact_sync_rejects_extra_files_and_symlinks(self):
        spec = importlib.util.spec_from_file_location("vendor", Path(__file__).parents[1] / "scripts/vendor.py")
        vendor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vendor)
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / "source", Path(directory) / "target"
            source.mkdir()
            (source / "ART_KIT_COMMIT").write_text("revision\n")
            vendor.sync(False, source, target)
            vendor.sync(True, source, target)
            (target / "extra").write_text("extra")
            with self.assertRaises(ValueError):  # noqa: PT027 - Keep the test runner in the standard library.
                vendor.sync(True, source, target)

            alias = Path(directory) / "alias"
            alias.symlink_to(source, target_is_directory=True)
            with self.assertRaises(ValueError):  # noqa: PT027 - Keep the test runner in the standard library.
                vendor.sync(False, source, alias)
