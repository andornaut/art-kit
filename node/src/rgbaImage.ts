import type { Point, Rect } from "./geometry.js";

// An image's pixels, 4 bytes each (red, green, blue, alpha), row by row from the top-left.
export interface RgbaImage {
  data: Uint8Array;
  height: number;
  width: number;
}

// An image of clear pixels.
export function blankImage(width: number, height: number): RgbaImage {
  return { data: new Uint8Array(width * height * 4), height, width };
}

export interface BlitExtrudedOptions {
  // The rect of source to copy.
  from: Rect;
  // Pixels of border added on every side.
  extrude: number;
  // Where the copied rect's top-left lands in target.
  at: Point;
  // The whole frame a trimmed rect was cut from, so the border holds what the whole frame's pixels
  // hold there; defaults to from.
  bounds?: Rect;
}

// Copies the from rect of source to target with its top-left at, and extrude pixels around it on
// every side as source holds them inside bounds, repeating bounds' edge pixels past its edges, so
// a frame sampled just past its edge reads its own colour rather than a neighbour's.
export function blitExtruded(
  { from, extrude, at, bounds = from }: BlitExtrudedOptions,
  source: RgbaImage,
  target: RgbaImage,
): void {
  for (let dy = -extrude; dy < from.height + extrude; dy++) {
    const sourceY =
      bounds.y +
      Math.min(bounds.height - 1, Math.max(0, from.y - bounds.y + dy));
    for (let dx = -extrude; dx < from.width + extrude; dx++) {
      const sourceX =
        bounds.x +
        Math.min(bounds.width - 1, Math.max(0, from.x - bounds.x + dx));
      const read = (sourceY * source.width + sourceX) * 4;
      const write = ((at.y + dy) * target.width + at.x + dx) * 4;
      target.data.set(source.data.subarray(read, read + 4), write);
    }
  }
}

// The smallest rect inside within that holds every pixel of image with any opacity, or
// undefined when all of within is clear.
export function opaqueRect(within: Rect, image: RgbaImage): Rect | undefined {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = within.y; y < within.y + within.height; y++) {
    for (let x = within.x; x < within.x + within.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] !== 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return left > right
    ? undefined
    : { height: bottom - top + 1, width: right - left + 1, x: left, y: top };
}
