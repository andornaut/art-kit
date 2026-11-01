"""Check PNG and JSON bytes through original and shared Aseprite export paths."""

import argparse
import importlib
import subprocess
import sys
import tempfile
from pathlib import Path

from art_kit import aseprite


def compare(root, executable):
    sys.path.insert(0, str(root / "art/tools"))
    pixel = importlib.import_module("pixel")
    dog = hasattr(pixel, "depth_settled")
    grid = pixel.Grid(8, 8)
    grid.ell(4, 4, 2, 2, "white")
    tags = [("idle", [grid.px, list(reversed(grid.px))], [80, 120]), ("tap", [grid.px], 60)]
    margins = None if dog else (1, 1, 1, 1)
    with tempfile.TemporaryDirectory() as directory:
        source, sheet, data = (Path(directory) / f"sprite.{suffix}" for suffix in ("aseprite", "png", "json"))
        script = Path(directory) / "original.lua"
        original = pixel._lua(tags, str(source)) if dog else pixel._lua(tags, str(source), "sprite", margins)  # noqa: SLF001 - Compare the existing serialization boundary.
        script.write_text(original)
        subprocess.run([str(executable), "-b", "--script", str(script)], check=True)  # noqa: S603 - Explicit fixture executable, no shell.
        command = [
            str(executable),
            "-b",
            str(source),
            "--sheet",
            str(sheet),
            "--data",
            str(data),
            "--format",
            "json-hash",
            "--list-tags",
        ]
        if margins:
            command.append("--list-slices")
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)  # noqa: S603 - Explicit fixture executable, no shell.
        old_png, old_json = sheet.read_bytes(), data.read_bytes()
        aseprite.export(str(executable), pixel.PALETTE, tags, source, sheet, data, key="sprite", margins=margins)
        if (old_png, old_json) != (sheet.read_bytes(), data.read_bytes()):
            raise ValueError("Aseprite PNG/JSON/tags differ from the original exporter")
        print(f"{'Dog' if dog else 'Chibi'}: Aseprite PNG/JSON bytes, frame tags, durations and slices match")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("executable", type=Path)
    args = parser.parse_args()
    compare(args.snapshot.resolve(), args.executable.resolve())
