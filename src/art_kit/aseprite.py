"""Aseprite frame/tag serialization with explicit paths and executable."""

import json
import subprocess
import tempfile
from pathlib import Path

from art_kit.colour import rgb

LUA = """
local spr = Sprite({w}, {h}, ColorMode.RGB)
local pal = Palette({ncolours})
{palette}
spr:setPalette(pal)
local rgba = app.pixelColor.rgba
local frames = {frames}
local durations = {durations}
for i, px in ipairs(frames) do
  if i > 1 then spr:newFrame() end
  local img = spr.layers[1]:cel(i).image
  img:clear()
  for _, p in ipairs(px) do img:drawPixel(p[1], p[2], rgba(p[3], p[4], p[5], 255)) end
  spr.frames[i].duration = durations[i]
end
{tags}
{slice}spr:saveAs({out})
"""


def lua(palette, tags, output, *, key=None, margins=None):
    frames, durations, tag_lines, n = [], [], [], 0
    h, w = len(tags[0][1][0]), len(tags[0][1][0][0])
    for tag, fs, ms in tags:
        tag_lines.append(
            f"do local t = spr:newTag({n + 1}, {n + len(fs)}); t.name = {json.dumps(tag, ensure_ascii=False)} end"
        )
        times = ms if isinstance(ms, (list, tuple)) else [ms] * len(fs)
        if len(times) != len(fs):
            raise ValueError("Each frame requires one duration")
        for frame, duration in zip(fs, times, strict=True):
            points = []
            for y, row in enumerate(frame):
                for x, colour in enumerate(row):
                    if colour:
                        r, g, b = rgb(colour)
                        points.append(f"{{{x},{y},{r},{g},{b}}}")
            frames.append("{" + ",".join(points) + "}")
            durations.append(str(duration / 1000))
        n += len(fs)
    palette_entries = []
    for i, colour in enumerate(palette):
        r, g, b = rgb(colour)
        palette_entries.append(f"pal:setColor({i}, Color{{ r = {r}, g = {g}, b = {b} }})")
    palette_lines = "\n".join(palette_entries)
    slice_line = ""
    if margins:
        if key is None:
            raise ValueError("A slice requires a key")
        left, top, right, bottom = margins
        slice_line = (
            f"do local s = spr:newSlice(Rectangle(0, 0, {w}, {h})); s.name = {json.dumps(key, ensure_ascii=False)}; "
            f"s.center = Rectangle({left}, {top}, {w - left - right}, {h - top - bottom}) end\n"
        )
    return LUA.format(
        w=w,
        h=h,
        ncolours=len(palette),
        palette=palette_lines,
        frames="{" + ",\n".join(frames) + "}",
        durations="{" + ",".join(durations) + "}",
        tags="\n".join(tag_lines),
        slice=slice_line,
        out=json.dumps(str(output), ensure_ascii=False),
    )


def export(executable, palette, tags, source, sheet, data, *, key=None, margins=None, columns=None):
    """Write one source, sheet and JSON. The caller owns paths and manifest updates."""
    if columns is not None and (type(columns) is not int or columns <= 0):
        raise ValueError("columns must be a positive integer")
    source, sheet, data = Path(source), Path(sheet), Path(data)
    for path in (source, sheet, data):
        path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        script = Path(scratch) / "export.lua"
        script.write_text(lua(palette, tags, source, key=key, margins=margins), encoding="utf-8")
        # The executable is supplied by the caller; no shell or command discovery.
        subprocess.run([str(executable), "-b", "--script", str(script)], check=True)  # noqa: S603
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
    if columns is not None:
        command.extend(["--sheet-columns", str(columns)])
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)  # noqa: S603
