import type { Point, Rect } from "../raster/geometry.js";
import { composite, crop, type Rgb } from "../raster/raster.js";
import type { RgbaImage } from "../raster/rgbaImage.js";
import type { BitmapGlyph, GlyphKerning } from "./glyphAtlas.js";

/** One unpacked RGBA page. Pixels, decoding, paths and caching remain caller-owned. */
export interface BitmapFont {
  base: number;
  lineHeight: number;
  width: number;
  height: number;
  page: string;
  glyphs: ReadonlyMap<number, BitmapGlyph>;
  kernings: readonly GlyphKerning[];
}

export interface BitmapTextOptions {
  font: BitmapFont;
  /** Added to lineHeight to form a positive integer line pitch; no implicit leading. */
  lineSpacing: number;
  missing: "reject" | "skip" | { fallback: number; absent: "reject" | "skip" };
}

export interface BitmapTextMeasurement {
  /** Final pen positions relative to the line origin, including spaces; may be negative. */
  lineAdvances: number[];
  /** Line-box height, including empty and trailing LF-delimited lines. */
  height: number;
  /** Union of declared nonempty glyph rectangles, including transparent bleed, not opaque ink. */
  glyphBounds: Rect | undefined;
}

export interface DrawBitmapTextOptions extends BitmapTextOptions {
  atlas: RgbaImage;
  /** First line's top-left, rather than its ink or baseline. */
  at: Point;
  tint: Rgb;
}

