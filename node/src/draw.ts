import type { RgbaImage } from "./rgbaImage.js";

// Pillow 13.0.0 ImageDraw.Draw(image) on an RGBA image: every operation writes its ink bytes
// directly, without blending. Coordinates are truncated toward zero as Pillow's C layer casts them;
// rounded rectangles round their box first, as Pillow's Python layer does. Float arithmetic that
// Pillow performs in single precision is reproduced with Math.fround.

export type Colour = readonly [red: number, green: number, blue: number, alpha: number];
export type DrawPoint = readonly [x: number, y: number];
// Inclusive corners: x1 >= x0 and y1 >= y0.
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

export interface ShapeStyle {
  fill?: Colour;
  outline?: Colour;
  // Outline width; 0 skips the outline. Defaults to 1.
  width?: number;
}

export interface LineStyle {
  fill: Colour;
  width?: number;
  // "curve" rounds joints between segments wider than 4 pixels.
  joint?: "curve";
}

export interface ArcStyle {
  fill: Colour;
  width?: number;
}

export interface RoundedRectangleStyle extends ShapeStyle {
  radius: number;
  // Top-left, top-right, bottom-right, bottom-left. Defaults to all rounded.
  corners?: readonly [boolean, boolean, boolean, boolean];
}

// Pillow's default ink when neither fill nor outline is given.
const WHITE: Colour = [255, 255, 255, 255];
// Quarter-ellipse deviations stay exact in doubles below this span.
const MAX_ELLIPSE_SPAN = 8192;

const f32 = Math.fround;
// CPython's math.degrees and math.radians multiply by these constants.
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

function checkColour(colour: Colour): Colour {
  if (colour.length !== 4 || colour.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
    throw new RangeError(`Colour must be four integers in 0..255: ${String(colour)}`);
  }
  return colour;
}

function sameInk(a: Colour | undefined, b: Colour | undefined): boolean {
  return a !== undefined && b !== undefined && a.every((v, i) => v === b[i]);
}

// Pillow's (outline, fill) ink resolution: neither supplied means a white outline.
function inks(style: ShapeStyle): [Colour | undefined, Colour | undefined] {
  if (style.fill === undefined && style.outline === undefined) return [WHITE, undefined];
  return [
    style.outline === undefined ? undefined : checkColour(style.outline),
    style.fill === undefined ? undefined : checkColour(style.fill),
  ];
}

function checkBox(box: readonly number[]): void {
  if (box.length !== 4) throw new TypeError("Box must contain exactly 4 coordinates");
  if (box[2]! < box[0]!) throw new RangeError("x1 must be greater than or equal to x0");
  if (box[3]! < box[1]!) throw new RangeError("y1 must be greater than or equal to y0");
}

