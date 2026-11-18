import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { coverageOf } from "./cmap.js";

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
  if (["DSIG", "CFF ", "CFF2"].some((tag) => tables.has(tag))) {
    throw new RangeError("Signed and CFF fonts are not supported");
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
 * Full static or variable TrueType 1.0 (glyf/loca) to WOFF2, using optional wawoff2 2.0.1.
 * No subsetting, rasterization or public decoder. Signed/DSIG and CFF fonts are rejected.
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

export interface SubsetOptions {
  /** Every string the font renders. Their code points, except C0/C1 controls, are kept. */
  strings: Iterable<string>;
  /** Names the font in the missing-character error. */
  label?: string;
}

interface Subsetter {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_set(input: number, kind: number): number;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

let subsetter: Promise<Subsetter> | undefined;
const HB_MEMORY_MODE_READONLY = 1;
const HB_SUBSET_SETS_NAME_ID = 4;

function loadSubsetter(): Promise<Subsetter> {
  subsetter ??= WebAssembly.instantiate(
    readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")),
  ).then(({ instance }) => instance.exports as unknown as Subsetter);
  return subsetter;
}

/** The subset TrueType bytes for code points, through HarfBuzz hb-subset defaults. */
function subset(hb: Subsetter, codePoints: readonly number[], font: Uint8Array): Uint8Array {
  const data = hb.malloc(font.byteLength);
  let blob = 0,
    face = 0,
    input = 0,
    result = 0,
    output = 0;
  try {
    new Uint8Array(hb.memory.buffer).set(font, data);
    blob = hb.hb_blob_create(data, font.byteLength, HB_MEMORY_MODE_READONLY, 0, 0);
    face = hb.hb_face_create(blob, 0);
    input = hb.hb_subset_input_create_or_fail();
    if (!input) {
      throw new Error("HarfBuzz could not allocate a subset input");
    }
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const codePoint of codePoints) {
      hb.hb_set_add(unicodes, codePoint);
    }
    // Keep the standard name records (0 to 25), including copyright, licence and licence URL.
    const names = hb.hb_subset_input_set(input, HB_SUBSET_SETS_NAME_ID);
    for (let id = 0; id <= 25; id++) {
      hb.hb_set_add(names, id);
    }
    result = hb.hb_subset_or_fail(face, input);
    if (!result) {
      throw new Error("HarfBuzz could not subset the font");
    }
    output = hb.hb_face_reference_blob(result);
    const at = hb.hb_blob_get_data(output, 0),
      length = hb.hb_blob_get_length(output);
    return new Uint8Array(hb.memory.buffer, at, length).slice();
  } finally {
    if (output) {
      hb.hb_blob_destroy(output);
    }
    if (result) {
      hb.hb_face_destroy(result);
    }
    if (input) {
      hb.hb_subset_input_destroy(input);
    }
    if (face) {
      hb.hb_face_destroy(face);
    }
    if (blob) {
      hb.hb_blob_destroy(blob);
    }
    hb.free(data);
  }
}

/**
 * WOFF2 of a TrueType 1.0 (glyf/loca) font reduced to the code points of options.strings, using
 * the optional exact peers harfbuzzjs 1.6.4 (hb-subset) and wawoff2 2.0.1. HarfBuzz keeps the
 * glyphs those characters reach through composites and default GSUB features, their GPOS and kern
 * adjustments, hinting and every variation axis; name records 0 to 25 are kept. C0 and C1
 * controls (such as newline) are ignored. Throws RangeError naming every other character the font's
 * cmap does not map, before subsetting, so a build fails instead of falling back to another font.
 * The input font is not modified.
 */
export async function subsetWoff2(options: SubsetOptions, font: Uint8Array): Promise<Uint8Array> {
  validate(font);
  const label = options.label ?? "Font";
  const wanted = new Set<number>();
  for (const text of options.strings) {
    if (typeof text !== "string") {
      throw new TypeError("Subset strings must be strings");
    }
    for (const char of text) {
      const codePoint = char.codePointAt(0)!;
      if (!(codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0))) {
        wanted.add(codePoint);
      }
    }
  }
  const codePoints = [...wanted].sort((a, b) => a - b);
  const covered = coverageOf(label, font);
  const missing = codePoints.filter((codePoint) => !covered.has(codePoint));
  if (missing.length) {
    const list = missing.map(
      (codePoint) =>
        `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(String.fromCodePoint(codePoint))}`,
    );
    throw new RangeError(`${label} has no glyph for ${list.join(", ")}`);
  }
  return encodeWoff2(subset(await loadSubsetter(), codePoints, font));
}
