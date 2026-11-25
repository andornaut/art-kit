// Sprite sheet pixels and json-hash text matching Aseprite 1.2.30's command-line export:
// `aseprite -b <key>.aseprite --sheet <png> --data <json> --format json-hash --list-tags`, with
// `--list-slices` when margins are given and `--sheet-columns` when columns are given.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { encodeRgbaPng } from "../codecs/png.js";
import { rgb } from "../raster/colour.js";
import type { Tag } from "../raster/frames.js";
import type { Frame } from "../raster/grid.js";
import type { RgbaImage } from "../raster/rgbaImage.js";

// Nine-slice margins in pixels from each frame edge.
export type Margins = readonly [left: number, top: number, right: number, bottom: number];

export interface SpriteSheetOptions {
  // Names the frames `<key> <index>.aseprite` (`<key>.aseprite` for a single frame) and the slice.
  key: string;
  // The sheet file name written as meta.image.
  image: string;
  // Frames per row; one row of every frame when omitted.
  columns?: number;
  // Writes meta.slices with one slice named key over frame 0, centred inside the margins.
  margins?: Margins;
}

export interface SpriteSheet {
  // The sheet as PNG bytes.
  sheet: Uint8Array;
  // The json-hash data.
  data: string;
}

const APP = "http://www.aseprite.org/";
const VERSION = "1.2.30-x64";
const PNG_OPTIONS = { deflateLevel: 6, deflateStrategy: 0, filterType: -1 };