// C round-half-away-from-zero helpers. The F variants take single-precision operands, where
// Pillow adds 0.5F in single precision on the non-negative branch only.
function roundUpF(v: number): number {
  return v >= 0 ? Math.floor(f32(v + 0.5)) : -Math.floor(Math.abs(v) + 0.5);
}
function roundDownF(v: number): number {
  return v >= 0 ? Math.ceil(f32(v - 0.5)) : -Math.ceil(Math.abs(v) - 0.5);
}
function roundUpD(v: number): number {
  return v >= 0 ? Math.floor(v + 0.5) : -Math.floor(Math.abs(v) + 0.5);
}
function roundDownD(v: number): number {
  return v >= 0 ? Math.ceil(v - 0.5) : -Math.ceil(Math.abs(v) - 0.5);
}
// roundf and lround: half away from zero.
function roundAway(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

// Python float modulo: the result takes the divisor's sign.
function pyMod(a: number, b: number): number {
  let mod = a % b;
  if (mod) {
    if (b < 0 !== mod < 0) mod += b;
  } else {
    mod = b < 0 ? -0 : 0;
  }
  return mod;
}

// Python round(): half to even.
function pyRound(v: number): number {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/* Pixel primitives */

type Mask = Uint8Array | undefined;

function plot(image: RgbaImage, x: number, y: number, ink: Colour): void {
  if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
    image.data.set(ink, (y * image.width + x) * 4);
  }
}

function hline(image: RgbaImage, x0: number, y0: number, x1: number, ink: Colour, mask: Mask): void {
  if (y0 < 0 || y0 >= image.height) return;
  if (x0 < 0) x0 = 0;
  else if (x0 >= image.width) return;
  if (x1 < 0) return;
  else if (x1 >= image.width) x1 = image.width - 1;
  const row = y0 * image.width;
  for (; x0 <= x1; x0++) {
    if (mask === undefined || mask[row + x0]) image.data.set(ink, (row + x0) * 4);
  }
}

// Bresenham segment without its end point.
function segment(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, ink: Colour): void {
  let dy = y1 - y0;
  let ys: number;
  if (dy < 0) {
    dy = -dy;
    ys = -1;
  } else if (dy === 0) {
    if (x1 > x0) hline(image, x0, y0, x1 - 1, ink, undefined);
    else if (x0 > x1) hline(image, x1 + 1, y0, x0, ink, undefined);
    return;
  } else {
    ys = 1;
  }
  let dx = x1 - x0;
  let xs = 1;
  if (dx < 0) {
    dx = -dx;
    xs = -1;
  }
  if (dx === 0) {
    for (let i = 0; i < dy; i++, y0 += ys) plot(image, x0, y0, ink);
  } else if (dx > dy) {
    const n = dx;
    dy += dy;
    let e = dy - dx;
    dx += dx;
    for (let i = 0; i < n; i++) {
      plot(image, x0, y0, ink);
      if (e >= 0) {
        y0 += ys;
        e -= dx;
      }
      e += dy;
      x0 += xs;
    }
  } else {
    const n = dy;
    dx += dx;
    let e = dx - dy;
    dy += dy;
    for (let i = 0; i < n; i++) {
      plot(image, x0, y0, ink);
      if (e >= 0) {
        x0 += xs;
        e -= dy;
      }
      e += dx;
      y0 += ys;
    }
  }
}

/* Scanline polygon engine */

interface Edge {
  x0: number;
  y0: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  dx: number;
}

function edge(x0: number, y0: number, x1: number, y1: number): Edge {
  return {
    x0,
    y0,
    xmin: Math.min(x0, x1),
    xmax: Math.max(x0, x1),
    ymin: Math.min(y0, y1),
    ymax: Math.max(y0, y1),
    dx: y0 === y1 ? 0 : f32((x1 - x0) / (y1 - y0)),
  };
}

function edgeX(e: Edge, y: number): number {
  return f32(f32((y - e.y0) * e.dx) + e.x0);
}

function polygonGeneric(image: RgbaImage, edges: readonly Edge[], ink: Colour, mask: Mask): void {
  if (edges.length === 0) return;
  let ymin = image.height - 1;
  let ymax = 0;
  const table: Edge[] = [];
  for (const e of edges) {
    if (ymin > e.ymin) ymin = e.ymin;
    if (ymax < e.ymax) ymax = e.ymax;
    if (e.ymin === e.ymax) {
      hline(image, e.xmin, e.ymin, e.xmax, ink, mask);
      continue;
    }
    table.push(e);
  }
  if (ymin < 0) ymin = 0;
  if (ymax > image.height) ymax = image.height;
  const xx: number[] = [];
  for (; ymin <= ymax; ymin++) {
    xx.length = 0;
    for (let i = 0; i < table.length; i++) {
      const current = table[i]!;
      if (ymin < current.ymin || ymin > current.ymax) continue;
      xx.push(edgeX(current, ymin));
      if (ymin === current.ymax && ymin < ymax) {
        xx.push(xx[xx.length - 1]!);
      } else if ((ymin === current.ymin || ymin === current.ymax) && current.dx !== 0) {
        // Connect discontiguous corners.
        for (let k = 0; k < i; k++) {
          const other = table[k]!;
          if ((ymin !== other.ymin && ymin !== other.ymax) || other.dx === 0) continue;
          const last = xx.length - 1;
          if (roundAway(xx[last]!) !== roundAway(edgeX(other, ymin))) continue;
          const offset = ymin === current.ymax ? -1 : 1;
          const adjacent = edgeX(current, ymin + offset);
          if (ymin + offset >= other.ymin && ymin + offset <= other.ymax) {
            const adjacentOther = edgeX(other, ymin + offset);
            if (xx[last]! > f32(adjacent + 1) && xx[last]! > f32(adjacentOther + 1)) {
              xx[last] = f32(roundAway(Math.max(adjacent, adjacentOther)) + 1);
            } else if (xx[last]! < f32(adjacent - 1) && xx[last]! < f32(adjacentOther - 1)) {
              xx[last] = f32(roundAway(Math.min(adjacent, adjacentOther)) - 1);
            }
            break;
          }
        }
      }
    }
    xx.sort((a, b) => a - b);
    for (let i = 1; i < xx.length; i += 2) {
      hline(image, roundUpF(xx[i - 1]!), ymin, roundDownF(xx[i]!), ink, mask);
    }
  }
}

function wideLine(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Colour,
  width: number,
  mask: Mask,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) {
    plot(image, x0, y0, ink);
    return;
  }
  // Exact for integer operands, matching a correctly rounded hypot.
  const big = Math.sqrt(dx * dx + dy * dy);
  const small = (width - 1) / 2;
  const ratioMax = roundUpD(small) / big;
  const ratioMin = roundDownD(small) / big;
  const dxmin = roundDownD(ratioMin * dy);
  const dxmax = roundDownD(ratioMax * dy);
  const dymin = roundDownD(ratioMin * dx);
  const dymax = roundDownD(ratioMax * dx);
  const v: [number, number][] = [
    [x0 - dxmin, y0 + dymax],
    [x1 - dxmin, y1 + dymax],
    [x1 + dxmax, y1 - dymin],
    [x0 + dxmax, y0 - dymin],
  ];
  const edges = v.map(([ax, ay], i) => edge(ax, ay, v[(i + 1) % 4]![0], v[(i + 1) % 4]![1]));
  polygonGeneric(image, edges, ink, mask);
}

