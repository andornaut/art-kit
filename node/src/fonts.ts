import { realpathSync } from "node:fs";

import { Canvas, FontLibrary } from "skia-canvas";

import type { GlyphKerning, SuppliedBitmapGlyph } from "./glyphAtlas.js";

export interface RasteriseOptions {
  path: string;
  size: number;
  characters: Iterable<string>;
  /** Defaults to true. */
  antialias?: boolean;
  /** Defaults to true. */
  hinting?: boolean;
  /** "all" measures every ordered pair of at most 256 unique characters; defaults to "none". */
  kerning?: "none" | "all";
}

export interface RasterisedGlyphs {
  /** Each unique character in order, trimmed to its ink, ready for glyphAtlas. */
  glyphs: Map<string, SuppliedBitmapGlyph>;
  /** The face's ascent and descent in pixels as Skia reports them, unrounded. */
  ascent: number;
  descent: number;
  /** The ascent rounded up: the baseline's row from the line's top, which yoffset counts from. */
  base: number;
  /** The ascent plus the descent, rounded up. */
  lineHeight: number;
  /** Every nonzero rounded pair adjustment, in character order; empty unless kerning is "all". */
  kernings: GlyphKerning[];
}

const families = new Map<string, string>();
// Clear pixels drawn around each glyph's measured ink bounds, which can miss antialiased edges.
const MARGIN = 8;

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 16384) {
    throw new RangeError(`${label} must be an integer in 1..16384`);
  }
  return value;
}

function codePoint(char: string): number {
  // eslint-disable-next-line no-control-regex
  if ([...char].length !== 1 || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(char)) {
    throw new RangeError("Characters must be printable Unicode code points");
  }
  return char.codePointAt(0)!;
}

/**
 * CPU Skia glyph rasterization. Each glyph is drawn alone, white, and trimmed to the pixels with
 * nonzero alpha: those are white with coverage in alpha and every other pixel is (0,0,0,0).
 * Offsets are integers from the pen and the line's top (base rows above the baseline); advances
 * and kerning round Skia's measurements to the nearest integer. Synthesis and cross-glyph
 * ligature and contextual substitutions are disabled. Font files remain immutable after
 * registration, and Skia may use a system fallback font for characters the file lacks.
 */
export function rasteriseGlyphs(options: RasteriseOptions): RasterisedGlyphs {
  const size = positive(options.size, "Font size");
  const kerning = options.kerning ?? "none";
  if (kerning !== "none" && kerning !== "all") {
    throw new RangeError("Kerning must be none or all");
  }
  const characters = [...new Set(options.characters)];
  characters.forEach(codePoint);
  if (kerning === "all" && characters.length > 256) {
    throw new RangeError("All kerning supports at most 256 unique characters");
  }
  const antialias = options.antialias ?? true;
  const hinting = options.hinting ?? true;
  const path = realpathSync(options.path);
  let family = families.get(path);
  if (!family) {
    family = `art-kit-bitmap-${families.size}`;
    FontLibrary.use(family, path);
    families.set(path, family);
  }
  const context = (width: number, height: number) => {
    const canvas = new Canvas(width, height);
    canvas.gpu = false;
    const ctx = canvas.getContext("2d");
    ctx.font = `${size}px "${family}"`;
    ctx.textBaseline = "alphabetic";
    ctx.fontSynthesis = false;
    ctx.fontKerning = "normal";
    // Glyphs are separate, so pair widths must not substitute ligatures.
    ctx.fontFeatureSettings = {
      calt: false,
      clig: false,
      dlig: false,
      hlig: false,
      liga: false,
      rclt: false,
      rlig: false,
    };
    ctx.fontHinting = hinting;
    ctx.fontSmoothing = antialias;
    ctx.fillStyle = "white";
    return ctx;
  };
  const measure = context(1, 1);
  const line = measure.measureText(" ");
  const ascent = line.fontBoundingBoxAscent;
  const descent = line.fontBoundingBoxDescent;
  const base = Math.ceil(ascent);
  const lineHeight = positive(Math.ceil(ascent + descent), "Line height");
  const glyphs = new Map<string, SuppliedBitmapGlyph>();
  const advances = new Map<string, number>();
  for (const char of characters) {
    const m = measure.measureText(char);
    advances.set(char, m.width);
    const xadvance = Math.round(m.width);
    const left = Math.floor(-m.actualBoundingBoxLeft);
    const top = Math.floor(-m.actualBoundingBoxAscent);
    const w = Math.max(0, Math.ceil(m.actualBoundingBoxRight) - left);
    const h = Math.max(0, Math.ceil(m.actualBoundingBoxDescent) - top);
    if (!w || !h) {
      glyphs.set(char, { image: undefined, xadvance, xoffset: 0, yoffset: 0 });
      continue;
    }
    const width = positive(w + 2 * MARGIN, "Glyph width");
    const height = positive(h + 2 * MARGIN, "Glyph height");
    const ctx = context(width, height);
    ctx.fillText(char, MARGIN - left, MARGIN - top);
    const { data } = ctx.getImageData(0, 0, width, height);
    let [x0, y0, x1, y1] = [width, height, -1, -1];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) {
      glyphs.set(char, { image: undefined, xadvance, xoffset: 0, yoffset: 0 });
      continue;
    }
    const iw = x1 - x0 + 1,
      ih = y1 - y0 + 1;
    const pixels = new Uint8Array(iw * ih * 4);
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const alpha = data[((y0 + y) * width + x0 + x) * 4 + 3];
        if (alpha) {
          pixels.set([255, 255, 255, alpha], (y * iw + x) * 4);
        }
      }
    }
    glyphs.set(char, {
      image: { data: pixels, height: ih, width: iw },
      xadvance,
      xoffset: left - MARGIN + x0,
      yoffset: base + top - MARGIN + y0,
    });
  }
  const kernings: GlyphKerning[] = [];
  if (kerning === "all") {
    for (const first of characters) {
      for (const second of characters) {
        const amount = Math.round(
          measure.measureText(first + second).width - advances.get(first)! - advances.get(second)!,
        );
        if (amount !== 0) {
          kernings.push({ amount, first: codePoint(first), second: codePoint(second) });
        }
      }
    }
  }
  return { ascent, base, descent, glyphs, kernings, lineHeight };
}