// Aseprite's escape_for_json: backslashes and double quotes only.
function escape(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

// The duration Aseprite stores for one given in milliseconds: converted to seconds and back, truncated,
// within 1..65535.
function storedDuration(milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError("Durations must be finite");
  }
  return Math.min(65535, Math.max(1, Math.trunc((milliseconds / 1000) * 1000)));
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

interface Layout {
  readonly frames: readonly Frame[];
  readonly durations: readonly number[];
  readonly ranges: readonly (readonly [name: string, from: number, to: number])[];
  readonly width: number;
  readonly height: number;
}

function layoutOf(tags: readonly Tag[]): Layout {
  const first = tags[0]?.[1][0];
  const height = first?.length ?? 0;
  const width = first?.[0]?.length ?? 0;
  if (width === 0 || height === 0) {
    throw new RangeError("The first frame must have pixels");
  }
  const frames: Frame[] = [];
  const durations: number[] = [];
  const ranges: [string, number, number][] = [];
  for (const [name, images, ms] of tags) {
    if (images.length === 0) {
      throw new RangeError(`Tag ${name} has no frames`);
    }
    const times = typeof ms === "number" ? images.map(() => ms) : ms;
    if (times.length !== images.length) {
      throw new RangeError("Each frame requires one duration");
    }
    ranges.push([name, frames.length, frames.length + images.length - 1]);
    images.forEach((frame, i) => {
      if (frame.length !== height || frame.some((row) => row.length !== width)) {
        throw new RangeError(`Every frame must be ${width}x${height}`);
      }
      frames.push(frame);
      durations.push(storedDuration(times[i]!));
    });
  }
  return { durations, frames, height, ranges, width };
}

function render(columns: number, layout: Layout): RgbaImage {
  const { frames, height, width } = layout;
  const across = Math.min(columns, frames.length);
  const sheetWidth = across * width;
  const sheetHeight = Math.ceil(frames.length / columns) * height;
  const data = new Uint8Array(sheetWidth * sheetHeight * 4);
  frames.forEach((frame, i) => {
    const left = (i % columns) * width;
    const top = Math.floor(i / columns) * height;
    frame.forEach((row, y) => {
      row.forEach((colour, x) => {
        if (colour) {
          data.set([...rgb(colour), 255], ((top + y) * sheetWidth + left + x) * 4);
        }
      });
    });
  });
  return { data, height: sheetHeight, width: sheetWidth };
}

function json(
  options: SpriteSheetOptions,
  columns: number,
  layout: Layout,
  size: RgbaImage,
): string {
  const { image, key, margins } = options;
  const { durations, frames, height, ranges, width } = layout;
  const single = frames.length === 1;
  const entries = frames.map((_, i) => {
    const x = (i % columns) * width;
    const y = Math.floor(i / columns) * height;
    const name = escape(single ? `${key}.aseprite` : `${key} ${i}.aseprite`);
    return (
      `   "${name}": {\n` +
      `    "frame": { "x": ${x}, "y": ${y}, "w": ${width}, "h": ${height} },\n` +
      `    "rotated": false,\n` +
      `    "trimmed": false,\n` +
      `    "spriteSourceSize": { "x": 0, "y": 0, "w": ${width}, "h": ${height} },\n` +
      `    "sourceSize": { "w": ${width}, "h": ${height} },\n` +
      `    "duration": ${durations[i]}\n` +
      `   }`
    );
  });
  const tagLines = ranges.map(
    ([name, from, to]) =>
      `\n   { "name": "${escape(name)}", "from": ${from}, "to": ${to}, "direction": "forward" }`,
  );
  let text =
    `{ "frames": {\n${entries.join(",\n")}\n }` +
    `,\n "meta": {\n` +
    `  "app": "${APP}",\n` +
    `  "version": "${VERSION}",\n` +
    `  "image": "${escape(image)}",\n` +
    `  "format": "RGBA8888",\n` +
    `  "size": { "w": ${size.width}, "h": ${size.height} },\n` +
    `  "scale": "1"` +
    `,\n  "frameTags": [${tagLines.join(",")}\n  ]`;
  if (margins) {
    const [left, top, right, bottom] = margins;
    text +=
      `,\n  "slices": [` +
      `\n   { "name": "${escape(key)}", "keys": [{ "frame": 0, ` +
      `"bounds": {"x": 0, "y": 0, "w": ${width}, "h": ${height} }, ` +
      `"center": {"x": ${left}, "y": ${top}, "w": ${width - left - right}, "h": ${height - top - bottom} } }] }` +
      `\n  ]`;
  }
  return `${text}\n }\n}\n`;
}

// ---------- public interface ----------

// The sheet PNG and its json-hash data. Frames are laid out left to right in tag order, wrapping
// after columns; every pixel is opaque or clear. Durations are stored as Aseprite stores them:
// truncated to whole milliseconds within 1..65535, so 1001 becomes 1000.
export function spriteSheet(options: SpriteSheetOptions, tags: readonly Tag[]): SpriteSheet {
  const { columns, margins } = options;
  if (columns !== undefined && (!Number.isSafeInteger(columns) || columns <= 0)) {
    throw new RangeError("columns must be a positive integer");
  }
  const layout = layoutOf(tags);
  if (margins) {
    const [left, top, right, bottom] = margins;
    if (!margins.every(isCount) || left + right >= layout.width || top + bottom >= layout.height) {
      throw new RangeError("Margins must be whole pixels that leave a centre");
    }
  }
  const across = columns ?? layout.frames.length;
  const image = render(across, layout);
  return { data: json(options, across, layout, image), sheet: encodeRgbaPng(PNG_OPTIONS, image) };
}

// Writes spriteSheet's PNG to sheet and its data to data, creating their directories. meta.image is
// the sheet's file name.
export async function writeSpriteSheet(
  paths: { sheet: string; data: string },
  options: Omit<SpriteSheetOptions, "image">,
  tags: readonly Tag[],
): Promise<void> {
  if (resolve(paths.sheet) === resolve(paths.data)) {
    throw new RangeError("Sprite sheet PNG and JSON must resolve to different paths");
  }
  const { data, sheet } = spriteSheet({ ...options, image: basename(paths.sheet) }, tags);
  for (const path of [paths.sheet, paths.data]) {
    // eslint-disable-next-line no-await-in-loop
    await mkdir(dirname(path), { recursive: true });
  }
  await writeFile(paths.sheet, sheet);
  await writeFile(paths.data, data, "utf8");
}