function rectanglePrimitive(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Colour,
  fill: boolean,
  width: number,
): void {
  if (y0 > y1) [y0, y1] = [y1, y0];
  if (fill) {
    if (y0 < 0) y0 = 0;
    else if (y0 >= image.height) return;
    if (y1 < 0) return;
    else if (y1 > image.height) y1 = image.height;
    for (let y = y0; y <= y1; y++) hline(image, x0, y, x1, ink, undefined);
    return;
  }
  if (width === 0) width = 1;
  for (let i = 0; i < width; i++) {
    hline(image, x0, y0 + i, x1, ink, undefined);
    hline(image, x0, y1 - i, x1, ink, undefined);
    segment(image, x1 - i, y0 + width, x1 - i, y1 - width + 1, ink);
    segment(image, x0 + i, y0 + width, x0 + i, y1 - width + 1, ink);
  }
}

// xy holds integer vertex pairs.
function polygonPrimitive(
  image: RgbaImage,
  xy: readonly number[],
  ink: Colour,
  fill: boolean,
  width: number,
  mask: Mask,
): void {
  const count = xy.length / 2;
  if (count <= 0) return;
  if (fill) {
    const edges: Edge[] = [];
    let i = 0;
    for (; i < count - 1; i++) {
      const [x0, y0, x1, y1] = [xy[i * 2]!, xy[i * 2 + 1]!, xy[i * 2 + 2]!, xy[i * 2 + 3]!];
      if (y0 === y1 && i !== 0 && y0 === xy[i * 2 - 1]) {
        // A horizontal edge continuing the previous horizontal edge extends it.
        const last = edges[edges.length - 1]!;
        if (x1 > x0 && x0 > xy[i * 2 - 2]!) {
          last.xmax = x1;
          continue;
        } else if (x1 < x0 && x0 < xy[i * 2 - 2]!) {
          last.xmin = x1;
          continue;
        }
      }
      edges.push(edge(x0, y0, x1, y1));
    }
    if (xy[i * 2] !== xy[0] || xy[i * 2 + 1] !== xy[1]) edges.push(edge(xy[i * 2]!, xy[i * 2 + 1]!, xy[0]!, xy[1]!));
    polygonGeneric(image, edges, ink, mask);
    return;
  }
  for (let i = 0; i < count; i++) {
    const j = i === count - 1 ? 0 : i + 1;
    if (width === 1) segment(image, xy[i * 2]!, xy[i * 2 + 1]!, xy[j * 2]!, xy[j * 2 + 1]!, ink);
    else wideLine(image, xy[i * 2]!, xy[i * 2 + 1]!, xy[j * 2]!, xy[j * 2 + 1]!, ink, width, mask);
  }
}

/* Ellipse engine: quarter ellipses on a doubled integer grid */

class Quarter {
  a = 0;
  b = 0;
  cx = 0;
  cy = 0;
  ex = 0;
  ey = 0;
  a2 = 0;
  b2 = 0;
  a2b2 = 0;
  finished = true;

  constructor(a: number, b: number) {
    if (a < 0 || b < 0) return;
    this.a = a;
    this.b = b;
    this.cx = a;
    this.cy = b % 2;
    this.ex = a % 2;
    this.ey = b;
    this.a2 = a * a;
    this.b2 = b * b;
    this.a2b2 = this.a2 * this.b2;
    this.finished = false;
  }

