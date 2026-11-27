import type { RgbaImage } from "../rgbaImage.js";
import type { Rgba } from "../types.js";

// The ports keep Pillow's C shape, which advances and clamps its coordinate parameters in place.
/* eslint-disable no-param-reassign */

export type Mask = Uint8Array | undefined;

export function plot(image: RgbaImage, x: number, y: number, ink: Rgba): void {
  if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
    image.data.set(ink, (y * image.width + x) * 4);
  }
}

export function hline(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  ink: Rgba,
  mask: Mask,
): void {
  if (y0 < 0 || y0 >= image.height) {
    return;
  }
  if (x0 < 0) {
    x0 = 0;
  } else if (x0 >= image.width) {
    return;
  }
  if (x1 < 0) {
    return;
  } else if (x1 >= image.width) {
    x1 = image.width - 1;
  }
  const row = y0 * image.width;
  for (; x0 <= x1; x0++) {
    if (mask === undefined || mask[row + x0]) {
      image.data.set(ink, (row + x0) * 4);
    }
  }
}

// Bresenham segment without its end point.
export function segment(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Rgba,
): void {
  let dy = y1 - y0;
  let ys: number;
  if (dy < 0) {
    dy = -dy;
    ys = -1;
  } else if (dy === 0) {
    if (x1 > x0) {
      hline(image, x0, y0, x1 - 1, ink, undefined);
    } else if (x0 > x1) {
      hline(image, x1 + 1, y0, x0, ink, undefined);
    }
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
    for (let i = 0; i < dy; i++, y0 += ys) {
      plot(image, x0, y0, ink);
    }
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
