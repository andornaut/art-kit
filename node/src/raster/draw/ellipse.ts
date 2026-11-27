import type { RgbaImage } from "../rgbaImage.js";
import type { Rgba } from "../types.js";
import { hline } from "./pixels.js";
import { roundAway } from "./rounding.js";

// The ports keep Pillow's C shape, which advances and clamps its coordinate parameters in place.
/* eslint-disable no-param-reassign */

// Quarter-ellipse deviations stay exact in doubles below this span.
const MAX_ELLIPSE_SPAN = 8192;

const f32 = Math.fround;

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
    if (a < 0 || b < 0) {
      return;
    }
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
    if (this.finished) {
      return undefined;
    }
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
      if (this.finished) {
        return undefined;
      }
      const y = this.py;
      let l = this.pl;
      const r = this.pr;
      let point: [number, number] | undefined;
      while ((point = this.outer.next()) !== undefined && point[1] <= y) {
        // Skip outer points up to the current row.
      }
      if (point === undefined) {
        this.finished = true;
      } else {
        [this.pr, this.py] = point;
      }
      while ((point = this.inner.next()) !== undefined && point[1] <= y) {
        l = point[0];
      }
      this.pl = point === undefined ? this.leftmost : point[0];
      if ((l > 0 || l < r) && y > 0) {
        this.buffer.push([l === 0 ? 2 : l, y, r]);
      }
      if (y > 0) {
        this.buffer.push([-r, y, -l]);
      }
      if (l > 0 || l < r) {
        this.buffer.push([l === 0 ? 2 : l, -y, r]);
      }
      this.buffer.push([-r, -y, -l]);
    }
    return this.buffer.pop();
  }
}

/* Half-plane clipping tree for arcs */

type ClipNode =
  | { type: "clip"; a: number; b: number; c: number }
  | { type: "and" | "or"; l: ClipNode; r: ClipNode };

interface ClipEvent {
  x: number;
  type: 1 | -1;
}

function clipNode(a: number, b: number, c: number): ClipNode {
  return { a, b, c, type: "clip" };
}

function transpose(node: ClipNode | undefined): void {
  if (node === undefined) {
    return;
  }
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
      { type: 1, x: x0 },
      { type: -1, x: x1 },
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
      if (a * x0 + b * y + c < eps) {
        x0 = roundAway(Math.max(x0, ix));
      }
      if (a * x1 + b * y + c < eps) {
        x1 = roundAway(Math.min(x1, ix));
      }
    }
    return x0 <= x1
      ? [
          { type: 1, x: x0 },
          { type: -1, x: x1 },
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
    if (
      e2 === undefined ||
      (e1 !== undefined && (e1.x < e2.x || (e1.x === e2.x && e1.type > e2.type)))
    ) {
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
        ((opens && k1 > 0 && k2 > 0) ||
          (t.type === -1 && tail !== undefined && tail.type === 1 && (k1 === 0 || k2 === 0))))
    ) {
      out.push(t);
    }
  }
  return out;
}

// Pillow's normalize_angles on single-precision angles: 0 <= start < 360, start <= end <= start + 360.
function normalizeAngles(start: number, end: number): [number, number] {
  if (f32(end - start) >= 360) {
    return [0, 360];
  }
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
    return { root: transposed.root, spans: new EllipseSpans(a, b, w) };
  }
  const spans = new EllipseSpans(a, b, w);
  [al, ar] = normalizeAngles(al, ar);
  if (ar === f32(al + 360)) {
    return { root: undefined, spans };
  }
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
    return { root: { l: lc, r: rc, type: span < 180 ? "and" : "or" }, spans };
  }
  const halfL = Math.trunc(f32(al / 180));
  const halfR = Math.trunc(f32(ar / 180));
  if ((halfL + halfR) % 2 === 1) {
    return {
      root: {
        l: { l: clipNode(0, halfL % 2 === 0 ? 1 : -1, 0), r: lc, type: "and" },
        r: { l: clipNode(0, halfR % 2 === 0 ? 1 : -1, 0), r: rc, type: "and" },
        type: "or",
      },
      spans,
    };
  }
  const combine = span < 180 ? "and" : "or";
  return {
    root: {
      l: { l: lc, r: rc, type: combine },
      r: clipNode(0, ar < 180 || ar > 540 ? 1 : -1, 0),
      type: combine,
    },
    spans,
  };
}

function drawClipped(
  image: RgbaImage,
  x0: number,
  y0: number,
  a: number,
  b: number,
  shape: ClippedEllipse,
  ink: Rgba,
): void {
  let span: Span | undefined;
  while ((span = shape.spans.next()) !== undefined) {
    const [sx0, sy, sx1] = span;
    const events = clip(shape.root, sx0, sy, sx1);
    for (let i = 0; i + 1 < events.length; i += 2) {
      const y = y0 + Math.trunc((sy + b) / 2);
      hline(
        image,
        x0 + Math.trunc((events[i]!.x + a) / 2),
        y,
        x0 + Math.trunc((events[i + 1]!.x + a) / 2),
        ink,
        undefined,
      );
    }
  }
}

function checkSpan(a: number, b: number): void {
  if (a >= MAX_ELLIPSE_SPAN || b >= MAX_ELLIPSE_SPAN) {
    throw new RangeError(`Ellipse box spans must be below ${MAX_ELLIPSE_SPAN}`);
  }
}

export function ellipsePrimitive(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Rgba,
  fill: boolean,
  width: number,
): void {
  const a = x1 - x0;
  const b = y1 - y0;
  if (a < 0 || b < 0) {
    return;
  }
  checkSpan(a, b);
  const spans = new EllipseSpans(a, b, fill ? a + b : width);
  let span: Span | undefined;
  while ((span = spans.next()) !== undefined) {
    const [sx0, sy, sx1] = span;
    hline(
      image,
      x0 + Math.trunc((sx0 + a) / 2),
      y0 + Math.trunc((sy + b) / 2),
      x0 + Math.trunc((sx1 + a) / 2),
      ink,
      undefined,
    );
  }
}

export function arcPrimitive(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  start: number,
  end: number,
  ink: Rgba,
  width: number,
): void {
  [start, end] = normalizeAngles(start, end);
  if (f32(start + 360) === end) {
    ellipsePrimitive(image, x0, y0, x1, y1, ink, false, width);
    return;
  }
  if (start === end) {
    return;
  }
  const a = x1 - x0;
  const b = y1 - y0;
  if (a < 0 || b < 0) {
    return;
  }
  checkSpan(a, b);
  drawClipped(image, x0, y0, a, b, arcInit(a, b, width, start, end), ink);
}
