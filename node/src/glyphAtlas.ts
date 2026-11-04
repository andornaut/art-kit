import { blankImage, blitExtruded, type RgbaImage } from "./rgbaImage.js";

/** A packed glyph's code point, atlas rect and metrics, as the BMFont char element writes them. */
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
export interface SuppliedBitmapGlyph {
  image: RgbaImage | undefined;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}
export interface GlyphKerning {
  first: number;
  second: number;
  amount: number;
}
interface GlyphAtlasCommonOptions {
  key: string;
  face: string;
  size: number;
  base: number;
  lineHeight: number;
  atlasWidth: number;
  kernings?: readonly GlyphKerning[];
}
/** Inset and spaced by `padding` (default 1); the atlas height fits the last row. */
export interface PaddedGlyphAtlasOptions extends GlyphAtlasCommonOptions {
  layout?: "padded";
  padding?: number;
}
/**
 * From (0, 0) with 1 px spacing, a power-of-two height and the full info attribute set, with
 * `smooth` and `aa` from `antialias`; byte-identical to the frozen `bmfont-packed.json` references.
 */
export interface PackedGlyphAtlasOptions extends GlyphAtlasCommonOptions {
  layout: "packed";
  antialias: boolean;
}
export type GlyphAtlasOptions = PaddedGlyphAtlasOptions | PackedGlyphAtlasOptions;
export type GlyphAtlasLayout = NonNullable<GlyphAtlasOptions["layout"]>;
function integer(
  value: number,
  label: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${label} must be an integer in ${min}..${max}`);
  return value;
}
function scalar(id: number) {
  integer(id, "Code point", 0, 0x10ffff);
  if (id >= 0xd800 && id <= 0xdfff) throw new RangeError("Invalid Unicode scalar");
  return id;
}
function quote(value: string, singleQuotes = false) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value))
    throw new RangeError("Invalid XML attribute character");
  const text = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
  // With singleQuotes, a value holding double quotes but no single quotes is wrapped in single
  // quotes and its double quotes are left unescaped.
  if (singleQuotes && !text.includes("'")) return text.includes('"') ? `'${text}'` : `"${text}"`;
  return `"${text.replaceAll('"', "&quot;")}"`;
}
/**
 * Packs caller-owned glyph pixels and integer metrics without rasterization or blending, in the
 * explicit `layout` ("padded" when omitted).
 */
export function buildBitmapFontFromGlyphs(
  options: GlyphAtlasOptions,
  supplied: ReadonlyMap<string, SuppliedBitmapGlyph>,
) {
  const layout: GlyphAtlasLayout = options.layout ?? "padded";
  if (layout !== "padded" && layout !== "packed")
    throw new RangeError("Layout must be padded or packed");
  const packed = layout === "packed";
  const loose = options as { padding?: unknown; antialias?: unknown };
  if (packed && loose.padding !== undefined)
    throw new RangeError("Packed layout has fixed 1 px spacing and no padding");
  if (!packed && loose.antialias !== undefined)
    throw new RangeError("antialias applies only to the packed layout");
  if (packed && typeof loose.antialias !== "boolean")
    throw new RangeError("Packed layout requires a boolean antialias");
  const width = integer(options.atlasWidth, "Atlas width", 1, 16384);
  const limit = 16384;
  const padding = packed
    ? 0
    : integer((options as PaddedGlyphAtlasOptions).padding ?? 1, "Padding", 0, 16384);
  const size = integer(options.size, "Size", 1, 16384);
  const base = integer(options.base, "Base");
  const lineHeight = integer(options.lineHeight, "Line height", 1, 16384);
  const face = quote(options.face, packed),
    page = quote(options.key + ".png", packed);
  const glyphs = new Map<string, BitmapGlyph>();
  // Packed starts at the origin and wraps when the glyph plus its trailing spacing pixel overflows.
  const spacing = packed ? 1 : padding;
  let x = padding,
    y = padding,
    rowHeight = 0;
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
      if (x + w + spacing > width) {
        x = padding;
        y += rowHeight + spacing;
        rowHeight = 0;
      }
      if (y + h + padding > limit) throw new RangeError("Glyph atlas exceeds maximum height");
    }
    glyphs.set(char, {
      id,
      x: image ? x : 0,
      y: image ? y : 0,
      width: w,
      height: h,
      xoffset: integer(source.xoffset, "xoffset"),
      yoffset: integer(source.yoffset, "yoffset"),
      xadvance: integer(source.xadvance, "xadvance"),
    });
    if (image) {
      x += w + spacing;
      rowHeight = Math.max(rowHeight, h);
    }
  }
  let height = Math.max(1, y + rowHeight + padding);
  if (packed) for (height = 1; height < y + rowHeight + 1;) height *= 2;
  if (height > limit) throw new RangeError("Glyph atlas exceeds maximum height");
  const kernings = (options.kernings ?? []).map((k) => {
    const first = scalar(k.first),
      second = scalar(k.second);
    if (!glyphs.has(String.fromCodePoint(first)) || !glyphs.has(String.fromCodePoint(second)))
      throw new RangeError("Kerning pair must belong to supplied glyphs");
    return { first, second, amount: integer(k.amount, "Kerning amount") };
  });
  const image = blankImage(width, height);
  for (const [char, source] of supplied) {
    if (!source.image) continue;
    const g = glyphs.get(char)!;
    blitExtruded(
      { at: g, extrude: 0, from: { x: 0, y: 0, width: g.width, height: g.height } },
      source.image,
      image,
    );
  }
  const aa = packed ? Number((options as PackedGlyphAtlasOptions).antialias) : 0;
  const info = packed
    ? `charset="" unicode="1" stretchH="100" smooth="${aa}" aa="${aa}" padding="0,0,0,0" spacing="1,1"`
    : 'unicode="1"';
  const lines = [
    '<?xml version="1.0"?>',
    "<font>",
    `  <info face=${face} size="${size}" bold="0" italic="0" ${info}/>`,
    `  <common lineHeight="${lineHeight}" base="${base}" scaleW="${width}" scaleH="${height}" pages="1" packed="0"/>`,
    `  <pages><page id="0" file=${page}/></pages>`,
    `  <chars count="${glyphs.size}">`,
  ];
  for (const g of glyphs.values())
    lines.push(
      `    <char ${Object.entries(g)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")} page="0" chnl="15"/>`,
    );
  lines.push("  </chars>");
  // Packed omits an empty kernings element.
  if (!packed || kernings.length) {
    lines.push(`  <kernings count="${kernings.length}">`);
    for (const k of kernings)
      lines.push(`    <kerning first="${k.first}" second="${k.second}" amount="${k.amount}"/>`);
    lines.push("  </kernings>");
  }
  lines.push("</font>", "");
  return {
    image,
    xml: lines.join("\n"),
    metadata: {
      glyphs,
      kernings,
      size,
      base,
      lineHeight,
      face: options.face,
      layout,
      ...(packed ? { antialias: Boolean(aa) } : {}),
    },
  };
}
