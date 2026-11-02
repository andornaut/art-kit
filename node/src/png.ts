// PNG decoding for Node build tools.
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
