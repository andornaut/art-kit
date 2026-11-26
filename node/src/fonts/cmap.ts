// Unicode coverage from a font's cmap table. No I/O.
import { tableRecords } from "./sfnt.js";

// Unicode cmap subtables by platform and encoding ID, most complete first. Format 12 covers the
// full Unicode range and format 4 the Basic Multilingual Plane.
const FORMAT_12 = ["3.10", "0.4", "0.6"];
const FORMAT_4 = ["3.1", "0.3", "0.4", "0.2", "0.1", "0.0"];
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]); // 1.0, "true", "OTTO"

/**
 * The Unicode code points a TrueType or OpenType font's cmap maps to a glyph other than .notdef,
 * from its format 12 Unicode subtable, else its format 4 one; label names the font in errors.
 * Font collections, WOFF and other formats throw RangeError.
 */
export function coverageOf(label: string, font: Uint8Array): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const fail = (constraint: string): never => {
    throw new RangeError(`${label} ${constraint}`);
  };
  const check = (at: number, length: number, part: string): void => {
    if (at < 0 || at + length > font.byteLength) {
      fail(`${part} must end within the file`);
    }
  };
  const u16 = (at: number): number => {
    check(at, 2, "fields");
    return view.getUint16(at);
  };
  const u32 = (at: number): number => {
    check(at, 4, "fields");
    return view.getUint32(at);
  };

  const version = u32(0);
  if (version === 0x74746366) {
    fail("must not be a font collection (ttcf)");
  }
  if (!SFNT_VERSIONS.has(version)) {
    fail("must be a TrueType or OpenType sfnt");
  }
  check(12, 16 * u16(4), "table directory");
  const record = tableRecords(font).findLast(({ tag }) => tag === "cmap");
  if (record === undefined) {
    return fail("must have a cmap table");
  }
  const cmap = record.offset;
  check(cmap, record.length, "cmap table");
  const cmapEnd = cmap + record.length;
  const checkCmap = (at: number, length: number, part: string): void => {
    if (at + length > cmapEnd) {
      fail(`${part} must end within the cmap table`);
    }
  };
  const subtables = new Map<string, number>();
  checkCmap(cmap, 4, "cmap header");
  const count = u16(cmap + 2);
  const directoryEnd = cmap + 4 + 8 * count;
  checkCmap(cmap + 4, 8 * count, "cmap encoding records");
  for (let entry = cmap + 4; entry < directoryEnd; entry += 8) {
    const at = cmap + u32(entry + 4);
    if (at < directoryEnd) {
      fail("cmap subtables must start after the encoding records");
    }
    checkCmap(at, 2, "cmap subtable format");
    const id = `${u16(entry)}.${u16(entry + 2)}`;
    subtables.set(`${id}.${u16(at)}`, at);
  }
  const find = (format: number, ids: readonly string[]): number | undefined =>
    ids.map((id) => subtables.get(`${id}.${format}`)).find((at) => at !== undefined);
  const subtableEnd = (at: number, format: 4 | 12): number => {
    const headerLength = format === 4 ? 14 : 16;
    const part = `format ${format} subtable`;
    checkCmap(at, headerLength, part);
    const length = format === 4 ? u16(at + 2) : u32(at + 4);
    if (length < headerLength) {
      fail(`${part} must contain its header`);
    }
    checkCmap(at, length, part);
    return at + length;
  };

  const mapped = new Set<number>();
  const format12 = find(12, FORMAT_12);
  if (format12 !== undefined) {
    const endOfSubtable = subtableEnd(format12, 12);
    const groups = u32(format12 + 12);
    const groupsEnd = format12 + 16 + 12 * groups;
    if (groupsEnd > endOfSubtable) {
      fail("format 12 groups must end within the subtable");
    }
    for (let group = format12 + 16; group < groupsEnd; group += 12) {
      const [start, end, glyph] = [u32(group), u32(group + 4), u32(group + 8)];
      if (start > end || end > 0x10ffff) {
        fail("format 12 groups must be Unicode ranges");
      }
      for (let c = start; c <= end; c++) {
        if (glyph + c - start !== 0) {
          mapped.add(c);
        }
      }
    }
    return mapped;
  }
  const format4 = find(4, FORMAT_4);
  if (format4 === undefined) {
    return fail("must have a Unicode cmap subtable in format 4 or 12");
  }
  const endOfSubtable = subtableEnd(format4, 4);
  const segX2 = u16(format4 + 6);
  if (segX2 % 2) {
    fail("format 4 segment count must be even");
  }
  const ends = format4 + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  const glyphIds = rangeOffsets + segX2;
  if (glyphIds > endOfSubtable) {
    fail("format 4 segment arrays must end within the subtable");
  }
  for (let s = 0; s < segX2; s += 2) {
    const [start, end, delta] = [u16(starts + s), u16(ends + s), u16(deltas + s)];
    const rangeOffset = u16(rangeOffsets + s);
    if (start > end) {
      fail("format 4 segments must start at or before their end");
    }
    // 0xFFFF is a noncharacter that only terminates the segment list.
    const last = Math.min(end, 0xfffe);
    const glyphOffset = rangeOffsets + s + rangeOffset;
    if (
      rangeOffset &&
      start <= last &&
      (glyphOffset < glyphIds || glyphOffset + 2 * (last - start + 1) > endOfSubtable)
    ) {
      fail("format 4 glyph indices must fit within the subtable glyph array");
    }
    for (let c = start; c <= last; c++) {
      let glyph = (c + delta) & 0xffff;
      if (rangeOffset) {
        const index = u16(glyphOffset + 2 * (c - start));
        glyph = index === 0 ? 0 : (index + delta) & 0xffff;
      }
      if (glyph !== 0) {
        mapped.add(c);
      }
    }
  }
  return mapped;
}

/**
 * Throws RangeError naming label and every code point coverage lacks, in the given order, as
 * `U+XXXX "c"`.
 */
export function checkCovered(
  label: string,
  coverage: ReadonlySet<number>,
  codePoints: readonly number[],
): void {
  const missing = codePoints.filter((codePoint) => !coverage.has(codePoint));
  if (missing.length) {
    const list = missing.map(
      (codePoint) =>
        `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(String.fromCodePoint(codePoint))}`,
    );
    throw new RangeError(`${label} must have a glyph for ${list.join(", ")}`);
  }
}
