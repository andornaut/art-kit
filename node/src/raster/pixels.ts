// Pixel writes with Pillow 13.0.0 parity rounding: fill, paste and composite mutate their target;
// filledImage, crop and clone return new images.
import { checkColour, checkImage, checkPlane, checkPoint, checkRect, checkSize } from "./checks.js";
import type { RgbaImage } from "./rgbaImage.js";
import type { Plane, Point, Rect, Rgba } from "./types.js";

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
  return w > 0 && h > 0 ? { dx, dy, h, sx, sy, w } : undefined;
}

function snapshotIfOverlapping(source: Uint8Array, target: Uint8Array): Uint8Array {
  if (
    source.buffer === target.buffer &&
    source.byteOffset < target.byteOffset + target.byteLength &&
    target.byteOffset < source.byteOffset + source.byteLength
  ) {
    // The typed array constructor copies the bytes, including when source is a Node Buffer.
    return new Uint8Array(source);
  }
  return source;
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
  checkColour(4, rgba);
  checkSize(width, "Width");
  checkSize(height, "Height");
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set(rgba, i);
  }
  return { data, height, width };
}

export interface FillOptions {
  /** The pixels to fill, clipped to the image. */
  rect: Rect;
  /** Coverage plane sized to rect: 0 keeps a pixel, 255 writes rgba and values between blend. */
  mask?: Plane;
}

/**
 * Writes rgba into rect. Without a mask every pixel is replaced, alpha included. With a mask each
 * channel blends by the mask value, and a fully transparent pixel takes the full colour in its
 * RGB channels wherever the mask is nonzero, so only its alpha carries the coverage.
 */
export function fill({ mask, rect: r }: FillOptions, rgba: Rgba, target: RgbaImage): void {
  checkColour(4, rgba);
  checkRect(r);
  checkImage(target);
  if (mask) {
    checkPlane(mask);
    if (mask.width !== r.width || mask.height !== r.height) {
      throw new RangeError("Mask must match the rect size");
    }
  }
  const c = clip(r, r.width, r.height, target);
  if (!c) {
    return;
  }
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const t = ((c.dy + y) * target.width + c.dx + x) * 4;
      if (!mask) {
        target.data.set(rgba, t);
        continue;
      }
      const m = mask.data[(c.sy + y) * mask.width + c.sx + x];
      for (let i = 0; i < 4; i++) {
        const weight = i !== 3 && m !== 0 && target.data[t + 3] === 0 ? 255 : m;
        target.data[t + i] = blend(weight, target.data[t + i], rgba[i]);
      }
    }
  }
}

export interface PasteOptions {
  /** Where the source's top-left lands; the source is clipped to the image on every side. */
  at: Point;
  /**
   * Omitted: source pixels replace target pixels. "alpha": each channel blends from target to
   * source by the source's own alpha.
   */
  mask?: "alpha";
  /** Write only RGB and keep the target's alpha, for opaque (RGB) targets. Defaults to false. */
  keepAlpha?: boolean;
}

/**
 * Draws source onto image. The four combinations of mask and keepAlpha are all defined: replace
 * RGBA, replace RGB only, blend RGBA, or blend RGB only. Blending rounds each channel to the
 * nearest byte; it is a weighted copy, not alpha compositing (see composite).
 */
export function paste(
  { at, keepAlpha = false, mask }: PasteOptions,
  source: RgbaImage,
  target: RgbaImage,
): void {
  checkPoint(at);
  checkImage(source);
  checkImage(target);
  if (mask !== undefined && mask !== "alpha") {
    throw new RangeError('Mask must be "alpha"');
  }
  const c = clip(at, source.width, source.height, target);
  if (!c) {
    return;
  }
  const data = snapshotIfOverlapping(source.data, target.data);
  const channels = keepAlpha ? 3 : 4;
  for (let y = 0; y < c.h; y++) {
    if (!mask && !keepAlpha) {
      const read = ((c.sy + y) * source.width + c.sx) * 4;
      target.data.set(data.subarray(read, read + c.w * 4), ((c.dy + y) * target.width + c.dx) * 4);
      continue;
    }
    for (let x = 0; x < c.w; x++) {
      const s = (c.sy + y) * source.width + c.sx + x,
        t = ((c.dy + y) * target.width + c.dx + x) * 4;
      const m = mask ? data[s * 4 + 3] : 255;
      for (let i = 0; i < channels; i++) {
        target.data[t + i] = blend(m, target.data[t + i], data[s * 4 + i]);
      }
    }
  }
}

/**
 * Composites source over image at `at` with straight alpha ("over"): a clear source pixel keeps the
 * target, an opaque one replaces it and partial alpha combines both colours and alphas.
 */
export function composite(at: Point, source: RgbaImage, target: RgbaImage): void {
  checkPoint(at);
  checkImage(source);
  checkImage(target);
  const c = clip(at, source.width, source.height, target);
  if (!c) {
    return;
  }
  const data = snapshotIfOverlapping(source.data, target.data);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const s = ((c.sy + y) * source.width + c.sx + x) * 4,
        t = ((c.dy + y) * target.width + c.dx + x) * 4;
      const sa = data[s + 3];
      if (sa === 0) {
        continue;
      }
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
}

/** A checked copy of source. */
export function clone(source: RgbaImage): RgbaImage {
  checkImage(source);
  return { data: source.data.slice(), height: source.height, width: source.width };
}

/** The rect of image; pixels outside the source are (0,0,0,0). */
export function crop(r: Rect, source: RgbaImage): RgbaImage {
  checkRect(r);
  checkImage(source);
  const out = { data: new Uint8Array(r.width * r.height * 4), height: r.height, width: r.width };
  paste({ at: { x: -r.x, y: -r.y } }, source, out);
  return out;
}
