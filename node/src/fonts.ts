import { realpathSync } from "node:fs";
import { Canvas, FontLibrary } from "skia-canvas";

export interface BitmapFontOptions {
  path: string;
  size: number;
  key: string;
  characters: Iterable<string>;
  atlasWidth: number;
  maxHeight?: number;
  padding?: number;
  lineHeight?: number;
  antialias?: boolean;
  hinting?: boolean;
  kerningPairs?: Iterable<readonly [string, string]>;
}

export interface BitmapGlyph {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

const families = new Map<string, string>();

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 16384) {
    throw new RangeError(`${label} must be an integer in 1..16384`);
  }
  return value;
}

function codePoint(char: string): number {
  if (
    [...char].length !== 1 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(char)
  ) {
    throw new RangeError("Characters must be printable Unicode code points");
  }
  return char.codePointAt(0)!;
}

function quote(value: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    throw new RangeError("Invalid XML attribute character");
  }
  return `"${value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;")}"`;
}

/**
 * CPU Skia bitmap atlas. Metrics use outward-rounded ink bounds and nearest
 * integer advances/kerning; no shaping across glyph boundaries is represented.
 * Font files remain immutable after registration. Skia may use system fallback:
 * callers must supply covered characters when reproducible font selection matters.
 */
export function buildBitmapFont(options: BitmapFontOptions) {
  const size = positive(options.size, "Font size");
  const width = positive(options.atlasWidth, "Atlas width");
  const maxHeight = positive(
    options.maxHeight ?? 16384,
    "Maximum atlas height",
  );
  const padding = options.padding ?? 1;
  if (!Number.isSafeInteger(padding) || padding < 1 || padding > 16384) {
    throw new RangeError("Padding must be an integer in 1..16384");
  }
  const key = quote(options.key + ".png");
  const path = realpathSync(options.path);
  let family = families.get(path);
  if (!family) {
    family = `art_kit_bitmap_${families.size}`;
    FontLibrary.use(family, path);
    families.set(path, family);
  }
  const image = new Canvas(width, 1);
  image.gpu = false;
  const context = image.getContext("2d");
  const configure = () => {
    context.font = `${size}px "${family}"`;
    context.textBaseline = "alphabetic";
    context.fontSynthesis = false;
    context.fontHinting = options.hinting ?? true;
    context.fontSmoothing = options.antialias ?? true;
    context.fillStyle = "white";
  };
  configure();
  const metrics = context.measureText(" ");
  const base = Math.ceil(metrics.fontBoundingBoxAscent);
  const lineHeight = positive(
    options.lineHeight ??
      Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent),
    "Line height",
  );
  const glyphs = new Map<string, BitmapGlyph>();
  let x = padding,
    y = padding,
    rowHeight = 0;
  for (const char of options.characters) {
    const id = codePoint(char);
    if (glyphs.has(char)) continue;
    const m = context.measureText(char);
    const left = Math.floor(-m.actualBoundingBoxLeft);
    const top = Math.floor(-m.actualBoundingBoxAscent);
    const w = Math.max(0, Math.ceil(m.actualBoundingBoxRight) - left);
    const h = Math.max(0, Math.ceil(m.actualBoundingBoxDescent) - top);
    const hasInk = w > 0 && h > 0;
    if (hasInk) {
      if (w + padding * 2 > width)
        throw new RangeError(`Glyph ${char} exceeds atlas width`);
      if (x + w + padding > width) {
        x = padding;
        y += rowHeight + padding;
        rowHeight = 0;
      }
      if (y + h + padding > maxHeight)
        throw new RangeError("Font exceeds maximum atlas height");
    }
    glyphs.set(char, {
      id,
      x: hasInk ? x : 0,
      y: hasInk ? y : 0,
      width: hasInk ? w : 0,
      height: hasInk ? h : 0,
      xoffset: hasInk ? left : 0,
      yoffset: hasInk ? base + top : 0,
      xadvance: Math.round(m.width),
    });
    if (hasInk) {
      x += w + padding;
      rowHeight = Math.max(rowHeight, h);
    }
  }
  const kernings = [] as { first: number; second: number; amount: number }[];
  const seen = new Set<string>();
  for (const [first, second] of options.kerningPairs ?? []) {
    const a = codePoint(first),
      b = codePoint(second),
      pair = `${a},${b}`;
    if (!glyphs.has(first) || !glyphs.has(second))
      throw new RangeError("Kerning pair must belong to characters");
    if (seen.has(pair)) continue;
    seen.add(pair);
    const amount = Math.round(
      context.measureText(first + second).width -
        context.measureText(first).width -
        context.measureText(second).width,
    );
    kernings.push({ first: a, second: b, amount });
  }
  image.height = Math.max(1, y + rowHeight + padding);
  if (image.height > maxHeight)
    throw new RangeError("Font exceeds maximum atlas height");
  configure();
  for (const [char, glyph] of glyphs) {
    if (glyph.width && glyph.height)
      context.fillText(
        char,
        glyph.x - glyph.xoffset,
        glyph.y - glyph.yoffset + base,
      );
  }
  const aa = Number(options.antialias ?? true);
  const lines = [
    '<?xml version="1.0"?>',
    "<font>",
    `  <info face=${quote(options.key)} size="${size}" bold="0" italic="0" unicode="1" smooth="${aa}" aa="${aa}"/>`,
    `  <common lineHeight="${lineHeight}" base="${base}" scaleW="${width}" scaleH="${image.height}" pages="1" packed="0"/>`,
    `  <pages><page id="0" file=${key}/></pages>`,
    `  <chars count="${glyphs.size}">`,
  ];
  for (const glyph of glyphs.values()) {
    lines.push(
      `    <char ${Object.entries(glyph)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")} page="0" chnl="15"/>`,
    );
  }
  lines.push("  </chars>", `  <kernings count="${kernings.length}">`);
  for (const k of kernings)
    lines.push(
      `    <kerning first="${k.first}" second="${k.second}" amount="${k.amount}"/>`,
    );
  lines.push("  </kernings>", "</font>", "");
  return {
    image,
    xml: lines.join("\n"),
    metadata: {
      glyphs,
      kernings,
      size,
      base,
      lineHeight,
      antialias: Boolean(aa),
      hinting: options.hinting ?? true,
      fallback: "system" as const,
    },
  };
}