function integer(value: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Expected a safe integer in ${min}..${max}`);
  }
  return value;
}

function scalar(value: number) {
  integer(value, 0, 0x10ffff);
  if (value >= 0xd800 && value <= 0xdfff) {
    throw new RangeError("Expected a Unicode scalar");
  }
  return value;
}

function xmlCharacters(value: string) {
  for (const char of value) {
    const cp = scalar(char.codePointAt(0)!);
    if ((cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) || cp === 0xfffe || cp === 0xffff) {
      throw new RangeError("Invalid XML character");
    }
  }
  return value;
}

function unquote(value: string) {
  xmlCharacters(value);
  return value.replace(/&(?:([^;&]*);)?/g, (_, name: string | undefined) => {
    const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
    if (name !== undefined && Object.hasOwn(named, name)) {
      return named[name];
    }
    if (name !== undefined && /^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
      const cp =
        name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return xmlCharacters(String.fromCodePoint(scalar(cp)));
    }
    throw new RangeError("Unsupported XML entity");
  });
}

function numberAttribute(attrs: Record<string, string>, key: string, min?: number, max?: number) {
  if (!Object.hasOwn(attrs, key) || !/^-?\d+$/.test(attrs[key])) {
    throw new RangeError(`Missing or invalid ${key}`);
  }
  return integer(Number(attrs[key]), min, max);
}

function glyphRect(font: Pick<BitmapFont, "width" | "height">, g: BitmapGlyph) {
  scalar(g.id);
  integer(g.x, 0, font.width);
  integer(g.y, 0, font.height);
  integer(g.width, 0, font.width - g.x);
  integer(g.height, 0, font.height - g.y);
  integer(g.xoffset);
  integer(g.yoffset);
  integer(g.xadvance);
}

/**
 * Read glyphAtlas's padded/packed atlas XML and the same single-page Chibi dialect. Supports
 * quoted attributes with XML's five named entities and numeric references. Containers are font,
 * pages, chars and optional kernings; info/common/page/char/kerning are self-closing leaves.
 * Rejects DTDs, external entities, namespaces, other elements, channel packing and multiple pages.
 */
export function readBitmapFont(xml: string): BitmapFont {
  if (typeof xml !== "string") {
    throw new RangeError("Expected BMFont XML text");
  }
  xmlCharacters(xml);
  // Only the bounded BMFont vocabulary below is admitted; no external XML resolution occurs.
  const tokens =
    // eslint-disable-next-line max-len
    /\s*(<!--[\s\S]*?-->|<\?xml\s[^?]*\?>|<\/?[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>)/gy;
  const stack: string[] = [];
  const seen = new Set<string>();
  const glyphs = new Map<number, BitmapGlyph>();
  const kernings: GlyphKerning[] = [];
  const pairs = new Set<string>();
  let common: Record<string, string> | undefined;
  let page: string | undefined;
  let charCount: number | undefined;
  let kerningCount = 0;
  let offset = 0;
  let declaration = false;
  while (offset < xml.length) {
    tokens.lastIndex = offset;
    const match = tokens.exec(xml);
    if (!match) {
      if (/^\s*$/.test(xml.slice(offset))) {
        break;
      }
      throw new RangeError("Malformed or unsupported BMFont XML");
    }
    offset = tokens.lastIndex;
    const tag = match[1];
    if (tag.startsWith("<!--")) {
      if (tag.slice(4, -3).includes("--")) {
        throw new RangeError("Invalid XML comment");
      }
      continue;
    }
    if (tag.startsWith("<?")) {
      if (
        declaration ||
        seen.size ||
        !/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>$/i.test(tag)
      ) {
        throw new RangeError("Unsupported XML declaration");
      }
      declaration = true;
      continue;
    }
    const name = /^<\/?([A-Za-z0-9]+)/.exec(tag)![1];
    if (tag.startsWith("</")) {
      if (tag !== `</${name}>` || stack.pop() !== name) {
        throw new RangeError("Mismatched BMFont element");
      }
      continue;
    }
    const attrs: Record<string, string> = Object.create(null);
    for (const [, key, , value] of tag.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*=\s*(["'])(.*?)\2/gs)) {
      if (Object.hasOwn(attrs, key)) {
        throw new RangeError(`Duplicate XML attribute ${key}`);
      }
      attrs[key] = unquote(value);
    }
    const path = [...stack, name].join("/");
    const leaf = ["info", "common", "page", "char", "kerning"].includes(name);
    if (
      ![
        "font",
        "font/info",
        "font/common",
        "font/pages",
        "font/pages/page",
        "font/chars",
        "font/chars/char",
        "font/kernings",
        "font/kernings/kerning",
      ].includes(path) ||
      (leaf && !tag.endsWith("/>"))
    ) {
      throw new RangeError("Unsupported BMFont element or layout");
    }
    if (name !== "char" && name !== "kerning") {
      if (seen.has(path)) {
        throw new RangeError(`Duplicate BMFont element ${name}`);
      }
      seen.add(path);
    }
    if (name === "common") {
      numberAttribute(attrs, "pages", 1, 1);
      numberAttribute(attrs, "packed", 0, 0);
      if (attrs.alphaChnl !== undefined) {
        numberAttribute(attrs, "alphaChnl", 0, 0);
      }
      common = attrs;
    } else if (name === "info" && attrs.unicode !== undefined) {
      numberAttribute(attrs, "unicode", 1, 1);
    } else if (name === "page") {
      numberAttribute(attrs, "id", 0, 0);
      if (!attrs.file) {
        throw new RangeError("Expected a page filename");
      }
      page = attrs.file;
    } else if (name === "chars") {
      charCount = numberAttribute(attrs, "count", 0, 0x110000);
    } else if (name === "kernings") {
      kerningCount = numberAttribute(attrs, "count", 0);
    } else if (name === "char") {
      numberAttribute(attrs, "page", 0, 0);
      numberAttribute(attrs, "chnl", 15, 15);
      const g: BitmapGlyph = {
        height: numberAttribute(attrs, "height", 0),
        id: scalar(numberAttribute(attrs, "id")),
        width: numberAttribute(attrs, "width", 0),
        x: numberAttribute(attrs, "x", 0),
        xadvance: numberAttribute(attrs, "xadvance"),
        xoffset: numberAttribute(attrs, "xoffset"),
        y: numberAttribute(attrs, "y", 0),
        yoffset: numberAttribute(attrs, "yoffset"),
      };
      if (glyphs.has(g.id)) {
        throw new RangeError("Duplicate glyph code point");
      }
      glyphs.set(g.id, g);
    } else if (name === "kerning") {
      const k = {
        amount: numberAttribute(attrs, "amount"),
        first: scalar(numberAttribute(attrs, "first")),
        second: scalar(numberAttribute(attrs, "second")),
      };
      const key = `${k.first},${k.second}`;
      if (pairs.has(key)) {
        throw new RangeError("Duplicate kerning pair");
      }
      pairs.add(key);
      kernings.push(k);
    }
    if (!leaf && !tag.endsWith("/>")) {
      stack.push(name);
    }
  }
  if (
    stack.length ||
    !common ||
    page === undefined ||
    charCount !== glyphs.size ||
    kerningCount !== kernings.length
  ) {
    throw new RangeError("Incomplete BMFont XML or mismatched counts");
  }
  const font: BitmapFont = {
    base: numberAttribute(common, "base"),
    glyphs,
    height: numberAttribute(common, "scaleH", 1, 16384),
    kernings,
    lineHeight: numberAttribute(common, "lineHeight", 1, 16384),
    page,
    width: numberAttribute(common, "scaleW", 1, 16384),
  };
  for (const g of glyphs.values()) {
    glyphRect(font, g);
  }
  return font;
}

interface Placement extends Point {
  glyph: BitmapGlyph;
}

function layout({ font, lineSpacing, missing }: BitmapTextOptions, origin: Point, text: string) {
  integer(font.base);
  integer(font.lineHeight, 1, 16384);
  integer(font.width, 1, 16384);
  integer(font.height, 1, 16384);
  integer(lineSpacing);
  const pitch = integer(font.lineHeight + lineSpacing, 1);
  if (missing !== "reject" && missing !== "skip") {
    if (!missing || typeof missing !== "object" || !["reject", "skip"].includes(missing.absent)) {
      throw new RangeError("Expected an explicit missing-glyph policy");
    }
    scalar(missing.fallback);
  }
  if (typeof text !== "string") {
    throw new RangeError("Expected text");
  }
  const pairs = new Map<string, number>();
  for (const { amount, first, second } of font.kernings) {
    scalar(first);
    scalar(second);
    pairs.set(`${first},${second}`, integer(amount));
  }
  const placements: Placement[] = [];
  const lineAdvances: number[] = [];
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const [row, line] of text.split("\n").entries()) {
    const y = integer(row * pitch);
    integer(origin.y + y);
    let cursor = 0;
    let previous: number | undefined;
    for (const character of line) {
      const code = scalar(character.codePointAt(0)!);
      const g =
        font.glyphs.get(code) ??
        (typeof missing === "object" ? font.glyphs.get(missing.fallback) : undefined);
      if (!g) {
        if (missing === "reject" || (typeof missing === "object" && missing.absent === "reject")) {
          throw new RangeError(`Missing glyph U+${code.toString(16).toUpperCase()}`);
        }
        continue;
      }
      glyphRect(font, g);
      if (previous !== undefined) {
        cursor = integer(cursor + (pairs.get(`${previous},${code}`) ?? 0));
        integer(origin.x + cursor);
      }
      if (g.width && g.height) {
        const x0 = integer(cursor + g.xoffset),
          y0 = integer(y + g.yoffset);
        const x1 = integer(x0 + g.width),
          y1 = integer(y0 + g.height);
        left = Math.min(left, x0);
        right = Math.max(right, x1);
        top = Math.min(top, y0);
        bottom = Math.max(bottom, y1);
        placements.push({ glyph: g, x: x0, y: y0 });
      }
      cursor = integer(cursor + g.xadvance);
      integer(origin.x + cursor);
      previous = code;
    }
    lineAdvances.push(cursor);
  }
  const measurement: BitmapTextMeasurement = {
    glyphBounds:
      left === Infinity
        ? undefined
        : {
            height: integer(bottom - top, 0),
            width: integer(right - left, 0),
            x: left,
            y: top,
          },
    height: integer((lineAdvances.length - 1) * pitch + font.lineHeight, 1),
    lineAdvances,
  };
  integer(origin.y + measurement.height);
  return { measurement, placements };
}

/** Pure layout: literal LF lines, Unicode scalars, signed metrics and original-code-point kerning. */
export function measureBitmapText(options: BitmapTextOptions, text: string): BitmapTextMeasurement {
  return layout(options, { x: 0, y: 0 }, text).measurement;
}

function image(value: RgbaImage) {
  integer(value.width, 0);
  integer(value.height, 0);
  if (
    !(value.data instanceof Uint8Array) ||
    value.data.length !== integer(value.width * value.height * 4, 0)
  ) {
    throw new RangeError("Expected width * height * 4 RGBA bytes");
  }
}

/**
 * Tint every cropped RGB pixel, retain glyph coverage alpha, then use raster.composite's exact
 * source-over/clipping contract. Zero-alpha source pixels preserve the target's hidden RGB.
 * Validate the complete layout before drawing. Only target mutates; atlas/target buffers must differ.
 */
export function drawBitmapText(
  options: DrawBitmapTextOptions,
  text: string,
  target: RgbaImage,
): void {
  const { at, atlas, font, tint } = options;
  image(atlas);
  image(target);
  if (
    atlas.width !== font.width ||
    atlas.height !== font.height ||
    atlas.data.buffer === target.data.buffer
  ) {
    throw new RangeError("Expected a matching atlas separate from target");
  }
  integer(at.x);
  integer(at.y);
  if (
    !Array.isArray(tint) ||
    tint.length !== 3 ||
    !Array.from(tint).every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  ) {
    throw new RangeError("Expected three RGB tint bytes");
  }
  const { placements } = layout(options, at, text);
  const positioned = placements.map(({ glyph, x, y }) => {
    const point = { x: integer(at.x + x), y: integer(at.y + y) };
    integer(point.x + glyph.width);
    integer(point.y + glyph.height);
    return { glyph, point };
  });
  for (const { glyph, point } of positioned) {
    const ink = crop(glyph, atlas);
    for (let i = 0; i < ink.data.length; i += 4) {
      ink.data.set(tint, i);
    }
    composite(point, ink, target);
  }
}
