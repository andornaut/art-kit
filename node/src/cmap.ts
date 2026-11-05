import { readFileSync } from "node:fs";

// Unicode cmap subtables by platform and encoding ID, most complete first. Format 12 covers the
// full Unicode range and format 4 the Basic Multilingual Plane.
const FORMAT_12 = ["3.10", "0.4", "0.6"];
const FORMAT_4 = ["3.1", "0.3", "0.4", "0.2", "0.1", "0.0"];
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]); // 1.0, "true", "OTTO"

/**
 * The Unicode code points a TrueType or OpenType file's cmap maps to a glyph other than .notdef,
 * from its format 12 Unicode subtable, else its format 4 one. Font collections, WOFF and other
 * formats are rejected.
 */
export function readCoverage(path: string): Set<number> {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (reason: string): never => {
    throw new RangeError(`${path} is not a supported font: ${reason}`);
  };
  const check = (at: number, length: number, what: string): void => {
    if (at < 0 || at + length > bytes.byteLength) {
      fail(`${what} extends past the end of the file`);
    }
  };
  const u16 = (at: number): number => {
    check(at, 2, "a field");
    return view.getUint16(at);
  };
  const u32 = (at: number): number => {
    check(at, 4, "a field");
    return view.getUint32(at);
  };

  const version = u32(0);
  if (version === 0x74746366) {
    fail("font collections (ttcf) are not supported");
  }
  if (!SFNT_VERSIONS.has(version)) {
    fail("expected a TrueType or OpenType sfnt");
  }
  const tables = u16(4);
  check(12, 16 * tables, "the table directory");
  let cmap = -1;
  let cmapLength = 0;
  for (let record = 12; record < 12 + 16 * tables; record += 16) {
    if (bytes.toString("latin1", record, record + 4) === "cmap") {
      [cmap, cmapLength] = [u32(record + 8), u32(record + 12)];
    }
  }
  if (cmap < 0) {
    fail("no cmap table");
  }
  check(cmap, cmapLength, "the cmap table");
  const subtables = new Map<string, number>();
  const count = u16(cmap + 2);
  for (let record = cmap + 4; record < cmap + 4 + 8 * count; record += 8) {
    const at = cmap + u32(record + 4);
    const id = `${u16(record)}.${u16(record + 2)}`;
    subtables.set(`${id}.${u16(at)}`, at);
  }
  const find = (format: number, ids: readonly string[]): number | undefined =>
    ids.map((id) => subtables.get(`${id}.${format}`)).find((at) => at !== undefined);

  const mapped = new Set<number>();
  const format12 = find(12, FORMAT_12);
  if (format12 !== undefined) {
    const groups = u32(format12 + 12);
    check(format12 + 16, 12 * groups, "a format 12 subtable");
    for (let group = format12 + 16; group < format12 + 16 + 12 * groups; group += 12) {
      const [start, end, glyph] = [u32(group), u32(group + 4), u32(group + 8)];
      if (start > end || end > 0x10ffff) {
        fail(`format 12 group ${start}..${end} is not a Unicode range`);
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
    return fail("no Unicode cmap subtable in format 4 or 12");
  }
  const segX2 = u16(format4 + 6);
  if (segX2 % 2) {
    fail("format 4 segment count is odd");
  }
  const ends = format4 + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  check(ends, 4 * segX2 + 2, "a format 4 subtable");
  for (let s = 0; s < segX2; s += 2) {
    const [start, end, delta] = [u16(starts + s), u16(ends + s), u16(deltas + s)];
    const rangeOffset = u16(rangeOffsets + s);
    if (start > end) {
      fail(`format 4 segment ${start}..${end} is reversed`);
    }
    // 0xFFFF is a noncharacter that only terminates the segment list.
    for (let c = start; c <= Math.min(end, 0xfffe); c++) {
      let glyph = (c + delta) & 0xffff;
      if (rangeOffset) {
        const index = u16(rangeOffsets + s + rangeOffset + 2 * (c - start));
        glyph = index === 0 ? 0 : (index + delta) & 0xffff;
      }
      if (glyph !== 0) {
        mapped.add(c);
      }
    }
  }
  return mapped;
}