  delta(x: number, y: number): number {
    return Math.abs(this.a2 * y * y + this.b2 * x * x - this.a2b2);
  }

  // The next point, or undefined when finished.
  next(): [number, number] | undefined {
    if (this.finished) return undefined;
    const result: [number, number] = [this.cx, this.cy];
    if (this.cx === this.ex && this.cy === this.ey) {
      this.finished = true;
    } else {
      let nx = this.cx;
      let ny = this.cy + 2;
      let ndelta = this.delta(nx, ny);
      if (nx > 1) {
        let newdelta = this.delta(this.cx - 2, this.cy + 2);
        if (ndelta > newdelta) {
          nx = this.cx - 2;
          ny = this.cy + 2;
          ndelta = newdelta;
        }
        newdelta = this.delta(this.cx - 2, this.cy);
        if (ndelta > newdelta) {
          nx = this.cx - 2;
          ny = this.cy;
        }
      }
      this.cx = nx;
      this.cy = ny;
    }
    return result;
  }
}

type Span = [x0: number, y: number, x1: number];

// Horizontal spans of an ellipse ring of width w, in doubled coordinates around the centre.
class EllipseSpans {
  outer: Quarter;
  inner: Quarter = new Quarter(-1, -1);
  py = 0;
  pl = 0;
  pr = 0;
  buffer: Span[] = [];
  finished: boolean;
  leftmost: number;

  constructor(a: number, b: number, w: number) {
    this.leftmost = a % 2;
    this.outer = new Quarter(a, b);
    const first = w < 1 ? undefined : this.outer.next();
    if (first === undefined) {
      this.finished = true;
    } else {
      [this.pr, this.py] = first;
      this.finished = false;
      this.inner = new Quarter(a - 2 * (w - 1), b - 2 * (w - 1));
      this.pl = this.leftmost;
    }
  }

  next(): Span | undefined {
    if (this.buffer.length === 0) {
      if (this.finished) return undefined;
      const y = this.py;
      let l = this.pl;
      const r = this.pr;
      let point: [number, number] | undefined;
      while ((point = this.outer.next()) !== undefined && point[1] <= y) {}
      if (point === undefined) {
        this.finished = true;
      } else {
        [this.pr, this.py] = point;
      }
      while ((point = this.inner.next()) !== undefined && point[1] <= y) l = point[0];
      this.pl = point === undefined ? this.leftmost : point[0];
      if ((l > 0 || l < r) && y > 0) this.buffer.push([l === 0 ? 2 : l, y, r]);
      if (y > 0) this.buffer.push([-r, y, -l]);
      if (l > 0 || l < r) this.buffer.push([l === 0 ? 2 : l, -y, r]);
      this.buffer.push([-r, -y, -l]);
    }
    return this.buffer.pop();
  }
}

/* Half-plane clipping tree for arcs and pie slices */

type ClipNode =
  | { type: "clip"; a: number; b: number; c: number }
  | { type: "and" | "or"; l: ClipNode; r: ClipNode };

interface ClipEvent {
  x: number;
  type: 1 | -1;
}

function clipNode(a: number, b: number, c: number): ClipNode {
  return { type: "clip", a, b, c };
}

function transpose(node: ClipNode | undefined): void {
  if (node === undefined) return;
  if (node.type === "clip") {
    [node.a, node.b] = [node.b, node.a];
  } else {
    transpose(node.l);
    transpose(node.r);
  }
}

function clip(node: ClipNode | undefined, x0: number, y: number, x1: number): ClipEvent[] {
  if (node === undefined) {
    return [
      { x: x0, type: 1 },
      { x: x1, type: -1 },
    ];
  }
  if (node.type === "clip") {
    const eps = 1e-9;
    const { a, b, c } = node;
    if (Math.abs(a) < eps) {
      if (b * y + c < -eps) {
        x0 = 1;
        x1 = 0;
      }
    } else {
      const ix = -(b * y + c) / a;
      if (a * x0 + b * y + c < eps) x0 = roundAway(Math.max(x0, ix));
      if (a * x1 + b * y + c < eps) x1 = roundAway(Math.min(x1, ix));
    }
    return x0 <= x1
      ? [
          { x: x0, type: 1 },
          { x: x1, type: -1 },
        ]
      : [];
  }
  const l1 = clip(node.l, x0, y, x1);
  const l2 = clip(node.r, x0, y, x1);
  const out: ClipEvent[] = [];
  let [i1, i2, k1, k2] = [0, 0, 0, 0];
  while (i1 < l1.length || i2 < l2.length) {
    let t: ClipEvent;
    const e1 = l1[i1];
    const e2 = l2[i2];
    if (e2 === undefined || (e1 !== undefined && (e1.x < e2.x || (e1.x === e2.x && e1.type > e2.type)))) {
      t = e1!;
      k1 += t.type;
      i1++;
    } else {
      t = e2;
      k2 += t.type;
      i2++;
    }
    const tail = out[out.length - 1];
    const opens = t.type === 1 && (tail === undefined || tail.type === -1);
    if (
      (node.type === "or" && (opens || (t.type === -1 && k1 === 0 && k2 === 0))) ||
      (node.type === "and" &&
        ((opens && k1 > 0 && k2 > 0) || (t.type === -1 && tail !== undefined && tail.type === 1 && (k1 === 0 || k2 === 0))))
    ) {
      out.push(t);
    }
  }
  return out;
}

