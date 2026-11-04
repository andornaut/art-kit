import { rgb } from "./colour.js";
import type { Point, Rect } from "./geometry.js";
import type { Frame } from "./grid.js";
import type { RgbaImage } from "./rgbaImage.js";

// Straight (non-premultiplied) RGBA operations reproducing Pillow 13.0.0 integer maths. An RGB
// image is modelled as an RgbaImage whose alpha is 255. Fill and paste functions mutate their
// target; every other function returns a new image or plane.

/** One 8-bit channel (Pillow mode "L"), one byte per pixel, row by row from the top-left. */
export interface Plane {
  data: Uint8Array;
  height: number;
  width: number;
}
export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];
// Structural copies of the frames types, so this subpath needs no Skia declarations.
export type ColourContext =
  | Readonly<Record<string, string>>
  | { resolveRgb: (colour: string) => Rgb };
export type Tag = readonly [
  name: string,
  frames: readonly Frame[],
  duration: unknown,
];
export type Sprite = readonly [name: string, tags: readonly Tag[]];
export interface ContactSheetOptions {
  resolveRgb: (colour: string) => Rgb;
  background: Rgb;
  /** "first-frame" sizes cells from each row's first frame (Python art_kit 0.5.0); "all-frames" matches frames.renderContactSheet. */
  cells: "first-frame" | "all-frames";
  scale?: number;
  gap?: number;
}

