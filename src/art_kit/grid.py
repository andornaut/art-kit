"""Mutable drawing grid; palettes and outline policy belong to the client."""

from collections.abc import Callable, Mapping, Sequence

Colour = str | None
Frame = list[list[Colour]]
Edge = Callable[[str], str]


def outline(edge: Edge, frame: Sequence[Sequence[Colour]], *, enabled=True, close=False) -> Frame:
    out = [list(row) for row in frame]
    if not enabled:
        return out
    height, width = len(frame), len(frame[0])
    for y in range(height):
        for x in range(width):
            if frame[y][x]:
                continue
            for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < width and 0 <= yy < height and frame[yy][xx]:
                    out[y][x] = edge(frame[yy][xx])
                    break
    if close:
        for x in range(width):
            if frame[-1][x]:
                out[-1][x] = edge(frame[-1][x])
    return out


class Grid:
    def __init__(self, palette: Mapping[str, str], w=32, h=32, *, edge: Edge | None = None):
        self.palette = palette
        self.w, self.h = w, h
        self.px: Frame = [[None] * w for _ in range(h)]
        self.edge = edge
        self.close = False

    def p(self, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = self.palette.get(c, c) if c else None

    def rect(self, x, y, w, h, c):
        for j in range(h):
            for i in range(w):
                self.p(x + i, y + j, c)

    def line(self, x0, y0, x1, y1, c):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.p(x0, y0, c)
            if (x0, y0) == (x1, y1):
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ell(self, cx, cy, rx, ry, c, sh=None, li=None):
        for y in range(self.h):
            for x in range(self.w):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1:
                    d = 0.7 * (dx + dy)
                    self.p(x, y, sh if sh and d > 0.5 else li if li and d < -0.72 else c)

    def blob(self, cx, cy, rx, ry, c, sh=None, li=None, power=2.6):
        for y in range(self.h):
            for x in range(self.w):
                dx, dy = abs(x + 0.5 - cx) / rx, abs(y + 0.5 - cy) / ry
                if dx**power + dy**power <= 1:
                    d = 0.7 * ((x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry)
                    self.p(x, y, sh if sh and d > 0.5 else li if li and d < -0.72 else c)

    def cel(self, cx, cy, rx, ry, c, sh=None, li=None, power=2):
        def inside(x, y, offset=0.0):
            dx, dy = abs(x + 0.5 - cx - offset) / rx, abs(y + 0.5 - cy - offset) / ry
            return dx**power + dy**power <= 1

        shade_w, light_w = max(1, 0.13 * (rx + ry)), max(1, 0.06 * (rx + ry))
        for y in range(self.h):
            for x in range(self.w):
                if not inside(x, y):
                    continue
                lit = (x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry < -0.7
                self.p(
                    x,
                    y,
                    sh if sh and not inside(x, y, -shade_w) else li if li and lit and not inside(x, y, light_w) else c,
                )

    def tri(self, a, b, c, col):
        def side(px, py, x1, y1, x2, y2):
            return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)

        for y in range(self.h):
            for x in range(self.w):
                px, py = x + 0.5, y + 0.5
                d1, d2, d3 = side(px, py, *a, *b), side(px, py, *b, *c), side(px, py, *c, *a)
                if not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0)):
                    self.p(x, y, col)

    def outlined(self, *, edge: Edge | None = None, enabled=True, close: bool | None = None):
        selected = edge or self.edge
        if selected is None and enabled:
            raise ValueError("An outline colour rule is required")
        return outline(selected, self.px, enabled=enabled, close=self.close if close is None else close)
