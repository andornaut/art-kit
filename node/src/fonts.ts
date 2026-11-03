import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createCanvas, registerFont } from "canvas";
import { blankImage, opaqueRect, type RgbaImage } from "./rgbaImage.js";

export interface FontInfo {
  key: string;
  face: string;
  size: number;
  lineHeight: number;
  base: number;
}

export interface FontOptions {
  path: string;
  size: number;
  antialias?: boolean;
}

export type Glyph = readonly [image: RgbaImage | undefined, xOffset: number, yOffset: number, advance: number];
export type Kerning = readonly [first: string, second: string, amount: number];

const registered = new Set<string>();

function fontContext(options: FontOptions) {
  if (!Number.isSafeInteger(options.size) || options.size <= 0) {
    throw new RangeError("Font size must be a positive integer");
  }
  const path = realpathSync(options.path);
  const identity = createHash("sha256").update(readFileSync(path)).digest("hex");
  const family = `art_kit_${identity}`;
  if (!registered.has(identity)) {
    registerFont(path, { family, style: "normal", weight: "normal" });
    registered.add(identity);
  }
  const context = createCanvas(1, 1).getContext("2d");
  context.font = `${options.size}px "${family}"`;
  context.textBaseline = "alphabetic";
  context.antialias = options.antialias ? "gray" : "none";
  return context;
}

// Python's nearest-integer rule rounds ties to the even integer.
function roundEven(value: number): number {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
}

function codePoint(char: string): number {
  if ([...char].length !== 1) throw new RangeError("Expected one Unicode code point");
  return char.codePointAt(0)!;
}

/** Canvas/Pango renders missing characters using its fallback policy; callers supply font coverage. */
export function rasterizeGlyph(options: FontOptions, char: string): Glyph {
  codePoint(char);
  const context = fontContext(options);
  const metrics = context.measureText(char);
  const advance = roundEven(metrics.width);
  const ascent = Math.ceil(metrics.emHeightAscent);
  // Include signed ink extents and padding rather than clipping negative bearings.
  const left = Math.ceil(metrics.actualBoundingBoxLeft);
  const above = Math.ceil(metrics.actualBoundingBoxAscent);
  const width = Math.max(1, left + Math.ceil(metrics.actualBoundingBoxRight) + 4);
  const height = Math.max(1, above + Math.ceil(metrics.actualBoundingBoxDescent) + 4);
  const font = context.font;
  context.canvas.width = width;
  context.canvas.height = height;
  context.font = font;
  context.textBaseline = "alphabetic";
  context.antialias = options.antialias ? "gray" : "none";
  context.fillStyle = "white";
  const originX = left + 2;
  const baseline = above + 2;
  context.fillText(char, originX, baseline);
  const rgba = context.getImageData(0, 0, width, height);
  const image = { width, height, data: new Uint8Array(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength) };
  const bounds = opaqueRect({ x: 0, y: 0, width, height }, image);
  if (!bounds) return [undefined, 0, 0, advance];
  const cropped = blankImage(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const index = (y * bounds.width + x) * 4;
      cropped.data.set([255, 255, 255, rgba.data[((y + bounds.y) * width + x + bounds.x) * 4 + 3]], index);
    }
  }
  return [cropped, bounds.x - originX, bounds.y - baseline + ascent, advance];
}

export function rasterize(options: FontOptions, chars: Iterable<string>): {
  glyphs: Map<string, Glyph>;
  ascent: number;
  descent: number;
} {
  const metrics = fontContext(options).measureText(" ");
  const glyphs = new Map<string, Glyph>();
  for (const char of chars) glyphs.set(char, rasterizeGlyph(options, char));
  return { glyphs, ascent: Math.ceil(metrics.emHeightAscent), descent: Math.ceil(metrics.emHeightDescent) };
}

export function pack(atlasWidth: number, glyphs: ReadonlyMap<string, Glyph>): {
  image: RgbaImage;
  places: Map<string, readonly [number, number]>;
} {
  if (!Number.isSafeInteger(atlasWidth) || atlasWidth <= 0) throw new RangeError("Atlas width must be a positive integer");
  let x = 0, y = 0, rowHeight = 0;
  const places = new Map<string, readonly [number, number]>();
  for (const [char, [image]] of glyphs) {
    if (!image) { places.set(char, [0, 0]); continue; }
    if (image.width > atlasWidth) throw new RangeError(`Glyph ${JSON.stringify(char)} width ${image.width} exceeds atlas width ${atlasWidth}`);
    if (x + image.width + 1 > atlasWidth) { x = 0; y += rowHeight + 1; rowHeight = 0; }
    places.set(char, [x, y]);
    x += image.width + 1;
    rowHeight = Math.max(rowHeight, image.height);
  }
  let height = 1;
  while (height < y + rowHeight + 1) height *= 2;
  const atlas = blankImage(atlasWidth, height);
  for (const [char, [image]] of glyphs) {
    if (!image) continue;
    const [px, py] = places.get(char)!;
    for (let row = 0; row < image.height; row++) {
      atlas.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((py + row) * atlasWidth + px) * 4);
    }
  }
  return { image: atlas, places };
}

function quote(value: string): string {
  const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped.includes('"') && !escaped.includes("'") ? `'${escaped}'` : `"${escaped.replaceAll('"', "&quot;")}"`;
}

export function bmfontXml(
  info: FontInfo,
  atlasSize: readonly [number, number],
  places: ReadonlyMap<string, readonly [number, number]>,
  glyphs: ReadonlyMap<string, Glyph>,
  options: { kernings?: readonly Kerning[]; antialias?: boolean } = {},
): string {
  const [width, height] = atlasSize;
  const aa = Number(options.antialias ?? false);
  const lines = ['<?xml version="1.0"?>', '<font>',
    `  <info face=${quote(info.face)} size="${info.size}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="${aa}" aa="${aa}" padding="0,0,0,0" spacing="1,1"/>`,
    `  <common lineHeight="${info.lineHeight}" base="${info.base}" scaleW="${width}" scaleH="${height}" pages="1" packed="0"/>`,
    `  <pages><page id="0" file=${quote(info.key + ".png")}/></pages>`,
    `  <chars count="${glyphs.size}">`];
  for (const [char, [image, ox, oy, advance]] of glyphs) {
    const position = places.get(char);
    if (!position) throw new Error(`Missing glyph placement: ${char}`);
    const [x, y] = position;
    lines.push(`    <char id="${codePoint(char)}" x="${x}" y="${y}" width="${image?.width ?? 0}" height="${image?.height ?? 0}" xoffset="${ox}" yoffset="${oy}" xadvance="${advance}" page="0" chnl="15"/>`);
  }
  lines.push("  </chars>");
  if (options.kernings?.length) {
    lines.push(`  <kernings count="${options.kernings.length}">`);
    for (const [a, b, n] of options.kernings) lines.push(`    <kerning first="${codePoint(a)}" second="${codePoint(b)}" amount="${n}"/>`);
    lines.push("  </kernings>");
  }
  return [...lines, "</font>", ""].join("\n");
}
