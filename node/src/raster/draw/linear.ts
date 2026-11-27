import type { RgbaImage } from "../rgbaImage.js";
import type { Rgba } from "../types.js";
import { hline, type Mask, plot, segment } from "./pixels.js";
import { roundAway } from "./rounding.js";

// The ports keep Pillow's C shape, which advances and clamps its coordinate parameters in place.
/* eslint-disable no-param-reassign */

const f32 = Math.fround;

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
    dx: y0 === y1 ? 0 : f32((x1 - x0) / (y1 - y0)),
    x0,
    xmax: Math.max(x0, x1),
    xmin: Math.min(x0, x1),
    y0,
    ymax: Math.max(y0, y1),
    ymin: Math.min(y0, y1),
  };
}

function edgeX(e: Edge, y: number): number {
  return f32(f32((y - e.y0) * e.dx) + e.x0);
}

function polygonGeneric(image: RgbaImage, edges: readonly Edge[], ink: Rgba, mask: Mask): void {
  if (edges.length === 0) {
    return;
  }
  let ymin = image.height - 1;
  let ymax = 0;
  const table: Edge[] = [];
  for (const e of edges) {
    if (ymin > e.ymin) {
      ymin = e.ymin;
    }
    if (ymax < e.ymax) {
      ymax = e.ymax;
    }
    if (e.ymin === e.ymax) {
      hline(image, e.xmin, e.ymin, e.xmax, ink, mask);
      continue;
    }
    table.push(e);
  }
  if (ymin < 0) {
    ymin = 0;
  }
  if (ymax > image.height) {
    ymax = image.height;
  }
  const xx: number[] = [];
  for (; ymin <= ymax; ymin++) {
    xx.length = 0;
    for (let i = 0; i < table.length; i++) {
      const current = table[i]!;
      if (ymin < current.ymin || ymin > current.ymax) {
        continue;
      }
      xx.push(edgeX(current, ymin));
      if (ymin === current.ymax && ymin < ymax) {
        xx.push(xx[xx.length - 1]!);
      } else if ((ymin === current.ymin || ymin === current.ymax) && current.dx !== 0) {
        // Connect discontiguous corners.
        for (let k = 0; k < i; k++) {
          const other = table[k]!;
          if ((ymin !== other.ymin && ymin !== other.ymax) || other.dx === 0) {
            continue;
          }
          const last = xx.length - 1;
          if (roundAway(xx[last]!) !== roundAway(edgeX(other, ymin))) {
            continue;
          }
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

export function wideLine(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Rgba,
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

export function rectanglePrimitive(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Rgba,
  fill: boolean,
  width: number,
): void {
  if (y0 > y1) {
    [y0, y1] = [y1, y0];
  }
  if (fill) {
    if (y0 < 0) {
      y0 = 0;
    } else if (y0 >= image.height) {
      return;
    }
    if (y1 < 0) {
      return;
    } else if (y1 > image.height) {
      y1 = image.height;
    }
    for (let y = y0; y <= y1; y++) {
      hline(image, x0, y, x1, ink, undefined);
    }
    return;
  }
  if (width === 0) {
    width = 1;
  }
  for (let i = 0; i < width; i++) {
    hline(image, x0, y0 + i, x1, ink, undefined);
    hline(image, x0, y1 - i, x1, ink, undefined);
    segment(image, x1 - i, y0 + width, x1 - i, y1 - width + 1, ink);
    segment(image, x0 + i, y0 + width, x0 + i, y1 - width + 1, ink);
  }
}

// xy holds integer vertex pairs.
export function polygonPrimitive(
  image: RgbaImage,
  xy: readonly number[],
  ink: Rgba,
  fill: boolean,
  width: number,
  mask: Mask,
): void {
  const count = xy.length / 2;
  if (count <= 0) {
    return;
  }
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
    if (xy[i * 2] !== xy[0] || xy[i * 2 + 1] !== xy[1]) {
      edges.push(edge(xy[i * 2]!, xy[i * 2 + 1]!, xy[0]!, xy[1]!));
    }
    polygonGeneric(image, edges, ink, mask);
    return;
  }
  for (let i = 0; i < count; i++) {
    const j = i === count - 1 ? 0 : i + 1;
    if (width === 1) {
      segment(image, xy[i * 2]!, xy[i * 2 + 1]!, xy[j * 2]!, xy[j * 2 + 1]!, ink);
    } else {
      wideLine(image, xy[i * 2]!, xy[i * 2 + 1]!, xy[j * 2]!, xy[j * 2 + 1]!, ink, width, mask);
    }
  }
}
