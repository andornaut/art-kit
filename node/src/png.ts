// PNG decoding and encoding for Node build tools.
import { PNG } from "pngjs";

import type { RgbaImage } from "./rgbaImage.js";

// A PNG's pixels, whatever its colour type, as 8-bit RGBA.
export function decodePng(bytes: Uint8Array): RgbaImage {
  const { data, height, width } = PNG.sync.read(Buffer.from(bytes));
  return { data: new Uint8Array(data), height, width };
}

export interface RgbaPngOptions {
  deflateLevel: number;
  deflateStrategy: number;
  filterType: number;
}

export function encodeRgbaPng(
  options: RgbaPngOptions,
  image: RgbaImage,
): Uint8Array {
  const { data, height, width } = image;
  const png = new PNG({ height, width });
  png.data = Buffer.from(data);
  return PNG.sync.write(png, { colorType: 6, ...options });
}

// Opaque RGB PNG (colour type 2) bytes; decoding them yields image. Throws RangeError when any
// pixel's alpha is not 255, because colour type 2 has no alpha channel.
export function encodeRgbPng(
  options: RgbaPngOptions,
  image: RgbaImage,
): Uint8Array {
  const { data, height, width } = image;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      throw new RangeError(`Pixel ${(i - 3) / 4} has alpha ${data[i]}, not 255`);
    }
  }
  const png = new PNG({ height, width });
  png.data = Buffer.from(data);
  return PNG.sync.write(png, { colorType: 2, inputHasAlpha: true, ...options });
}
