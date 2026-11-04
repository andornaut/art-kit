import { Canvas } from "skia-canvas";
import type { Frame } from "./grid.js";
import { colourResolver, type ColourContext, type Rgb, type Sprite } from "./raster.js";

export type { ColourContext, Rgb, Sprite, Tag } from "./raster.js";

export function flipped(frame: Frame): Frame {
  return frame.map((row) => [...row].reverse());
}
function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
function surface(width: number, height: number): Canvas {
  if (!positive(width) || !positive(height))
    throw new RangeError("Canvas dimensions must be positive safe integers");
  const canvas = new Canvas(width, height);
  canvas.gpu = false;
  canvas.getContext("2d").imageSmoothingEnabled = false;
  return canvas;
}
function css([r, g, b]: Rgb): string {
  return `rgb(${r},${g},${b})`;
}

/** Returns a CPU Canvas with transparent empty cells and opaque resolved colours. */
export function renderFrame(context: ColourContext, frame: Frame): Canvas {
  const width = frame[0]?.length ?? 0;
  if (frame.some((row) => row.length !== width))
    throw new RangeError("Frame rows must have equal widths");
  const canvas = surface(width, frame.length),
    ctx = canvas.getContext("2d");
  const resolve = colourResolver(context);
  frame.forEach((row, y) =>
    row.forEach((colour, x) => {
      if (colour) {
        ctx.fillStyle = css(resolve(colour));
        ctx.fillRect(x, y, 1, 1);
      }
    }),
  );
  return canvas;
}

/** Places images in row order without scaling; each image is clipped to its cell. */
export function composeSheet(
  {
    columns,
    cellWidth,
    cellHeight,
  }: { columns: number; cellWidth: number; cellHeight: number },
  images: readonly Canvas[],
): Canvas {
  if (![columns, cellWidth, cellHeight].every(positive) || !images.length)
    throw new RangeError(
      "Sheet requires positive integer dimensions and images",
    );
  const canvas = surface(
    columns * cellWidth,
    Math.ceil(images.length / columns) * cellHeight,
  );
  const ctx = canvas.getContext("2d");
  images.forEach((image, i) => {
    const x = (i % columns) * cellWidth,
      y = Math.floor(i / columns) * cellHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellWidth, cellHeight);
    ctx.clip();
    ctx.drawImage(image, x, y);
    ctx.restore();
  });
  return canvas;
}

/** Returns an opaque preview Canvas; tags flatten in order, one row per ground. */
export function renderContactSheet(
  {
    resolveRgb,
    background,
    scale = 3,
    gap = 4,
  }: {
    resolveRgb: (colour: string) => Rgb;
    background: Rgb;
    scale?: number;
    gap?: number;
  },
  sprites: readonly Sprite[],
  grounds: readonly string[],
): Canvas {
  if (!positive(scale) || !Number.isSafeInteger(gap) || gap < 0)
    throw new RangeError(
      "Preview scale must be positive and gap nonnegative integers",
    );
  const rows = sprites.flatMap(([, tags]) => {
    const frames = tags.flatMap(([, frames]) => frames);
    return grounds.map((ground) => ({ frames, ground }));
  });
  if (!rows.length || rows.some(({ frames }) => !frames.length))
    throw new RangeError("Contact sheet requires frames and grounds");
  let cellWidth = 0,
    columns = 0,
    height = 0;
  const heights = rows.map(({ frames }) => {
    let rowHeight = 0;
    for (const frame of frames) {
      cellWidth = Math.max(cellWidth, frame[0]?.length ?? 0);
      rowHeight = Math.max(rowHeight, frame.length);
    }
    columns = Math.max(columns, frames.length);
    height += rowHeight + gap;
    return rowHeight;
  });
  const canvas = surface(columns * (cellWidth + gap) * scale, height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = css(background);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let top = 0;
  rows.forEach(({ frames, ground }, row) => {
    frames.forEach((frame, column) => {
      const image = renderFrame({ resolveRgb }, frame);
      const x = column * (cellWidth + gap) * scale;
      ctx.fillStyle = css(resolveRgb(ground));
      ctx.fillRect(x, top * scale, image.width * scale, image.height * scale);
      ctx.drawImage(
        image,
        x,
        top * scale,
        image.width * scale,
        image.height * scale,
      );
    });
    top += heights[row] + gap;
  });
  return canvas;
}