// Pillow's normalize_angles on single-precision angles: 0 <= start < 360, start <= end <= start + 360.
function normalizeAngles(start: number, end: number): [number, number] {
  if (f32(end - start) >= 360) return [0, 360];
  const al = f32((start < 0 ? 360 - (-start % 360) : start) % 360);
  const ar = f32(al + ((end < al ? 360 - (f32(al - end) % 360) : f32(end - al)) % 360));
  return [al, ar];
}

interface ClippedEllipse {
  spans: EllipseSpans;
  root: ClipNode | undefined;
}

function arcInit(a: number, b: number, w: number, al: number, ar: number): ClippedEllipse {
  if (a < b) {
    const transposed = arcInit(b, a, w, f32(90 - ar), f32(90 - al));
    transpose(transposed.root);
    return { spans: new EllipseSpans(a, b, w), root: transposed.root };
  }
  const spans = new EllipseSpans(a, b, w);
  [al, ar] = normalizeAngles(al, ar);
  if (ar === f32(al + 360)) return { spans, root: undefined };
  const lc = clipNode(
    -a * Math.sin((al * Math.PI) / 180),
    b * Math.cos((al * Math.PI) / 180),
    ((a * a - b * b) * Math.sin((al * Math.PI) / 90)) / 2,
  );
  const rc = clipNode(
    a * Math.sin((ar * Math.PI) / 180),
    -b * Math.cos((ar * Math.PI) / 180),
    ((b * b - a * a) * Math.sin((ar * Math.PI) / 90)) / 2,
  );
  const span = f32(ar - al);
  if (al % 180 === 0 || ar % 180 === 0) {
    return { spans, root: { type: span < 180 ? "and" : "or", l: lc, r: rc } };
  }
  const halfL = Math.trunc(f32(al / 180));
  const halfR = Math.trunc(f32(ar / 180));
  if ((halfL + halfR) % 2 === 1) {
    return {
      spans,
      root: {
        type: "or",
        l: { type: "and", l: clipNode(0, halfL % 2 === 0 ? 1 : -1, 0), r: lc },
        r: { type: "and", l: clipNode(0, halfR % 2 === 0 ? 1 : -1, 0), r: rc },
      },
    };
  }
  const combine = span < 180 ? "and" : "or";
  return {
    spans,
    root: { type: combine, l: { type: combine, l: lc, r: rc }, r: clipNode(0, ar < 180 || ar > 540 ? 1 : -1, 0) },
  };
}

function pieInit(a: number, b: number, w: number, al: number, ar: number): ClippedEllipse {
  const spans = new EllipseSpans(a, b, w);
  const xl = a * Math.cos(al * Math.PI / 180);
  const xr = a * Math.cos(ar * Math.PI / 180);
  const yl = b * Math.sin(al * Math.PI / 180);
  const yr = b * Math.sin(ar * Math.PI / 180);
  const span = f32(ar - al);
  let root: ClipNode = { type: span < 180 ? "and" : "or", l: clipNode(-yl, xl, 0), r: clipNode(yr, -xr, 0) };
  // One more half-plane avoids spikes.
  if (span < 90) root = { type: "and", l: root, r: clipNode((xl + xr) / 2, (yl + yr) / 2, 0) };
  return { spans, root };
}

