import { arcPrimitive, ellipsePrimitive } from "./draw/ellipse.js";
import { polygonPrimitive, rectanglePrimitive, wideLine } from "./draw/linear.js";
import { plot, segment } from "./draw/pixels.js";
import type { RgbaImage } from "./rgbaImage.js";
import type { Point, Rgba } from "./types.js";

// Pillow 13.0.0 ImageDraw.Draw(image) on an RGBA image: every operation writes its ink bytes
// directly, without blending. Coordinates are truncated toward zero. Float arithmetic that Pillow
// performs in single precision is reproduced with Math.fround.

// Inclusive corner pixels of a shape's box: x1 >= x0 and y1 >= y0, so a box with x0 = x1 is one
// pixel wide.
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type XY = readonly [x: number, y: number];

function xy(points: readonly Point[]): XY[] {
  return points.map(({ x, y }) => [x, y] as const);
}

type Box = readonly [x0: number, y0: number, x1: number, y1: number];

function boxOf({ x0, x1, y0, y1 }: Bounds): Box {
  const box: Box = [x0, y0, x1, y1];
  if (!box.every(Number.isFinite)) {
    throw new RangeError("Bounds must be finite");
  }
  return box;
}

export interface ShapeStyle {
  fill?: Rgba;
  outline?: Rgba;
  // Outline width; 0 skips the outline. Defaults to 1.
  width?: number;
}

export interface LineStyle {
  fill: Rgba;
  width?: number;
}

export interface ArcStyle {
  fill: Rgba;
  width?: number;
}

// Pillow's default ink when neither fill nor outline is given.
const WHITE: Rgba = [255, 255, 255, 255];

const f32 = Math.fround;

function checkColour(colour: Rgba): Rgba {
  if (colour.length !== 4 || colour.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
    throw new RangeError("Colour must be four integers in 0..255");
  }
  return colour;
}

function checkWidth(width: number): number {
  if (!Number.isFinite(width)) {
    throw new RangeError("Stroke width must be finite");
  }
  return width;
}

function sameInk(a: Rgba | undefined, b: Rgba | undefined): boolean {
  return a !== undefined && b !== undefined && a.every((v, i) => v === b[i]);
}

// Pillow's (outline, fill) ink resolution: neither supplied means a white outline.
function inks(style: ShapeStyle): [Rgba | undefined, Rgba | undefined] {
  if (style.fill === undefined && style.outline === undefined) {
    return [WHITE, undefined];
  }
  return [
    style.outline === undefined ? undefined : checkColour(style.outline),
    style.fill === undefined ? undefined : checkColour(style.fill),
  ];
}

/* Pillow's C bindings: truncate coordinates and check box order */

// The box corners truncated toward zero, after checking their order.
function corners([x0, y0, x1, y1]: Box): Box {
  if (x1 < x0) {
    throw new RangeError("x1 must be greater than or equal to x0");
  }
  if (y1 < y0) {
    throw new RangeError("y1 must be greater than or equal to y0");
  }
  return [Math.trunc(x0), Math.trunc(y0), Math.trunc(x1), Math.trunc(y1)];
}

function drawPolygon(
  image: RgbaImage,
  points: readonly XY[],
  ink: Rgba,
  fill: boolean,
  width = 0,
  mask?: Uint8Array,
): void {
  if (points.length < 2) {
    throw new TypeError("Coordinate list must contain at least 2 coordinates");
  }
  polygonPrimitive(
    image,
    points.flatMap(([x, y]) => [Math.trunc(x), Math.trunc(y)]),
    ink,
    fill,
    width,
    mask,
  );
}

function drawLines(image: RgbaImage, points: readonly XY[], ink: Rgba, width: number): void {
  const xy = points.map(([x, y]) => [Math.trunc(x), Math.trunc(y)] as const);
  for (let i = 0; i + 1 < xy.length; i++) {
    const [x0, y0] = xy[i]!;
    const [x1, y1] = xy[i + 1]!;
    if (width === 1) {
      segment(image, x0, y0, x1, y1, ink);
    } else {
      wideLine(image, x0, y0, x1, y1, ink, width, undefined);
    }
  }
  if (width === 1 && xy.length > 1) {
    plot(image, xy[xy.length - 1]![0], xy[xy.length - 1]![1], ink);
  }
}

/* Public operations: Pillow's ImageDraw methods */

// Pillow ImageDraw.point: one pixel per point.
export function point(fill: Rgba, points: readonly Point[], image: RgbaImage): void {
  checkColour(fill);
  for (const { x, y } of points) {
    plot(image, Math.trunc(x), Math.trunc(y), fill);
  }
}

// Pillow ImageDraw.line: a polyline; width 1 includes the final point.
export function line(style: LineStyle, points: readonly Point[], image: RgbaImage): void {
  const fill = checkColour(style.fill);
  const width = checkWidth(style.width ?? 1);
  if (width === 0) {
    return;
  }
  drawLines(image, xy(points), fill, width);
}
// Pillow ImageDraw.polygon. A wider outline stays inside the filled area.
export function polygon(style: ShapeStyle, vertices: readonly Point[], image: RgbaImage): void {
  const points = xy(vertices);
  const [ink, fillInk] = inks(style);
  const width = checkWidth(style.width ?? 1);
  if (fillInk !== undefined) {
    drawPolygon(image, points, fillInk, true);
  }
  if (ink === undefined || sameInk(ink, fillInk) || width === 0) {
    return;
  }
  if (width === 1) {
    drawPolygon(image, points, ink, false, width);
    return;
  }
  const mask = new Uint8Array(image.width * image.height);
  const maskImage = {
    data: new Uint8Array(image.width * image.height * 4),
    height: image.height,
    width: image.width,
  };
  drawPolygon(maskImage, points, [1, 0, 0, 0], true);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = maskImage.data[i * 4]!;
  }
  drawPolygon(image, points, ink, false, width * 2 - 1, mask);
}

// Pillow ImageDraw.ellipse within the inclusive bounds.
export function ellipse(style: ShapeStyle, bounds: Bounds, image: RgbaImage): void {
  const box = boxOf(bounds);
  const [ink, fillInk] = inks(style);
  const width = checkWidth(style.width ?? 1);
  if (fillInk !== undefined) {
    ellipsePrimitive(image, ...corners(box), fillInk, true, 0);
  }
  if (ink !== undefined && !sameInk(ink, fillInk) && width !== 0) {
    ellipsePrimitive(image, ...corners(box), ink, false, width);
  }
}

// Pillow ImageDraw.arc: degrees clockwise from three o'clock.
export function arc(
  style: ArcStyle,
  bounds: Bounds,
  start: number,
  end: number,
  image: RgbaImage,
): void {
  const box = boxOf(bounds);
  const fill = checkColour(style.fill);
  const width = checkWidth(style.width ?? 1);
  if (width !== 0) {
    arcPrimitive(image, ...corners(box), f32(start), f32(end), fill, width);
  }
}

// Pillow ImageDraw.rectangle; the outline is drawn inside the bounds.
export function rectangle(style: ShapeStyle, bounds: Bounds, image: RgbaImage): void {
  const box = boxOf(bounds);
  const [ink, fillInk] = inks(style);
  const width = checkWidth(style.width ?? 1);
  if (fillInk !== undefined) {
    rectanglePrimitive(image, ...corners(box), fillInk, true, 0);
  }
  if (ink !== undefined && !sameInk(ink, fillInk) && width !== 0) {
    rectanglePrimitive(image, ...corners(box), ink, false, width);
  }
}
