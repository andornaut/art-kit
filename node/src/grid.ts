export type Colour = string | null;
export type Frame = Colour[][];
export type Edge = (colour: string) => string;
type Point = readonly [number, number];
export interface OutlineOptions {
  enabled?: boolean;
  close?: boolean;
}

function outline(
  edge: Edge | null,
  frame: readonly (readonly Colour[])[],
  { enabled = true, close = false }: OutlineOptions = {},
): Frame {
  const out = frame.map((row) => [...row]);
  if (!enabled) return out;
  if (!edge) throw new Error("An outline colour rule is required");
  const height = frame.length,
    width = frame[0].length;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (frame[y][x]) continue;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const xx = x + dx,
          yy = y + dy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < height && frame[yy][xx]) {
          out[y][x] = edge(frame[yy][xx]!);
          break;
        }
      }
    }
  if (close)
    for (let x = 0; x < width; x++) {
      if (frame[height - 1][x])
        out[height - 1][x] = edge(frame[height - 1][x]!);
    }
  return out;
}

export class Grid {
  px: Frame;
  close = false;
  edge: Edge | null;
  constructor(
    public palette: Readonly<Record<string, string>>,
    public w = 32,
    public h = 32,
    { edge = null }: { edge?: Edge | null } = {},
  ) {
    this.edge = edge;
    this.px = Array.from({ length: h }, () => Array<Colour>(w).fill(null));
  }
  p(x: number, y: number, c: Colour): void {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x >= 0 && x < this.w && y >= 0 && y < this.h)
      this.px[y][x] = c
        ? Object.hasOwn(this.palette, c)
          ? this.palette[c]
          : c
        : null;
  }
  rect(x: number, y: number, w: number, h: number, c: Colour): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.p(x + i, y + j, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Colour): void {
    if (![x0, y0, x1, y1].every(Number.isInteger))
      throw new RangeError("Line coordinates must be integers");
    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      this.p(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  ell(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: Colour,
    sh: Colour = null,
    li: Colour = null,
  ): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = (x + 0.5 - cx) / rx,
          dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const d = 0.7 * (dx + dy);
          this.p(x, y, sh && d > 0.5 ? sh : li && d < -0.72 ? li : c);
        }
      }
  }
  blob(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: Colour,
    sh: Colour = null,
    li: Colour = null,
    power = 2.6,
  ): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = Math.abs(x + 0.5 - cx) / rx,
          dy = Math.abs(y + 0.5 - cy) / ry;
        if (dx ** power + dy ** power <= 1) {
          const d = 0.7 * ((x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry);
          this.p(x, y, sh && d > 0.5 ? sh : li && d < -0.72 ? li : c);
        }
      }
  }
  cel(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: Colour,
    sh: Colour = null,
    li: Colour = null,
    power = 2,
  ): void {
    const inside = (x: number, y: number, offset = 0): boolean =>
      (Math.abs(x + 0.5 - cx - offset) / rx) ** power +
        (Math.abs(y + 0.5 - cy - offset) / ry) ** power <=
      1;
    const shadeW = Math.max(1, 0.13 * (rx + ry)),
      lightW = Math.max(1, 0.06 * (rx + ry));
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (!inside(x, y)) continue;
        const lit = (x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry < -0.7;
        this.p(
          x,
          y,
          sh && !inside(x, y, -shadeW)
            ? sh
            : li && lit && !inside(x, y, lightW)
              ? li
              : c,
        );
      }
  }
  tri(a: Point, b: Point, c: Point, col: Colour): void {
    const side = (px: number, py: number, u: Point, v: Point): number =>
      (px - v[0]) * (u[1] - v[1]) - (u[0] - v[0]) * (py - v[1]);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const ds = [
          side(x + 0.5, y + 0.5, a, b),
          side(x + 0.5, y + 0.5, b, c),
          side(x + 0.5, y + 0.5, c, a),
        ];
        if (!(ds.some((d) => d < 0) && ds.some((d) => d > 0)))
          this.p(x, y, col);
      }
  }
  outlined({
    edge,
    enabled = true,
    close = this.close,
  }: OutlineOptions & { edge?: Edge | null } = {}): Frame {
    return outline(edge ?? this.edge, this.px, { enabled, close });
  }
}