function drawClipped(image: RgbaImage, x0: number, y0: number, a: number, b: number, shape: ClippedEllipse, ink: Colour): void {
  let span: Span | undefined;
  while ((span = shape.spans.next()) !== undefined) {
    const [sx0, sy, sx1] = span;
    const events = clip(shape.root, sx0, sy, sx1);
    for (let i = 0; i + 1 < events.length; i += 2) {
      const y = y0 + Math.trunc((sy + b) / 2);
      hline(image, x0 + Math.trunc((events[i]!.x + a) / 2), y, x0 + Math.trunc((events[i + 1]!.x + a) / 2), ink, undefined);
    }
  }
}

function checkSpan(a: number, b: number): void {
  if (a >= MAX_ELLIPSE_SPAN || b >= MAX_ELLIPSE_SPAN) throw new RangeError(`Ellipse box spans must be below ${MAX_ELLIPSE_SPAN}`);
}

function ellipsePrimitive(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, ink: Colour, fill: boolean, width: number): void {
  const a = x1 - x0;
  const b = y1 - y0;
  if (a < 0 || b < 0) return;
  checkSpan(a, b);
  const spans = new EllipseSpans(a, b, fill ? a + b : width);
  let span: Span | undefined;
  while ((span = spans.next()) !== undefined) {
    const [sx0, sy, sx1] = span;
    hline(image, x0 + Math.trunc((sx0 + a) / 2), y0 + Math.trunc((sy + b) / 2), x0 + Math.trunc((sx1 + a) / 2), ink, undefined);
  }
}

function arcPrimitive(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, start: number, end: number, ink: Colour, width: number): void {
  [start, end] = normalizeAngles(start, end);
  if (f32(start + 360) === end) {
    ellipsePrimitive(image, x0, y0, x1, y1, ink, false, width);
    return;
  }
  if (start === end) return;
  const a = x1 - x0;
  const b = y1 - y0;
  if (a < 0 || b < 0) return;
  checkSpan(a, b);
  drawClipped(image, x0, y0, a, b, arcInit(a, b, width, start, end), ink);
}

// Filled pie slice only.
function pieslicePrimitive(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, start: number, end: number, ink: Colour): void {
  [start, end] = normalizeAngles(start, end);
  if (f32(start + 360) === end) {
    ellipsePrimitive(image, x0, y0, x1, y1, ink, true, 0);
    return;
  }
  if (start === end) return;
  const a = x1 - x0;
  const b = y1 - y0;
  if (a < 0 || b < 0) return;
  checkSpan(a, b);
  drawClipped(image, x0, y0, a, b, pieInit(a, b, x1 + y1 - x0 - y0, start, end), ink);
}

/* Pillow's C bindings: truncate coordinates and check box order */

function boxInts(box: readonly number[]): [number, number, number, number] {
  checkBox(box);
  return [Math.trunc(box[0]!), Math.trunc(box[1]!), Math.trunc(box[2]!), Math.trunc(box[3]!)];
}

function drawRectangle(image: RgbaImage, box: readonly number[], ink: Colour, fill: boolean, width = 0): void {
  const [x0, y0, x1, y1] = boxInts(box);
  rectanglePrimitive(image, x0, y0, x1, y1, ink, fill, width);
}

function drawEllipse(image: RgbaImage, box: readonly number[], ink: Colour, fill: boolean, width = 0): void {
  const [x0, y0, x1, y1] = boxInts(box);
  ellipsePrimitive(image, x0, y0, x1, y1, ink, fill, width);
}

function drawArc(image: RgbaImage, box: readonly number[], start: number, end: number, ink: Colour, width: number): void {
  const [x0, y0, x1, y1] = boxInts(box);
  arcPrimitive(image, x0, y0, x1, y1, f32(start), f32(end), ink, width);
}

function drawPieslice(image: RgbaImage, box: readonly number[], start: number, end: number, ink: Colour): void {
  const [x0, y0, x1, y1] = boxInts(box);
  pieslicePrimitive(image, x0, y0, x1, y1, f32(start), f32(end), ink);
}

function drawPolygon(image: RgbaImage, points: readonly DrawPoint[], ink: Colour, fill: boolean, width = 0, mask?: Uint8Array): void {
  if (points.length < 2) throw new TypeError("Coordinate list must contain at least 2 coordinates");
  polygonPrimitive(image, points.flatMap(([x, y]) => [Math.trunc(x), Math.trunc(y)]), ink, fill, width, mask);
}

function drawLines(image: RgbaImage, points: readonly DrawPoint[], ink: Colour, width: number): void {
  const xy = points.map(([x, y]) => [Math.trunc(x), Math.trunc(y)] as const);
  for (let i = 0; i + 1 < xy.length; i++) {
    const [x0, y0] = xy[i]!;
    const [x1, y1] = xy[i + 1]!;
    if (width === 1) segment(image, x0, y0, x1, y1, ink);
    else wideLine(image, x0, y0, x1, y1, ink, width, undefined);
  }
  if (width === 1 && xy.length > 1) plot(image, xy[xy.length - 1]![0], xy[xy.length - 1]![1], ink);
}

