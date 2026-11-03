import type { BitmapGlyph } from "./fonts.js";
import { blankImage, blitExtruded, type RgbaImage } from "./rgbaImage.js";

export interface SuppliedGlyph {
  image: RgbaImage | undefined;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}
export interface GlyphKerning { first: number; second: number; amount: number }
export interface GlyphAtlasOptions {
  key: string;
  face: string;
  size: number;
  base: number;
  lineHeight: number;
  atlasWidth: number;
  padding?: number;
  maxHeight?: number;
  kernings?: readonly GlyphKerning[];
}
function integer(value: number, label: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${label} must be an integer in ${min}..${max}`);
  return value;
}
function scalar(id: number) {
  integer(id, "Code point", 0, 0x10ffff);
  if (id >= 0xd800 && id <= 0xdfff) throw new RangeError("Invalid Unicode scalar");
  return id;
}
function quote(value: string) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value))
    throw new RangeError("Invalid XML attribute character");
  return `"${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\t", "&#9;").replaceAll("\n", "&#10;").replaceAll("\r", "&#13;")}"`;
}
/** Packs caller-owned glyph pixels and integer metrics without rasterization or blending. */
export function buildBitmapFontFromGlyphs(options: GlyphAtlasOptions, supplied: ReadonlyMap<string, SuppliedGlyph>) {
  const width = integer(options.atlasWidth, "Atlas width", 1, 16384);
  const limit = integer(options.maxHeight ?? 16384, "Maximum height", 1, 16384);
  const padding = integer(options.padding ?? 1, "Padding", 0, 16384);
  const size = integer(options.size, "Size", 1, 16384);
  const base = integer(options.base, "Base");
  const lineHeight = integer(options.lineHeight, "Line height", 1, 16384);
  const face = quote(options.face), page = quote(options.key + ".png");
  const glyphs = new Map<string, BitmapGlyph>();
  let x = padding, y = padding, rowHeight = 0;
  for (const [char, source] of supplied) {
    if ([...char].length !== 1) throw new RangeError("Glyph key must be one Unicode scalar");
    const id = scalar(char.codePointAt(0)!);
    const { image } = source;
    const w = image ? integer(image.width, "Glyph width", 1, 16384) : 0;
    const h = image ? integer(image.height, "Glyph height", 1, 16384) : 0;
    if (image && (!(image.data instanceof Uint8Array) || image.data.length !== w * h * 4))
      throw new RangeError("Glyph data must contain exactly width * height * 4 bytes");
    if (image) {
      if (w + 2 * padding > width) throw new RangeError(`Glyph ${char} exceeds atlas width`);
      if (x + w + padding > width) { x = padding; y += rowHeight + padding; rowHeight = 0; }
      if (y + h + padding > limit) throw new RangeError("Glyph atlas exceeds maximum height");
    }
    glyphs.set(char, { id, x: image ? x : 0, y: image ? y : 0, width: w, height: h,
      xoffset: integer(source.xoffset, "xoffset"), yoffset: integer(source.yoffset, "yoffset"),
      xadvance: integer(source.xadvance, "xadvance") });
    if (image) { x += w + padding; rowHeight = Math.max(rowHeight, h); }
  }
  const height = Math.max(1, y + rowHeight + padding);
  if (height > limit) throw new RangeError("Glyph atlas exceeds maximum height");
  const kernings = (options.kernings ?? []).map(k => {
    const first = scalar(k.first), second = scalar(k.second);
    if (!glyphs.has(String.fromCodePoint(first)) || !glyphs.has(String.fromCodePoint(second)))
      throw new RangeError("Kerning pair must belong to supplied glyphs");
    return { first, second, amount: integer(k.amount, "Kerning amount") };
  });
  const image = blankImage(width, height);
  for (const [char, source] of supplied) {
    if (!source.image) continue;
    const g = glyphs.get(char)!;
    blitExtruded(source.image, { x: 0, y: 0, width: g.width, height: g.height }, 0, image, g);
  }
  const lines = ['<?xml version="1.0"?>', '<font>',
    `  <info face=${face} size="${size}" bold="0" italic="0" unicode="1"/>`,
    `  <common lineHeight="${lineHeight}" base="${base}" scaleW="${width}" scaleH="${height}" pages="1" packed="0"/>`,
    `  <pages><page id="0" file=${page}/></pages>`, `  <chars count="${glyphs.size}">`];
  for (const g of glyphs.values()) lines.push(`    <char ${Object.entries(g).map(([k,v]) => `${k}="${v}"`).join(" ")} page="0" chnl="15"/>`);
  lines.push('  </chars>', `  <kernings count="${kernings.length}">`);
  for (const k of kernings) lines.push(`    <kerning first="${k.first}" second="${k.second}" amount="${k.amount}"/>`);
  lines.push('  </kernings>', '</font>', '');
  return { image, xml: lines.join("\n"), metadata: { glyphs, kernings, size, base, lineHeight, face: options.face } };
}
