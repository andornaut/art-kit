import { deflateSync } from "node:zlib";

import type { RgbaImage } from "../raster/rgbaImage.js";
import { headerData, pngFile } from "./pngChunks.js";

// An 8-bit indexed PNG holds at most this many colours, each an RGBA value: PLTE holds the RGB
// and tRNS the alpha.
const MAX_PALETTE = 256;

const COLOUR_TYPE_INDEXED = 3;
const FILTER_NONE = 0;

// Each pixel's palette index and the palette as RGBA values (R in the high byte), or undefined
// when image has more than MAX_PALETTE distinct RGBA values. Entries that are not fully opaque
// come first, so tRNS can end at the last of them, then the most used.
function paletteOf(image: RgbaImage): { indices: Uint8Array; palette: number[] } | undefined {
  const view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const indices = new Uint8Array(image.width * image.height);
  const entries = new Map<number, { count: number; index: number }>();
  // Store first-seen indices until the palette order is known.
  for (let i = 0; i < indices.length; i++) {
    const rgba = view.getUint32(i * 4);
    let entry = entries.get(rgba);
    if (entry === undefined) {
      if (entries.size === MAX_PALETTE) {
        return undefined;
      }
      entry = { count: 0, index: entries.size };
      entries.set(rgba, entry);
    }
    entry.count++;
    indices[i] = entry.index;
  }
  const opaque = (rgba: number) => Number((rgba & 0xff) === 0xff);
  const sorted = [...entries].sort(
    ([a, left], [b, right]) => opaque(a) - opaque(b) || right.count - left.count || a - b,
  );
  const remap = new Uint8Array(sorted.length);
  const palette = sorted.map(([rgba, entry], index) => {
    remap[entry.index] = index;
    return rgba;
  });
  for (let i = 0; i < indices.length; i++) {
    indices[i] = remap[indices[i]];
  }
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
  const plte = new Uint8Array(
    palette.flatMap((rgba) => [rgba >>> 24, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff]),
  );
  const trns = new Uint8Array(
    palette.filter((rgba) => (rgba & 0xff) !== 0xff).map((rgba) => rgba & 0xff),
  );
  return pngFile([
    ["IHDR", [headerData(COLOUR_TYPE_INDEXED, width, height)]],
    ["PLTE", [plte]],
    ...(trns.length > 0 ? [["tRNS", [trns]] as const] : []),
    ["IDAT", [deflateSync(rows, options)]],
    ["IEND", []],
  ]);
}
