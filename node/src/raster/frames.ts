// Pixel frames rendered to images, and frames or images laid out as sheets.
import { checkColour, checkImage, checkPositive, checkSize } from "./checks.js";
import { rgb } from "./colour.js";
import type { Frame } from "./grid.js";
import { crop, fill, filledImage, paste } from "./pixels.js";
import { resizeNearest } from "./resample.js";
import type { RgbaImage } from "./rgbaImage.js";
import type { Rgb, Rgba } from "./types.js";

/** A palette of names to hex colours (other names are hex colours), or a resolver to RGB. */
export type ColourContext =
  Readonly<Record<string, string>> | { resolveRgb: (colour: string) => Rgb };
/** A tag's name, frames and duration in milliseconds: one for every frame, or one each. */
export type Tag = readonly [
  name: string,
  frames: readonly Frame[],
  milliseconds: number | readonly number[],
];
/** A sprite's name and its tags in order. */
export type Sprite = readonly [name: string, tags: readonly Tag[]];
export interface ContactSheetOptions {
  resolveRgb: (colour: string) => Rgb;
  background: Rgb;
  /** "row-first-frame" sizes cells from first frames; "largest-frame" from every frame. */
  cellSize: "row-first-frame" | "largest-frame";
  scale?: number;
  gap?: number;
}

// The RGB of a frame colour name: the resolver's, or the palette entry's (else the name's) hex.
function colourResolver(context: ColourContext): (colour: string) => Rgb {
  if (typeof context.resolveRgb === "function") {
    return context.resolveRgb as (colour: string) => Rgb;
  }
  const palette = context as Readonly<Record<string, string>>;
  return (name) => rgb(Object.hasOwn(palette, name) ? palette[name] : name);
}

/** The frame as an image: null cells are (0,0,0,0), others their resolved colour, opaque. */
export function frameToRgba(context: ColourContext, frame: Frame): RgbaImage {
  const width = frame[0]?.length ?? 0;
  if (frame.some((row) => row.length !== width)) {
    throw new RangeError("Frame rows must have equal widths");
  }
  checkPositive(width, "Frame width");
  checkPositive(frame.length, "Frame height");
  const resolve = colourResolver(context);
  const out = { data: new Uint8Array(width * frame.length * 4), height: frame.length, width };
  frame.forEach((row, y) =>
    row.forEach((name, x) => {
      if (!name) {
        return;
      }
      const value = resolve(name);
      checkColour(3, value);
      out.data.set([...value, 255], (y * width + x) * 4);
    }),
  );
  return out;
}

export interface SheetOptions {
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

/**
 * The images in row order, one per cell from the top-left, each copied exactly (RGBA, without
 * blending or scaling) and clipped to its cell; unused cells are (0,0,0,0).
 */
export function composeSheet(
  { cellHeight, cellWidth, columns }: SheetOptions,
  images: readonly RgbaImage[],
): RgbaImage {
  checkPositive(columns, "Columns");
  checkPositive(cellWidth, "Cell width");
  checkPositive(cellHeight, "Cell height");
  if (!images.length) {
    throw new RangeError("Sheet must have images");
  }
  images.forEach(checkImage);
  const sheet = filledImage(
    [0, 0, 0, 0],
    columns * cellWidth,
    Math.ceil(images.length / columns) * cellHeight,
  );
  images.forEach((source, i) => {
    const cell = {
      height: Math.min(cellHeight, source.height),
      width: Math.min(cellWidth, source.width),
      x: 0,
      y: 0,
    };
    paste(
      { at: { x: (i % columns) * cellWidth, y: Math.floor(i / columns) * cellHeight } },
      crop(cell, source),
      sheet,
    );
  });
  return sheet;
}

/**
 * An opaque preview with one row per sprite and ground, tags flattened in order. Cells are
 * separated by gap and scaled by scale. "largest-frame" sizes every cell from the largest frame
 * (row height from the row's tallest) and draws each frame over its ground. "row-first-frame"
 * sizes cell width from the widest first frame and row height from each row's first frame, paints
 * every frame cell (empty cells in the ground colour) and lets later frames overwrite earlier
 * overflow.
 */
export function composeContactSheet(
  { background, cellSize, gap = 4, resolveRgb, scale = 3 }: ContactSheetOptions,
  sprites: readonly Sprite[],
  grounds: readonly string[],
): RgbaImage {
  checkPositive(scale, "Preview scale");
  checkSize(gap, "Gap");
  if (cellSize !== "row-first-frame" && cellSize !== "largest-frame") {
    throw new RangeError('Cell size must be "row-first-frame" or "largest-frame"');
  }
  checkColour(3, background);
  const rows = sprites.flatMap(([, tags]) => {
    const frames = tags.flatMap(([, frames]) => frames);
    return grounds.map((ground) => ({ frames, ground }));
  });
  if (!rows.length || rows.some(({ frames }) => !frames.length)) {
    throw new RangeError("Contact sheet must have frames and grounds");
  }
  const ink = (name: string): Rgba => {
    const value = resolveRgb(name);
    checkColour(3, value);
    return [value[0], value[1], value[2], 255];
  };
  const first = cellSize === "row-first-frame";
  let cellWidth = 0,
    columns = 0;
  const heights = rows.map(({ frames }) => {
    columns = Math.max(columns, frames.length);
    let rowHeight = 0;
    for (const frame of first ? frames.slice(0, 1) : frames) {
      cellWidth = Math.max(cellWidth, frame[0]?.length ?? 0);
      rowHeight = Math.max(rowHeight, frame.length);
    }
    return rowHeight + gap;
  });
  const pitch = cellWidth + gap;
  const total = heights.reduce((sum, height) => sum + height, 0);
  checkPositive(columns * pitch * scale, "Contact sheet width");
  checkPositive(total * scale, "Contact sheet height");
  const sheet = filledImage([...background, 255], columns * pitch * scale, total * scale);
  let top = 0;
  rows.forEach(({ frames, ground }, row) => {
    const under = ink(ground);
    frames.forEach((frame, column) => {
      const x0 = column * pitch * scale,
        y0 = top * scale;
      if (first) {
        // Every frame cell is painted, empty cells in the ground colour.
        frame.forEach((row, y) =>
          row.forEach((name, x) =>
            fill(
              { rect: { height: scale, width: scale, x: x0 + x * scale, y: y0 + y * scale } },
              name ? ink(name) : under,
              sheet,
            ),
          ),
        );
        return;
      }
      const cell = frameToRgba({ resolveRgb }, frame);
      const pixels = resizeNearest(cell.width * scale, cell.height * scale, cell);
      fill({ rect: { height: pixels.height, width: pixels.width, x: x0, y: y0 } }, under, sheet);
      paste({ at: { x: x0, y: y0 }, mask: "alpha" }, pixels, sheet);
    });
    top += heights[row];
  });
  return sheet;
}
