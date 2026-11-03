import { rgb } from "./colour.js";
import type { Colour, Frame } from "./grid.js";
import { blankImage, type RgbaImage } from "./rgbaImage.js";

export function opaque_rows(frames: readonly Frame[]): [number, number] | null {
  const rows = frames.flatMap((frame) => frame.flatMap((row, y) => row.some(Boolean) ? [y] : []));
  return rows.length ? [Math.min(...rows), Math.max(...rows)] : null;
}
export function opaque_cols(frames: readonly Frame[]): [number, number] | null {
  const cols = frames.flatMap((frame) => frame.flatMap((row) => row.flatMap((c, x) => c ? [x] : [])));
  return cols.length ? [Math.min(...cols), Math.max(...cols)] : null;
}
export function flipped(frame: Frame): Frame { return frame.map((row) => [...row].reverse()); }
export function to_image(frame: Frame): RgbaImage {
  const image = blankImage(frame[0].length, frame.length);
  frame.forEach((row, y) => row.forEach((colour, x) => {
    if (colour) image.data.set([...rgb(colour), 255], (y * image.width + x) * 4);
  }));
  return image;
}
export type Rgb = readonly [number, number, number];
export type Tag = readonly [name: string, frames: readonly Frame[], duration: unknown];
export type Sprite = readonly [name: string, tags: readonly Tag[]];
export interface ContactSheetOptions { background: Rgb; scale?: number; gap?: number; }

/** Returns opaque RGBA pixels; names and durations do not affect preview order. */
export function contact_sheet(resolve_rgb: (colour: string) => Rgb, sprites: readonly Sprite[], grounds: readonly string[], { background, scale = 3, gap = 4 }: ContactSheetOptions): RgbaImage {
  if (!Number.isInteger(scale) || scale < 1 || !Number.isInteger(gap) || gap < 0) throw new RangeError("Invalid preview scale or gap");
  const rows = sprites.flatMap(([, tags]) => {
    const frames = tags.flatMap(([, frames]) => frames);
    return grounds.map((ground) => ({ frames, ground }));
  });
  if (!rows.length || rows.some(({ frames }) => !frames.length)) throw new RangeError("Contact sheet requires frames and grounds");
  const cellWidth = Math.max(...rows.map(({ frames }) => frames[0][0].length)) + gap;
  const heights = rows.map(({ frames }) => frames[0].length + gap);
  const width = Math.max(...rows.map(({ frames }) => frames.length)) * cellWidth * scale;
  const image = blankImage(width, heights.reduce((a, b) => a + b, 0) * scale);
  for (let i = 0; i < image.data.length; i += 4) image.data.set([...background, 255], i);
  let y0 = 0;
  rows.forEach(({ frames, ground }, r) => {
    frames.forEach((frame, i) => frame.forEach((row, y) => row.forEach((colour, x) => {
      const pixel = [...resolve_rgb(colour || ground), 255];
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const xx = (i * cellWidth + x) * scale + sx, yy = (y0 + y) * scale + sy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < image.height) image.data.set(pixel, (yy * width + xx) * 4);
      }
    })));
    y0 += heights[r];
  });
  return image;
}

/** Pillow's integer source-over arithmetic avoids Canvas premultiplication loss. */
export function tile_sheet(tile_size: number, columns: number, tiles: readonly RgbaImage[]): RgbaImage {
  if (!Number.isInteger(tile_size) || tile_size < 1 || !Number.isInteger(columns) || columns < 1) throw new RangeError("Tile size and columns must be positive integers");
  const image = blankImage(columns * tile_size, Math.ceil(tiles.length / columns) * tile_size);
  const shift = (a: number): number => Math.floor((Math.floor(a / 256) + a) / 256);
  tiles.forEach((tile, i) => {
    const left = (i % columns) * tile_size, top = Math.floor(i / columns) * tile_size;
    for (let y = 0; y < tile.height && top + y < image.height; y++) for (let x = 0; x < tile.width && left + x < image.width; x++) {
      const src = (y * tile.width + x) * 4, dst = ((top + y) * image.width + left + x) * 4;
      const sa = tile.data[src + 3], da = image.data[dst + 3];
      if (!sa) continue;
      const blend = da * (255 - sa), alpha = sa * 255 + blend;
      const c1 = Math.floor(sa * 255 * 255 * 128 / alpha), c2 = 255 * 128 - c1;
      for (let c = 0; c < 3; c++) image.data[dst + c] = Math.floor(shift(tile.data[src + c] * c1 + image.data[dst + c] * c2 + 128 * 128) / 128);
      image.data[dst + 3] = shift(alpha + 128);
    }
  });
  return image;
}