/* Public operations: Pillow's ImageDraw methods */

// Pillow ImageDraw.point: one pixel per point.
export function point(fill: Colour, points: readonly DrawPoint[], image: RgbaImage): void {
  checkColour(fill);
  for (const [x, y] of points) plot(image, Math.trunc(x), Math.trunc(y), fill);
}

// Pillow ImageDraw.line: a polyline; width 1 includes the final point.
export function line(style: LineStyle, points: readonly DrawPoint[], image: RgbaImage): void {
  const fill = checkColour(style.fill);
  const width = style.width ?? 1;
  if (width === 0) return;
  drawLines(image, points, fill, width);
  if (style.joint !== "curve" || width <= 4) return;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const angles = [
      [points[i - 1]!, p],
      [p, points[i + 1]!],
    ].map(([s, e]) => pyMod(RAD_TO_DEG * Math.atan2(e![0] - s![0], s![1] - e![1]), 360)) as [number, number];
    if (angles[0] === angles[1]) continue;
    const coordAtAngle = ([x, y]: DrawPoint, angle: number): DrawPoint => {
      angle -= 90;
      const distance = width / 2 - 1;
      const offset = (d: number) => (d > 0 ? Math.floor(d) : Math.ceil(d));
      return [x + offset(distance * Math.cos(DEG_TO_RAD * angle)), y + offset(distance * Math.sin(DEG_TO_RAD * angle))];
    };
    const flipped =
      (angles[1] > angles[0] && angles[1] - 180 > angles[0]) || (angles[1] < angles[0] && angles[1] + 180 > angles[0]);
    const box = [p[0] - width / 2 + 1, p[1] - width / 2 + 1, p[0] + width / 2 - 1, p[1] + width / 2 - 1];
    const [start, end] = flipped ? [angles[1] + 90, angles[0] + 90] : [angles[0] - 90, angles[1] - 90];
    drawPieslice(image, box, start - 90, end - 90, fill);
    if (width > 8) {
      // Cover potential gaps between the line and the joint.
      const turn = flipped ? 90 : -90;
      line({ fill, width: 3 }, [coordAtAngle(p, angles[0] + turn), p, coordAtAngle(p, angles[1] + turn)], image);
    }
  }
}

// Pillow ImageDraw.polygon. A wider outline stays inside the filled area.
export function polygon(style: ShapeStyle, points: readonly DrawPoint[], image: RgbaImage): void {
  const [ink, fillInk] = inks(style);
  const width = style.width ?? 1;
  if (fillInk !== undefined) drawPolygon(image, points, fillInk, true);
  if (ink === undefined || sameInk(ink, fillInk) || width === 0) return;
  if (width === 1) {
    drawPolygon(image, points, ink, false, width);
    return;
  }
  const mask = new Uint8Array(image.width * image.height);
  const maskImage = { data: new Uint8Array(image.width * image.height * 4), height: image.height, width: image.width };
  drawPolygon(maskImage, points, [1, 0, 0, 0], true);
  for (let i = 0; i < mask.length; i++) mask[i] = maskImage.data[i * 4]!;
  drawPolygon(image, points, ink, false, width * 2 - 1, mask);
}

// Pillow ImageDraw.ellipse within the inclusive box.
export function ellipse(style: ShapeStyle, box: Box, image: RgbaImage): void {
  const [ink, fillInk] = inks(style);
  const width = style.width ?? 1;
  if (fillInk !== undefined) drawEllipse(image, box, fillInk, true);
  if (ink !== undefined && !sameInk(ink, fillInk) && width !== 0) drawEllipse(image, box, ink, false, width);
}

// Pillow ImageDraw.arc: degrees clockwise from three o'clock.
export function arc(style: ArcStyle, box: Box, start: number, end: number, image: RgbaImage): void {
  const fill = checkColour(style.fill);
  const width = style.width ?? 1;
  if (width !== 0) drawArc(image, box, start, end, fill, width);
}

// Pillow ImageDraw.rectangle; the outline is drawn inside the box.
export function rectangle(style: ShapeStyle, box: Box, image: RgbaImage): void {
  const [ink, fillInk] = inks(style);
  const width = style.width ?? 1;
  if (fillInk !== undefined) drawRectangle(image, box, fillInk, true);
  if (ink !== undefined && !sameInk(ink, fillInk) && width !== 0) drawRectangle(image, box, ink, false, width);
}