function integer(value: number, name: string): void {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${name} must be a safe integer`);
}
function size(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer`);
}
function point({ x, y }: Point): void {
  integer(x, "x");
  integer(y, "y");
}
function rect(r: Rect): void {
  point(r);
  size(r.width, "Width");
  size(r.height, "Height");
}
function image(im: RgbaImage): void {
  size(im.width, "Image width");
  size(im.height, "Image height");
  if (im.data.length !== im.width * im.height * 4)
    throw new RangeError("Image data must hold width * height * 4 bytes");
}
function plane(p: Plane): void {
  size(p.width, "Plane width");
  size(p.height, "Plane height");
  if (p.data.length !== p.width * p.height)
    throw new RangeError("Plane data must hold width * height bytes");
}
function byte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new RangeError(`${name} must be an integer from 0 to 255`);
}
function colour(value: readonly number[], length: number): void {
  if (value.length !== length)
    throw new RangeError(`Colour must have ${length} channels`);
  value.forEach((channel) => byte(channel, "Colour channel"));
}
function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive safe integer`);
}

// The part of a width x height block placed at `at` that lies inside image: target origin,
// source origin and extent, or undefined when nothing overlaps (Pillow ImagingPaste clipping).
function clip(
  at: Point,
  width: number,
  height: number,
  target: RgbaImage,
): { dx: number; dy: number; sx: number; sy: number; w: number; h: number } | undefined {
  const dx = Math.max(0, at.x),
    dy = Math.max(0, at.y);
  const sx = dx - at.x,
    sy = dy - at.y;
  const w = Math.min(width - sx, target.width - dx),
    h = Math.min(height - sy, target.height - dy);
  return w > 0 && h > 0 ? { dx, dy, sx, sy, w, h } : undefined;
}

// Pillow ImagingUtils.h: DIV255 rounds a 16-bit product to the nearest multiple of 1/255.
function div255(value: number): number {
  const tmp = value + 128;
  return ((tmp >>> 8) + tmp) >>> 8;
}
function blend(mask: number, from: number, to: number): number {
  return div255(from * (255 - mask) + to * mask);
}

/** An image of width x height pixels, each set to rgba. */
export function filledImage(rgba: Rgba, width: number, height: number): RgbaImage {
  colour(rgba, 4);
  size(width, "Width");
  size(height, "Height");
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, height, width };
}

/** Resolves frame colours as frames.renderFrame does: null cells are (0,0,0,0), others opaque. */
export function frameToRgba(context: ColourContext, frame: Frame): RgbaImage {
  const width = frame[0]?.length ?? 0;
  if (frame.some((row) => row.length !== width))
    throw new RangeError("Frame rows must have equal widths");
  positive(width, "Frame width");
  positive(frame.length, "Frame height");
  const resolve =
    typeof context.resolveRgb === "function"
      ? (context.resolveRgb as (colour: string) => Rgb)
      : (name: string) =>
          rgb(
            Object.hasOwn(context, name)
              ? (context as Readonly<Record<string, string>>)[name]
              : name,
          );
  const out = { data: new Uint8Array(width * frame.length * 4), height: frame.length, width };
  frame.forEach((row, y) =>
    row.forEach((name, x) => {
      if (!name) return;
      const value = resolve(name);
      colour(value, 3);
      out.data.set([...value, 255], (y * width + x) * 4);
    }),
  );
  return out;
}

/** Replaces every pixel of rect, clipped to image, with rgba (Pillow paste of a colour into a box). */
export function fillRect(rgba: Rgba, r: Rect, target: RgbaImage): void {
  colour(rgba, 4);
  rect(r);
  image(target);
  const c = clip(r, r.width, r.height, target);
  if (!c) return;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) target.data.set(rgba, ((c.dy + y) * target.width + c.dx + x) * 4);
}

/** Replaces target pixels, including alpha, with source placed at `at` (Pillow paste without a mask). */
export function paste(at: Point, source: RgbaImage, target: RgbaImage): void {
  point(at);
  image(source);
  image(target);
  const c = clip(at, source.width, source.height, target);
  if (!c) return;
  const copy = source === target ? source.data.slice() : source.data;
  for (let y = 0; y < c.h; y++) {
    const read = ((c.sy + y) * source.width + c.sx) * 4;
    target.data.set(copy.subarray(read, read + c.w * 4), ((c.dy + y) * target.width + c.dx) * 4);
  }
}

function maskPlane(mask: Plane | "alpha", source: RgbaImage): (i: number) => number {
  if (mask === "alpha") return (i) => source.data[i * 4 + 3];
  plane(mask);
  if (mask.width !== source.width || mask.height !== source.height)
    throw new RangeError("Mask must match the source size");
  return (i) => mask.data[i];
}
function pasteBlended(
  channels: number,
  at: Point,
  source: RgbaImage,
  mask: Plane | "alpha",
  target: RgbaImage,
): void {
  point(at);
  image(source);
  image(target);
  const data = source === target ? source.data.slice() : source.data;
  const weight = maskPlane(mask, { ...source, data });
  const c = clip(at, source.width, source.height, target);
  if (!c) return;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const s = (c.sy + y) * source.width + c.sx + x,
        t = ((c.dy + y) * target.width + c.dx + x) * 4,
        m = weight(s);
      for (let i = 0; i < channels; i++)
        target.data[t + i] = blend(m, target.data[t + i], data[s * 4 + i]);
    }
}

/**
 * Blends source placed at `at` into an RGBA target by an L mask plane sized to source, or by the
 * source's own alpha with "alpha"; all four channels blend (Pillow Paste.c paste_mask_L/RGBA).
 */
export function pasteMasked(at: Point, source: RgbaImage, mask: Plane | "alpha", target: RgbaImage): void {
  pasteBlended(4, at, source, mask, target);
}

/** As pasteMasked onto a Pillow mode "RGB" target: R, G and B blend and target alpha is unchanged. */
export function pasteMaskedRgb(at: Point, source: RgbaImage, mask: Plane | "alpha", target: RgbaImage): void {
  pasteBlended(3, at, source, mask, target);
}

/**
 * Blends rgba into an RGBA target through an L mask plane placed at `at` (Pillow paste of a colour
 * with an L mask, Paste.c fill_mask_L): colour channels of a clear target pixel take the full
 * colour wherever the mask is nonzero.
 */
export function pasteColour(rgba: Rgba, at: Point, mask: Plane, target: RgbaImage): void {
  colour(rgba, 4);
  point(at);
  plane(mask);
  image(target);
  const c = clip(at, mask.width, mask.height, target);
  if (!c) return;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const m = mask.data[(c.sy + y) * mask.width + c.sx + x],
        t = ((c.dy + y) * target.width + c.dx + x) * 4;
      for (let i = 0; i < 4; i++) {
        const weight = i !== 3 && m !== 0 && target.data[t + 3] === 0 ? 255 : m;
        target.data[t + i] = blend(weight, target.data[t + i], rgba[i]);
      }
    }
}

/** Composites source over target at `at` with straight alpha (Pillow Image.alpha_composite method). */
export function alphaComposite(at: Point, source: RgbaImage, target: RgbaImage): void {
  point(at);
  image(source);
  image(target);
  const c = clip(at, source.width, source.height, target);
  if (!c) return;
  const data = source === target ? source.data.slice() : source.data;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const s = ((c.sy + y) * source.width + c.sx + x) * 4,
        t = ((c.dy + y) * target.width + c.dx + x) * 4;
      const sa = data[s + 3];
      if (sa === 0) continue;
      // Pillow AlphaComposite.c: unsigned 32-bit maths with 7 bits of extra precision.
      const outa255 = sa * 255 + target.data[t + 3] * (255 - sa);
      const coef1 = Math.floor((sa * 255 * 255 * 128) / outa255),
        coef2 = 255 * 128 - coef1;
      for (let i = 0; i < 3; i++) {
        const tmp = data[s + i] * coef1 + target.data[t + i] * coef2 + (0x80 << 7);
        target.data[t + i] = (((tmp >>> 8) + tmp) >>> 8) >>> 7;
      }
      const a = outa255 + 0x80;
      target.data[t + 3] = ((a >>> 8) + a) >>> 8;
    }
}

/** A new copy of image. */
export function copy(source: RgbaImage): RgbaImage {
  image(source);
  return { data: source.data.slice(), height: source.height, width: source.width };
}

/** The rect of image; pixels outside the source are (0,0,0,0). */
export function crop(r: Rect, source: RgbaImage): RgbaImage {
  rect(r);
  image(source);
  const out = { data: new Uint8Array(r.width * r.height * 4), height: r.height, width: r.width };
  paste({ x: -r.x, y: -r.y }, source, out);
  return out;
}

/** image mirrored left to right. */
export function flipX(source: RgbaImage): RgbaImage {
  image(source);
  const out = copy(source);
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const read = (y * source.width + x) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * source.width + source.width - 1 - x) * 4);
    }
  return out;
}

/** image with each pixel replicated factor x factor times, including RGB under clear alpha. */
export function scaleNearest(factor: number, source: RgbaImage): RgbaImage {
  positive(factor, "Scale factor");
  image(source);
  return resizeNearest(source.width * factor, source.height * factor, source);
}

// Geometry.c ImagingScaleAffine with fill: source x starts at x offset + 0.5 * x scale and
// accumulates the scale in double precision, truncated toward zero (negative is outside). Columns
// between the first and last valid ones keep source column 0 when invalid, as Pillow's table does.
function scaleAffine(
  [xScale, xOffset, yScale, yOffset]: readonly [number, number, number, number],
  width: number,
  height: number,
  source: RgbaImage,
): RgbaImage {
  const out = { data: new Uint8Array(width * height * 4), height, width };
  const columns = new Int32Array(width);
  let xmin = width,
    xmax = 0,
    xo = xOffset + xScale * 0.5,
    yo = yOffset + yScale * 0.5;
  for (let x = 0; x < width; x++, xo += xScale) {
    const xin = xo < 0 ? -1 : Math.trunc(xo);
    if (xin >= 0 && xin < source.width) {
      xmax = x + 1;
      xmin = Math.min(xmin, x);
      columns[x] = xin;
    }
  }
  for (let y = 0; y < height; y++, yo += yScale) {
    const yin = yo < 0 ? -1 : Math.trunc(yo);
    if (yin < 0 || yin >= source.height) continue;
    for (let x = xmin; x < xmax; x++) {
      const read = (yin * source.width + columns[x]) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * width + x) * 4);
    }
  }
  return out;
}

/**
 * image resampled to width x height as Pillow resize with NEAREST does: source x starts at
 * 0.5 * in/out and accumulates in/out in double precision, truncated; y likewise.
 */
export function resizeNearest(width: number, height: number, source: RgbaImage): RgbaImage {
  size(width, "Width");
  size(height, "Height");
  image(source);
  return scaleAffine([source.width / width, 0, source.height / height, 0], width, height, source);
}

// Python round(value, 15): the nearest 15-decimal value, ties to even. toFixed rounds an exact
// tie up, so a tie (the exact expansion ends in 5 at the 16th decimal) is resolved separately.
function round15(value: number): number {
  const exact = Math.abs(value).toFixed(100);
  const point = exact.indexOf(".");
  if (/^50*$/.test(exact.slice(point + 16))) {
    const down = exact.slice(0, point + 16);
    const last = Number(down.at(-1));
    const rounded = last % 2 === 0 ? Number(down) : Number(Math.abs(value).toFixed(15));
    return Math.sign(value) * rounded || value * 0;
  }
  return Number(value.toFixed(15)) || value * 0;
}

function rotate180(source: RgbaImage): RgbaImage {
  const out = copy(source);
  const count = source.width * source.height;
  for (let i = 0; i < count; i++) out.data.set(source.data.subarray(i * 4, i * 4 + 4), (count - 1 - i) * 4);
  return out;
}

// Square transposes: ROTATE_90 is counter-clockwise, ROTATE_270 clockwise.
function rotateSquare(clockwise: boolean, source: RgbaImage): RgbaImage {
  const n = source.width;
  const out = copy(source);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const [sx, sy] = clockwise ? [y, n - 1 - x] : [n - 1 - y, x];
      const read = (sy * n + sx) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * n + x) * 4);
    }
  return out;
}

/**
 * image rotated counter-clockwise by angle degrees about its centre, as Pillow
 * Image.rotate(angle, NEAREST) does with expand=False and a transparent black fill: the same
 * matrix construction and fast paths, then Geometry.c nearest affine sampling (16.16 fixed point
 * when every corner maps inside +-32768, double precision otherwise).
 */
export function rotateNearest(angle: number, source: RgbaImage): RgbaImage {
  if (!Number.isFinite(angle)) throw new RangeError("Angle must be finite");
  image(source);
  // Python float modulo: the result takes the divisor's sign.
  let degrees = angle % 360;
  if (degrees !== 0) {
    if (degrees < 0) degrees += 360;
  } else degrees = 0;
  if (degrees === 0) return copy(source);
  if (degrees === 180) return rotate180(source);
  if ((degrees === 90 || degrees === 270) && source.width === source.height)
    return rotateSquare(degrees === 270, source);
  const { width: w, height: h } = source;
  const [cx, cy] = [w / 2, h / 2];
  const radians = -(degrees * (Math.PI / 180));
  const a = [round15(Math.cos(radians)), round15(Math.sin(radians)), 0, round15(-Math.sin(radians)), round15(Math.cos(radians)), 0];
  const [tx, ty] = [-cx - 0, -cy - 0];
  [a[2], a[5]] = [a[0] * tx + a[1] * ty + a[2], a[3] * tx + a[4] * ty + a[5]];
  a[2] += cx;
  a[5] += cy;
  if (a[1] === 0 && a[3] === 0) return scaleAffine([a[0], a[2], a[4], a[5]], w, h, source);
  const out = { data: new Uint8Array(w * h * 4), height: h, width: w };
  const write = (x: number, y: number, xin: number, yin: number): void => {
    if (xin >= 0 && xin < w && yin >= 0 && yin < h) {
      const read = (yin * w + xin) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * w + x) * 4);
    }
  };
  const fixed = (x: number, y: number): boolean =>
    Math.abs(x * a[0] + y * a[1] + a[2]) < 32768 && Math.abs(x * a[3] + y * a[4] + a[5]) < 32768;
  if (fixed(0, 0) && fixed(w, h) && fixed(0, h) && fixed(w, 0)) {
    const fix = (v: number): number => Math.floor(v * 65536 + 0.5) | 0;
    const [a0, a1, a3, a4] = [fix(a[0]), fix(a[1]), fix(a[3]), fix(a[4])];
    let a2 = fix(a[2] + a[0] * 0.5 + a[1] * 0.5),
      a5 = fix(a[5] + a[3] * 0.5 + a[4] * 0.5);
    for (let y = 0; y < h; y++, a2 = (a2 + a1) | 0, a5 = (a5 + a4) | 0) {
      let xx = a2,
        yy = a5;
      for (let x = 0; x < w; x++, xx = (xx + a0) | 0, yy = (yy + a3) | 0) write(x, y, xx >> 16, yy >> 16);
    }
    return out;
  }
  const coord = (v: number): number => (v < 0 ? -1 : Math.trunc(v));
  let xo = a[2] + a[1] * 0.5 + a[0] * 0.5,
    yo = a[5] + a[4] * 0.5 + a[3] * 0.5;
  for (let y = 0; y < h; y++, xo += a[1], yo += a[4]) {
    let xx = xo,
      yy = yo;
    for (let x = 0; x < w; x++, xx += a[0], yy += a[3]) write(x, y, coord(xx), coord(yy));
  }
  return out;
}

/** image with alpha set to 255 and RGB kept, including under clear pixels (Pillow convert "RGB"). */
export function withoutAlpha(source: RgbaImage): RgbaImage {
  const out = copy(source);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return out;
}

/** Luma as Pillow convert("L") computes it: (R*19595 + G*38470 + B*7471 + 0x8000) >> 16. */
export function toGrayscale(source: RgbaImage): Plane {
  image(source);
  const data = new Uint8Array(source.width * source.height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    data[i] = (source.data[p] * 19595 + source.data[p + 1] * 38470 + source.data[p + 2] * 7471 + 0x8000) >>> 16;
  }
  return { data, height: source.height, width: source.width };
}

/** Channel index (0 red, 1 green, 2 blue, 3 alpha) of image as a plane. */
export function getChannel(index: number, source: RgbaImage): Plane {
  if (![0, 1, 2, 3].includes(index)) throw new RangeError("Channel index must be 0, 1, 2 or 3");
  image(source);
  const data = new Uint8Array(source.width * source.height);
  for (let i = 0; i < data.length; i++) data[i] = source.data[i * 4 + index];
  return { data, height: source.height, width: source.width };
}

/** The red, green, blue and alpha planes of image. */
export function split(source: RgbaImage): [Plane, Plane, Plane, Plane] {
  return [0, 1, 2, 3].map((index) => getChannel(index, source)) as [Plane, Plane, Plane, Plane];
}

/** A copy of image with alpha replaced by a plane of the same size or a constant byte. */
export function putAlpha(alpha: Plane | number, source: RgbaImage): RgbaImage {
  const out = copy(source);
  if (typeof alpha === "number") byte(alpha, "Alpha");
  else {
    plane(alpha);
    if (alpha.width !== source.width || alpha.height !== source.height)
      throw new RangeError("Alpha plane must match the image size");
  }
  for (let i = 0; i < source.width * source.height; i++)
    out.data[i * 4 + 3] = typeof alpha === "number" ? alpha : alpha.data[i];
  return out;
}

/** image with each channel mapped through its 256-entry table of bytes (Pillow Image.point). */
export function pointLut(
  luts: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>, ArrayLike<number>],
  source: RgbaImage,
): RgbaImage {
  if (luts.length !== 4) throw new RangeError("Point requires four tables");
  for (const lut of luts) {
    if (lut.length !== 256) throw new RangeError("Point tables must have 256 entries");
    for (let i = 0; i < 256; i++) byte(lut[i], "Point table entry");
  }
  const out = copy(source);
  for (let i = 0; i < out.data.length; i++) out.data[i] = luts[i & 3][out.data[i]];
  return out;
}

/**
 * An opaque preview with one row per sprite and ground, tags flattened in order, as an RgbaImage
 * so that the size is not limited by a canvas. "all-frames" reproduces frames.renderContactSheet;
 * "first-frame" reproduces Python art_kit 0.5.0 frames.contact_sheet, whose cell width comes from
 * the widest first frame and row height from each row's first frame, with later frames painted
 * over earlier overflow.
 */
export function composeContactSheet(
  { resolveRgb, background, cells, scale = 3, gap = 4 }: ContactSheetOptions,
  sprites: readonly Sprite[],
  grounds: readonly string[],
): RgbaImage {
  positive(scale, "Preview scale");
  size(gap, "Gap");
  if (cells !== "first-frame" && cells !== "all-frames")
    throw new RangeError('Cells must be "first-frame" or "all-frames"');
  colour(background, 3);
  const rows = sprites.flatMap(([, tags]) => {
    const frames = tags.flatMap(([, frames]) => frames);
    return grounds.map((ground) => ({ frames, ground }));
  });
  if (!rows.length || rows.some(({ frames }) => !frames.length))
    throw new RangeError("Contact sheet requires frames and grounds");
  const ink = (name: string): Rgba => {
    const value = resolveRgb(name);
    colour(value, 3);
    return [value[0], value[1], value[2], 255];
  };
  const first = cells === "first-frame";
  let cellWidth = 0,
    columns = 0;
  const heights = rows.map(({ frames }) => {
    columns = Math.max(columns, frames.length);
    let rowHeight = 0;
    for (const frame of first ? frames.slice(0, 1) : frames) {
      cellWidth = Math.max(cellWidth, frame[0]?.length ?? 0);
      rowHeight = Math.max(rowHeight, frame.length);
    }
    return rowHeight + gap;
  });
  const pitch = cellWidth + gap;
  const total = heights.reduce((sum, height) => sum + height, 0);
  positive(columns * pitch * scale, "Contact sheet width");
  positive(total * scale, "Contact sheet height");
  const sheet = filledImage([...background, 255], columns * pitch * scale, total * scale);
  let top = 0;
  rows.forEach(({ frames, ground }, row) => {
    const under = ink(ground);
    frames.forEach((frame, column) => {
      const x0 = column * pitch * scale,
        y0 = top * scale;
      if (first) {
        // Python paints every cell, resolving empty cells to the ground colour.
        frame.forEach((cells, y) =>
          cells.forEach((name, x) =>
            fillRect(name ? ink(name) : under, { height: scale, width: scale, x: x0 + x * scale, y: y0 + y * scale }, sheet),
          ),
        );
        return;
      }
      const pixels = scaleNearest(scale, frameToRgba({ resolveRgb }, frame));
      fillRect(under, { height: pixels.height, width: pixels.width, x: x0, y: y0 }, sheet);
      pasteMasked({ x: x0, y: y0 }, pixels, "alpha", sheet);
    });
    top += heights[row];
  });
  return sheet;
}
