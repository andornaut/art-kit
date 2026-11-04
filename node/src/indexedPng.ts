import { deflateSync } from "node:zlib";

import { pngFile } from "./pngChunks.js";
import type { RgbaImage } from "./rgbaImage.js";

// An 8-bit indexed PNG holds at most this many colours, each an RGBA value: PLTE holds the RGB
// and tRNS the alpha.
const MAX_PALETTE = 256;

const COLOUR_TYPE_INDEXED = 3;
const FILTER_NONE = 0;

// Each pixel's palette index and the palette as RGBA values (R in the high byte), or undefined
// when image has more than MAX_PALETTE distinct RGBA values. Entries that are not fully opaque
// come first, so tRNS can end at the last of them, then the most used.
function paletteOf(
  image: RgbaImage,
): { indices: Uint8Array; palette: number[] } | undefined {
  const view = new DataView(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength,
  );
  const pixels = new Uint32Array(image.width * image.height);
  const counts = new Map<number, number>();
  for (let i = 0; i < pixels.length; i++) {
    const rgba = view.getUint32(i * 4);
    pixels[i] = rgba;
    counts.set(rgba, (counts.get(rgba) ?? 0) + 1);
    if (counts.size > MAX_PALETTE) {
      return undefined;
    }
  }
  const opaque = (rgba: number) => Number((rgba & 0xff) === 0xff);
  const palette = [...counts.keys()].sort(
    (a, b) =>
      opaque(a) - opaque(b) ||
      (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
      a - b,
  );
  const indexOf = new Map(palette.map((rgba, index) => [rgba, index]));
  const indices = new Uint8Array(pixels.length);
  pixels.forEach((rgba, i) => {
    indices[i] = indexOf.get(rgba) ?? 0;
  });
  return { indices, palette };
}

export interface IndexedPngOptions {
  level: number;
  memLevel: number;
}

// Returns undefined when the image exceeds the indexed palette limit.
export function encodeIndexedPng(
  options: IndexedPngOptions,
  image: RgbaImage,
): Uint8Array | undefined {
  const indexed = paletteOf(image);
  if (indexed === undefined) {
    return undefined;
  }
  const { indices, palette } = indexed;
  const { height, width } = image;
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = FILTER_NONE;
    rows.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, COLOUR_TYPE_INDEXED, 0, 0, 0], 8);
  const plte = new Uint8Array(
    palette.flatMap((rgba) => [
      rgba >>> 24,
      (rgba >>> 16) & 0xff,
      (rgba >>> 8) & 0xff,
    ]),
  );
  const trns = new Uint8Array(
    palette.filter((rgba) => (rgba & 0xff) !== 0xff).map((rgba) => rgba & 0xff),
  );
  return pngFile([
    ["IHDR", [header]],
    ["PLTE", [plte]],
    ...(trns.length > 0 ? [["tRNS", [trns]] as const] : []),
    ["IDAT", [deflateSync(rows, options)]],
    ["IEND", []],
  ]);
}
