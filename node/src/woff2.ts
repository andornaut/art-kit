import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
type Compressor = (font: Uint8Array) => Promise<Uint8Array>;
let compressor: Compressor | undefined;
let encoding: Promise<unknown> = Promise.resolve();

function validate(font: Uint8Array): void {
  if (!(font instanceof Uint8Array) || font.byteLength < 12) {
    throw new RangeError("Expected a complete TrueType Uint8Array");
  }
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  if (view.getUint32(0) !== 0x00010000) {
    throw new RangeError("Expected a single TrueType 1.0 font, not CFF, TTC or WOFF");
  }
  const count = view.getUint16(4);
  const directoryEnd = 12 + count * 16;
  if (!count || directoryEnd > font.byteLength) {
    throw new RangeError("Incomplete TrueType table directory");
  }
  const tables = new Map<string, { length: number; offset: number }>();
  for (let i = 12; i < directoryEnd; i += 16) {
    const tag = String.fromCharCode(...font.subarray(i, i + 4));
    const offset = view.getUint32(i + 8),
      length = view.getUint32(i + 12);
    if (
      !/^[\x20-\x7e]{4}$/.test(tag) ||
      tables.has(tag) ||
      offset % 4 ||
      offset < directoryEnd ||
      offset + length > font.byteLength
    ) {
      throw new RangeError("Invalid, duplicate or out-of-bounds TrueType table");
    }
    tables.set(tag, { length, offset });
  }
  let end = directoryEnd;
  for (const table of [...tables.values()].sort((a, b) => a.offset - b.offset)) {
    if (table.length && table.offset < end) {
      throw new RangeError("Overlapping TrueType tables");
    }
    end = Math.max(end, table.offset + table.length);
  }
  if (["DSIG", "CFF ", "CFF2", "fvar", "gvar"].some((tag) => tables.has(tag))) {
    throw new RangeError("Signed, CFF and variable fonts are not supported");
  }
  const table = (tag: string, minimum: number) => {
    const entry = tables.get(tag);
    if (!entry || entry.length < minimum) {
      throw new RangeError(`Missing or truncated TrueType ${tag} table`);
    }
    return entry;
  };
  const head = table("head", 54),
    maxp = table("maxp", 6),
    hhea = table("hhea", 36);
  const glyphs = view.getUint16(maxp.offset + 4);
  const metrics = view.getUint16(hhea.offset + 34);
  const format = view.getInt16(head.offset + 50);
  if (
    !glyphs ||
    !metrics ||
    metrics > glyphs ||
    (format !== 0 && format !== 1) ||
    view.getUint32(head.offset + 12) !== 0x5f0f3cf5 ||
    view.getInt16(head.offset + 52) !== 0
  ) {
    throw new RangeError("Invalid TrueType glyph metrics or head");
  }
  table("hmtx", metrics * 4 + (glyphs - metrics) * 2);
  table("cmap", 4);
  table("name", 6);
  const glyf = table("glyf", 0);
  const step = format === 0 ? 2 : 4;
  const loca = table("loca", (glyphs + 1) * step);
  let previous = 0;
  for (let i = 0; i <= glyphs; i++) {
    const at = loca.offset + i * step;
    const offset = format === 0 ? view.getUint16(at) * 2 : view.getUint32(at);
    if (offset < previous || offset > glyf.length) {
      throw new RangeError("Invalid TrueType glyph offsets");
    }
    previous = offset;
  }
}

/**
 * Full static TrueType 1.0 (glyf/loca) to WOFF2, using optional wawoff2 2.0.1. No subsetting,
 * rasterization or public decoder. Signed/DSIG, CFF and variable fonts are rejected.
 * Google WOFF2 can normalize SFNT offsets, padding, glyf/loca/hmtx and head (checksum adjustment, flag
 * bit 11 and possibly loca format); decoded SFNT bytes need not equal the original serialization.
 * Font tables, Unicode mapping, glyph order/geometry, metrics, hinting and names are retained.
 */
export async function encodeWoff2(font: Uint8Array): Promise<Uint8Array> {
  validate(font);
  const input = new Uint8Array(font);
  // The upstream binding returns a WASM-memory view. Copy before another call can reuse it.
  const result = encoding.then(async () => {
    compressor ??= require("wawoff2/compress.js") as Compressor;
    return new Uint8Array(await compressor(input));
  });
  encoding = result.catch(() => undefined);
  return result;
}
