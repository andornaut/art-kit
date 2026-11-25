// Per-pixel filters and channel planes. Every function returns a new image or plane.
import { checkImage } from "./checks.js";
import { clone } from "./pixels.js";
import type { RgbaImage } from "./rgbaImage.js";
import type { Plane } from "./types.js";

/** Full-image straight RGBA Gaussian convolution with repeated edges and Float32 storage. */
export function gaussianBlur({ sigma }: { sigma: number }, source: RgbaImage): RgbaImage {
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new RangeError("Sigma must be finite and positive");
  }
  checkImage(source);
  const { height: h, width: w } = source;
  const out = { data: new Uint8Array(source.data.length), height: h, width: w };
  if (w === 0 || h === 0) {
    return out;
  }
  const reach = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, i) =>
    i === reach ? 1 : Math.exp(-((i - reach) ** 2) / (2 * sigma * sigma)),
  );
  const sum = kernel.reduce((a, b) => a + b, 0);
  const k = kernel.map((v) => v / sum);
  const src = Float32Array.from(source.data);
  // Repeat edge pixels for both passes.
  const tmp = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let i = -reach; i <= reach; i++) {
          const sx = Math.min(w - 1, Math.max(0, x + i));
          v += src[(y * w + sx) * 4 + c] * k[i + reach];
        }
        tmp[(y * w + x) * 4 + c] = v;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let i = -reach; i <= reach; i++) {
          const sy = Math.min(h - 1, Math.max(0, y + i));
          v += tmp[(sy * w + x) * 4 + c] * k[i + reach];
        }
        out.data[(y * w + x) * 4 + c] = Math.round(v);
      }
    }
  }
  return out;
}

/** image with alpha set to 255 and RGB kept, including RGB under previously clear pixels. */
export function opaque(source: RgbaImage): RgbaImage {
  const out = clone(source);
  for (let i = 3; i < out.data.length; i += 4) {
    out.data[i] = 255;
  }
  return out;
}

/** ITU-R 601-2 luma per pixel, ignoring alpha: (R*19595 + G*38470 + B*7471 + 0x8000) >> 16. */
export function grayscale(source: RgbaImage): Plane {
  checkImage(source);
  const data = new Uint8Array(source.width * source.height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    data[i] =
      (source.data[p] * 19595 + source.data[p + 1] * 38470 + source.data[p + 2] * 7471 + 0x8000) >>>
      16;
  }
  return { data, height: source.height, width: source.width };
}

/** Channel index of image: 0 red, 1 green, 2 blue, 3 alpha. */
export type ChannelIndex = 0 | 1 | 2 | 3;

/** One channel of image as a plane. */
export function channel(index: ChannelIndex, source: RgbaImage): Plane {
  if (![0, 1, 2, 3].includes(index)) {
    throw new RangeError("Channel index must be 0, 1, 2 or 3");
  }
  checkImage(source);
  const data = new Uint8Array(source.width * source.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = source.data[i * 4 + index];
  }
  return { data, height: source.height, width: source.width };
}
