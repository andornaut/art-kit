// ICO encoding with PNG-embedded entries.
import { encodeRgbaPng } from "./png.js";
import type { RgbaImage } from "./rgbaImage.js";

const MAX_SIDE = 256;
const PNG_OPTIONS = { deflateLevel: 9, deflateStrategy: 3, filterType: -1 };

// One 32-bit PNG entry per image, ordered by size as Pillow 13.0.0 writes them. Callers supply
// each size already drawn or resampled; nothing is resized. Sides must be 1..256 and sizes
// distinct. Pillow 13.0.0 reads every entry back as the supplied RGBA.
export function encodeIco(images: readonly RgbaImage[]): Uint8Array {
  if (images.length === 0) {
    throw new RangeError("An ICO needs at least one image");
  }
  const sizes = new Set<string>();
  for (const { height, width } of images) {
    if (![width, height].every((side) => Number.isInteger(side) && side >= 1 && side <= MAX_SIDE)) {
      throw new RangeError(`Invalid ICO entry size ${width}x${height}`);
    }
    const size = `${width}x${height}`;
    if (sizes.has(size)) {
      throw new RangeError(`Duplicate ICO entry size ${size}`);
    }
    sizes.add(size);
  }
  const sorted = [...images].sort((a, b) => a.width - b.width || a.height - b.height);
  const pngs = sorted.map((image) => encodeRgbaPng(PNG_OPTIONS, image));
  const directory = 6 + 16 * sorted.length;
  const out = new Uint8Array(directory + pngs.reduce((sum, png) => sum + png.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, sorted.length, true);
  let offset = directory;
  sorted.forEach(({ height, width }, i) => {
    const entry = 6 + 16 * i;
    // 0 means 256.
    out[entry] = width % MAX_SIDE;
    out[entry + 1] = height % MAX_SIDE;
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, pngs[i].length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(pngs[i], offset);
    offset += pngs[i].length;
  });
  return out;
}
