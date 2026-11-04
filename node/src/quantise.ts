// Deterministic palette reduction shared across animation frames.
import type { Rgba } from "./raster.js";
import type { RgbaImage } from "./rgbaImage.js";

export interface QuantiseOptions {
  maxColours: number;
}

export interface Quantised {
  palette: Rgba[];
  frames: RgbaImage[];
}

const TRANSPARENT: Rgba = [0, 0, 0, 0];

// Opaque colours as 0xRRGGBB with pixel counts, ordered by value.
interface Colour {
  rgb: number;
  weight: number;
}

const channel = (rgb: number, c: number) => (rgb >>> (16 - 8 * c)) & 0xff;

function range(box: readonly Colour[], c: number): number {
  let low = 255;
  let high = 0;
  for (const { rgb } of box) {
    const v = channel(rgb, c);
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  return high - low;
}

// Median cut: split the box with the largest channel range (lowest box index on ties) along that
// channel (red, then green, then blue on ties) at its weighted median.
function medianCut(budget: number, colours: Colour[]): Colour[][] {
  const boxes = [colours];
  while (boxes.length < budget) {
    let best = -1;
    let bestRange = 0;
    let bestChannel = 0;
    boxes.forEach((box, index) => {
      for (let c = 0; c < 3; c++) {
        const r = range(box, c);
        if (r > bestRange) {
          [best, bestRange, bestChannel] = [index, r, c];
        }
      }
    });
    if (best < 0) {
      break;
    }
    const box = [...boxes[best]].sort(
      (a, b) => channel(a.rgb, bestChannel) - channel(b.rgb, bestChannel) || a.rgb - b.rgb,
    );
    const total = box.reduce((sum, { weight }) => sum + weight, 0);
    let split = 1;
    for (
      let cumulative = box[0].weight;
      split < box.length - 1 && cumulative * 2 < total;
      split++
    ) {
      cumulative += box[split].weight;
    }
    boxes.splice(best, 1, box.slice(0, split), box.slice(split));
  }
  return boxes;
}

// Weighted mean per channel, rounded half up in integer arithmetic.
function meanOf(box: readonly Colour[]): Rgba {
  const total = box.reduce((sum, { weight }) => sum + weight, 0);
  const mean = [0, 1, 2].map((c) => {
    const sum = box.reduce((acc, { rgb, weight }) => acc + channel(rgb, c) * weight, 0);
    return Math.floor((2 * sum + total) / (2 * total));
  });
  return [mean[0], mean[1], mean[2], 255];
}

function nearest(palette: readonly Rgba[], first: number, rgb: number): number {
  let best = first;
  let bestDistance = Infinity;
  for (let i = first; i < palette.length; i++) {
    const [r, g, b] = palette[i];
    const distance =
      (r - channel(rgb, 0)) ** 2 + (g - channel(rgb, 1)) ** 2 + (b - channel(rgb, 2)) ** 2;
    if (distance < bestDistance) {
      [best, bestDistance] = [i, distance];
    }
  }
  return best;
}

// Reduces frames to one shared palette of at most maxColours (1..256) entries. Fully transparent
// pixels share one entry, listed first; partial alpha throws RangeError. Frames that already fit,
// with at most one fully transparent RGBA value, return unchanged, their palette in RGBA order
// after the transparent value. Otherwise opaque colours are reduced by median cut weighted by
// pixel count, each entry the rounded weighted mean of its box, and every pixel maps to the
// nearest entry by squared RGB distance (lowest index on ties), without dithering; transparent
// pixels become 0,0,0,0. Results depend only on the input bytes.
export function quantise(options: QuantiseOptions, frames: readonly RgbaImage[]): Quantised {
  const { maxColours } = options;
  if (!(Number.isInteger(maxColours) && maxColours >= 1 && maxColours <= 256)) {
    throw new RangeError(`maxColours must be an integer from 1 to 256, received ${maxColours}`);
  }
  const counts = new Map<number, number>();
  const transparent = new Set<number>();
  frames.forEach((frame, index) => {
    const { data } = frame;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) {
        transparent.add(((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8)) >>> 0);
      } else if (alpha === 255) {
        const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
      } else {
        throw new RangeError(`Frame ${index} pixel ${i / 4} has partial alpha ${alpha}`);
      }
    }
  });
  const colours = [...counts]
    .map(([rgb, weight]) => ({ rgb, weight }))
    .sort((a, b) => a.rgb - b.rgb);
  const entry = (rgb: number): Rgba => [channel(rgb, 0), channel(rgb, 1), channel(rgb, 2), 255];
  const reserved = transparent.size > 0 ? 1 : 0;
  if (transparent.size <= 1 && colours.length + reserved <= maxColours) {
    const clear = [...transparent].map((value): Rgba => [
      value >>> 24,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      0,
    ]);
    return { frames: [...frames], palette: [...clear, ...colours.map(({ rgb }) => entry(rgb))] };
  }
  const budget = maxColours - reserved;
  if (budget < 1 && colours.length > 0) {
    throw new RangeError("maxColours leaves no entry for opaque colours");
  }
  const palette: Rgba[] = [
    ...(reserved ? [TRANSPARENT] : []),
    ...(colours.length > 0 ? medianCut(budget, colours).map(meanOf) : []),
  ];
  const lookup = new Map(colours.map(({ rgb }) => [rgb, palette[nearest(palette, reserved, rgb)]]));
  const reduced = frames.map(({ data, height, width }) => {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 0) {
        out.set(lookup.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) ?? TRANSPARENT, i);
      }
    }
    return { data: out, height, width };
  });
  return { frames: reduced, palette };
}
