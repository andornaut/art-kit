// Sprite sheet PNG and JSON in the bytes Aseprite 1.2.30's command line writes for
// `aseprite -b <key>.aseprite --sheet <png> --data <json> --format json-hash --list-tags`, with
// `--list-slices` when margins are given and `--sheet-columns` when columns are given.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { rgb } from "./colour.js";
import { deflateChunks } from "./deflate.js";
import type { Frame } from "./grid.js";
import { pngFile } from "./pngChunks.js";
import type { Tag } from "./raster.js";
import type { RgbaImage } from "./rgbaImage.js";

export type { Tag } from "./raster.js";
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
// libpng's default compression buffer, which sizes every IDAT chunk but the last.
const IDAT_SIZE = 8192;

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

// ---------- PNG as Aseprite 1.2.30 writes it through libpng 1.6.38 ----------

function predict(type: number, previous: Uint8Array, row: Uint8Array, x: number): number {
  const left = x >= 4 ? row[x - 4]! : 0;
  const above = previous[x]!;
  switch (type) {
    case 1:
      return left;
    case 2:
      return above;
    case 3:
      return (left + above) >> 1;
    case 4: {
      const upLeft = x >= 4 ? previous[x - 4]! : 0;
      const p = left + above - upLeft;
      const pLeft = Math.abs(p - left);
      const pAbove = Math.abs(p - above);
      const pUpLeft = Math.abs(p - upLeft);
      if (pLeft <= pAbove && pLeft <= pUpLeft) {
        return left;
      }
      return pAbove <= pUpLeft ? above : upLeft;
    }
    default:
      return 0;
  }
}

// libpng's filter choice: the lowest sum of filtered bytes read as signed magnitudes, the earliest
// type on a tie. A single row cannot use the row above, and a single column the pixel to the left.
function filteredRows(image: RgbaImage): Uint8Array[] {
  const { data, height, width } = image;
  const rowBytes = width * 4;
  let types = [0, 1, 2, 3, 4];
  if (height === 1) {
    types = types.filter((type) => type < 2);
  }
  if (width === 1) {
    types = types.filter((type) => type === 0 || type === 2);
  }
  const rows: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes);
    let selected = types[0]!;
    if (types.length > 1) {
      let min = Infinity;
      for (const type of types) {
        let sum = 0;
        for (let x = 0; x < rowBytes; x++) {
          const v = (row[x]! - predict(type, previous, row, x)) & 0xff;
          sum += v < 128 ? v : 256 - v;
        }
        if (sum < min) {
          min = sum;
          selected = type;
        }
      }
    }
    const out = new Uint8Array(rowBytes + 1);
    out[0] = selected;
    for (let x = 0; x < rowBytes; x++) {
      out[x + 1] = row[x]! - predict(selected, previous, row, x);
    }
    rows.push(out);
    previous = row;
  }
  return rows;
}

// libpng compresses with the smallest window that holds the image data plus zlib's lookahead, then
// rewrites the first IDAT's header to the smallest window that holds the data alone.
function idat(rows: readonly Uint8Array[]): Uint8Array {
  const size = rows.reduce((total, row) => total + row.length, 0);
  let windowBits = 15;
  if (size <= 16384) {
    let half = 1 << (windowBits - 1);
    while (size + 262 <= half) {
      half >>= 1;
      windowBits--;
    }
  }
  const stream = deflateChunks(Math.max(9, windowBits), rows);
  if (size <= 16384) {
    let cmf = stream[0]!;
    if ((cmf & 0x0f) === 8 && (cmf & 0xf0) <= 0x70) {
      let cinfo = cmf >> 4;
      let half = 1 << (cinfo + 7);
      if (size <= half) {
        do {
          half >>= 1;
          cinfo--;
        } while (cinfo > 0 && size <= half);
        cmf = (cmf & 0x0f) | (cinfo << 4);
        stream[0] = cmf;
        const flags = stream[1]! & 0xe0;
        stream[1] = flags + 0x1f - (((cmf << 8) + flags) % 0x1f);
      }
    }
  }
  return stream;
}

function png(image: RgbaImage): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header.set([8, 6, 0, 0, 0], 8);
  const stream = idat(filteredRows(image));
  const chunks: [string, Uint8Array[]][] = [
    ["IHDR", [header]],
    ["sRGB", [Uint8Array.of(0)]],
  ];
  for (let at = 0; at < stream.length; at += IDAT_SIZE) {
    chunks.push(["IDAT", [stream.subarray(at, at + IDAT_SIZE)]]);
  }
  chunks.push(["IEND", []]);
  return pngFile(chunks);
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
  return { data: json(options, across, layout, image), sheet: png(image) };
}

// Writes spriteSheet's PNG to sheet and its data to data, creating their directories. meta.image is
// the sheet's file name.
export async function writeSpriteSheet(
  paths: { sheet: string; data: string },
  options: Omit<SpriteSheetOptions, "image">,
  tags: readonly Tag[],
): Promise<void> {
  const { data, sheet } = spriteSheet({ ...options, image: basename(paths.sheet) }, tags);
  for (const path of [paths.sheet, paths.data]) {
    // eslint-disable-next-line no-await-in-loop
    await mkdir(dirname(path), { recursive: true });
  }
  await writeFile(paths.sheet, sheet);
  await writeFile(paths.data, data, "utf8");
}
