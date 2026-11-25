// SFNT (TrueType and OpenType) container structure: the table directory, the TrueType input
// checks the WOFF2 codecs need, and reassembly with valid checksums.

export interface TableRecord {
  tag: string;
  offset: number;
  length: number;
}

/** The table directory's records in file order. The caller checks the directory fits in font. */
export function tableRecords(font: Uint8Array): TableRecord[] {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  return Array.from({ length: view.getUint16(4) }, (_, i) => {
    const at = 12 + 16 * i;
    return {
      length: view.getUint32(at + 12),
      offset: view.getUint32(at + 8),
      tag: String.fromCharCode(...font.subarray(at, at + 4)),
    };
  });
}

/**
 * Throws RangeError unless font is one complete TrueType 1.0 font with glyf/loca outlines: a
 * table directory of distinct, aligned, nonoverlapping in-bounds tables, consistent head, maxp,
 * hhea, hmtx and loca, and no DSIG or CFF table.
 */
export function checkTrueType(font: Uint8Array): void {
  if (!(font instanceof Uint8Array) || font.byteLength < 12) {
    throw new RangeError("Font must be a Uint8Array of at least 12 bytes");
  }
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  if (view.getUint32(0) !== 0x00010000) {
    throw new RangeError("Font must be one TrueType 1.0 font, not CFF, TTC or WOFF");
  }
  const count = view.getUint16(4);
  const directoryEnd = 12 + count * 16;
  if (!count || directoryEnd > font.byteLength) {
    throw new RangeError("Font table directory must be nonempty and complete");
  }
  const tables = new Map<string, { length: number; offset: number }>();
  for (const { length, offset, tag } of tableRecords(font)) {
    if (
      !/^[\x20-\x7e]{4}$/.test(tag) ||
      tables.has(tag) ||
      offset % 4 ||
      offset < directoryEnd ||
      offset + length > font.byteLength
    ) {
      throw new RangeError(
        "Font tables must have unique printable tags and be 4-byte aligned after the directory and within the font",
      );
    }
    tables.set(tag, { length, offset });
  }
  let end = directoryEnd;
  for (const table of [...tables.values()].sort((a, b) => a.offset - b.offset)) {
    if (table.length && table.offset < end) {
      throw new RangeError("Font tables must not overlap");
    }
    end = Math.max(end, table.offset + table.length);
  }
  if (["DSIG", "CFF ", "CFF2"].some((tag) => tables.has(tag))) {
    throw new RangeError("Font must not have a DSIG, CFF or CFF2 table");
  }
  const table = (tag: string, minimum: number) => {
    const entry = tables.get(tag);
    if (!entry || entry.length < minimum) {
      throw new RangeError(`Font must have a complete ${tag} table`);
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
    throw new RangeError("Font head, maxp and hhea tables must be valid and consistent");
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
      throw new RangeError("Font loca offsets must be nondecreasing and within the glyf table");
    }
    previous = offset;
  }
}

/** Each table's bytes by tag; a repeated tag keeps its last record. */
export function tablesOf(font: Uint8Array): Map<string, Uint8Array> {
  const tables = new Map<string, Uint8Array>();
  for (const { length, offset, tag } of tableRecords(font)) {
    tables.set(tag, font.subarray(offset, offset + length));
  }
  return tables;
}

function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + view.getUint32(i)) >>> 0;
  }
  return sum;
}

/**
 * An SFNT holding tables in tag order, 4-byte aligned, with each table's checksum and the head
 * table's checksum adjustment recomputed. tables must include head.
 */
export function assembleSfnt(version: number, tables: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  let size = 12 + 16 * count;
  const offsets = tags.map((tag) => {
    const offset = size;
    size += (tables.get(tag)!.length + 3) & ~3;
    return offset;
  });
  const font = new Uint8Array(size);
  const view = new DataView(font.buffer);
  const selector = Math.floor(Math.log2(count));
  view.setUint32(0, version);
  view.setUint16(4, count);
  view.setUint16(6, 16 * 2 ** selector);
  view.setUint16(8, selector);
  view.setUint16(10, 16 * count - 16 * 2 ** selector);
  let head = -1;
  tags.forEach((tag, i) => {
    const bytes = new Uint8Array(tables.get(tag)!);
    if (tag === "head") {
      new DataView(bytes.buffer).setUint32(8, 0);
      head = offsets[i];
    }
    font.set(bytes, offsets[i]);
    const at = 12 + 16 * i;
    for (let c = 0; c < 4; c++) {
      font[at + c] = tag.charCodeAt(c);
    }
    view.setUint32(at + 4, checksum(bytes));
    view.setUint32(at + 8, offsets[i]);
    view.setUint32(at + 12, bytes.length);
  });
  view.setUint32(head + 8, (0xb1b0afba - checksum(font)) >>> 0);
  return font;
}