// Pillow ImageDraw.rounded_rectangle, composed of pie slices, arcs and rectangles.
export function roundedRectangle(style: RoundedRectangleStyle, box: Box, image: RgbaImage): void {
  if (box.length !== 4) throw new TypeError("Box must contain exactly 4 coordinates");
  let [x0, y0, x1, y1] = box;
  if (x1 < x0) throw new RangeError("x1 must be greater than or equal to x0");
  if (y1 < y0) throw new RangeError("y1 must be greater than or equal to y0");
  const corners = style.corners ?? [true, true, true, true];
  const width = style.width ?? 1;
  let d = Math.min(x1 - x0, y1 - y0, style.radius * 2);
  [x0, y0, x1, y1] = [pyRound(x0), pyRound(y0), pyRound(x1), pyRound(y1)];
  let fullX = false;
  let fullY = false;
  if (corners.every(Boolean)) {
    fullX = d >= x1 - x0 - 1;
    if (fullX) d = x1 - x0;
    fullY = d >= y1 - y0 - 1;
    if (fullY) d = y1 - y0;
    if (fullX && fullY) {
      ellipse(style, box, image);
      return;
    }
  }
  if (d === 0 || !corners.some(Boolean)) {
    rectangle(style, box, image);
    return;
  }
  const r = Math.trunc(Math.floor(d / 2));
  const [ink, fillInk] = inks(style);
  const drawCorners = (pieslice: boolean, colour: Colour) => {
    let parts: [number[], number, number][];
    if (fullX) {
      parts = [
        [[x0, y0, x0 + d, y0 + d], 180, 360],
        [[x0, y1 - d, x0 + d, y1], 0, 180],
      ];
    } else if (fullY) {
      parts = [
        [[x0, y0, x0 + d, y0 + d], 90, 270],
        [[x1 - d, y0, x1, y0 + d], 270, 90],
      ];
    } else {
      const all: [number[], number, number][] = [
        [[x0, y0, x0 + d, y0 + d], 180, 270],
        [[x1 - d, y0, x1, y0 + d], 270, 360],
        [[x1 - d, y1 - d, x1, y1], 0, 90],
        [[x0, y1 - d, x0 + d, y1], 90, 180],
      ];
      parts = all.filter((_, i) => corners[i]);
    }
    for (const [part, start, end] of parts) {
      if (pieslice) drawPieslice(image, part, start, end, colour);
      else drawArc(image, part, start, end, colour, width);
    }
  };
  if (fillInk !== undefined) {
    drawCorners(true, fillInk);
    if (fullX) drawRectangle(image, [x0, y0 + r + 1, x1, y1 - r - 1], fillInk, true);
    else if (x1 - r - 1 >= x0 + r + 1) drawRectangle(image, [x0 + r + 1, y0, x1 - r - 1, y1], fillInk, true);
    if (!fullX && !fullY) {
      const left = [x0, y0, x0 + r, y1];
      if (corners[0]) left[1] += r + 1;
      if (corners[3]) left[3] -= r + 1;
      drawRectangle(image, left, fillInk, true);
      const right = [x1 - r, y0, x1, y1];
      if (corners[1]) right[1] += r + 1;
      if (corners[2]) right[3] -= r + 1;
      drawRectangle(image, right, fillInk, true);
    }
  }
  if (ink === undefined || sameInk(ink, fillInk) || width === 0) return;
  drawCorners(false, ink);
  if (!fullX) {
    const top = [x0, y0, x1, y0 + width - 1];
    if (corners[0]) top[0] += r + 1;
    if (corners[1]) top[2] -= r + 1;
    drawRectangle(image, top, ink, true);
    const bottom = [x0, y1 - width + 1, x1, y1];
    if (corners[3]) bottom[0] += r + 1;
    if (corners[2]) bottom[2] -= r + 1;
    drawRectangle(image, bottom, ink, true);
  }
  if (!fullY) {
    const left = [x0, y0, x0 + width - 1, y1];
    if (corners[0]) left[1] += r + 1;
    if (corners[3]) left[3] -= r + 1;
    drawRectangle(image, left, ink, true);
    const right = [x1 - width + 1, y0, x1, y1];
    if (corners[1]) right[1] += r + 1;
    if (corners[2]) right[3] -= r + 1;
    drawRectangle(image, right, ink, true);
  }
}
