// Rewrites a TrueType name table and reassembles the SFNT with valid checksums.
import { assembleSfnt, tablesOf } from "./sfnt.js";

export interface FontNames {
  /** Family (ID 1), and typographic family (ID 16) when the font has one. */
  family: string;
  /** Full name (ID 4). */
  fullName: string;
  /** PostScript name (ID 6): printable ASCII without spaces or []{}()<>/%, at most 63 bytes. */
  postScriptName: string;
  /** Unique identifier (ID 3). */
  uniqueId: string;
  /** Version string (ID 5); kept when omitted. */
  version?: string;
  /** Names the new and remaining naming records must not contain, compared case-insensitively. */
  reserved?: readonly string[];
}

interface NameRecord {
  platform: number;
  encoding: number;
  language: number;
  id: number;
  bytes: Uint8Array;
}

// Naming records a renamed subset must not carry over: subfamily (2) and typographic subfamily
// (17) are kept but checked; the rest are rewritten.
const CHECKED = [1, 2, 3, 4, 5, 6, 16, 17];
const POSTSCRIPT = /^[\x21-\x7e]{1,63}$/;
const POSTSCRIPT_FORBIDDEN = /[[\](){}<>/%]/;

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.trim() || /\p{Cc}/u.test(value)) {
    throw new RangeError(`${what} must be a nonempty string without control characters`);
  }
  return value;
}

/** Validated replacement strings by name ID, before any font is read. */
export function nameReplacements(names: FontNames): Map<number, string> {
  const family = text(names.family, "Font family");
  const replacements = new Map<number, string>([
    [1, family],
    [3, text(names.uniqueId, "Font unique ID")],
    [4, text(names.fullName, "Font full name")],
    [6, text(names.postScriptName, "PostScript name")],
    [16, family],
  ]);
  if (names.version !== undefined) {
    replacements.set(5, text(names.version, "Font version"));
  }
  const postScript = replacements.get(6)!;
  if (!POSTSCRIPT.test(postScript) || POSTSCRIPT_FORBIDDEN.test(postScript)) {
    throw new RangeError(`PostScript name ${JSON.stringify(postScript)} is not valid`);
  }
  for (const reserved of names.reserved ?? []) {
    text(reserved, "Reserved name");
  }
  return replacements;
}

const utf16 = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) {
    bytes[2 * i] = value.charCodeAt(i) >> 8;
    bytes[2 * i + 1] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
};

function decode(record: NameRecord): string | undefined {
  if (record.platform === 0 || record.platform === 3) {
    let value = "";
    for (let i = 0; i + 1 < record.bytes.length; i += 2) {
      value += String.fromCharCode((record.bytes[i] << 8) | record.bytes[i + 1]);
    }
    return value;
  }
  if (record.platform === 1 && record.encoding === 0) {
    return String.fromCharCode(...record.bytes);
  }
  return undefined;
}

function encode(record: NameRecord, value: string): Uint8Array {
  if (record.platform === 0 || record.platform === 3) {
    return utf16(value);
  }
  if (record.platform === 1 && record.encoding === 0 && /^[\x20-\x7e]*$/.test(value)) {
    return Uint8Array.from(value, (char) => char.charCodeAt(0));
  }
  throw new RangeError(
    `Cannot write name ID ${record.id} for platform ${record.platform} encoding ${record.encoding}`,
  );
}

/**
 * The font with name IDs 1, 3, 4, 6 and 16 (when present) and optionally 5 replaced in every
 * Unicode, Windows and Mac Roman record. Throws RangeError when a replaced, subfamily (2) or
 * typographic subfamily (17) record contains a reserved name, or a record cannot be encoded.
 */
export function renameFont(
  replacements: ReadonlyMap<number, string>,
  reserved: readonly string[],
  font: Uint8Array,
): Uint8Array {
  const map = tablesOf(font);
  const name = map.get("name");
  if (!name || name.length < 6) {
    throw new RangeError("The font has no name table");
  }
  const view = new DataView(name.buffer, name.byteOffset, name.byteLength);
  const format = view.getUint16(0),
    count = view.getUint16(2),
    storage = view.getUint16(4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 12 * i;
    const offset = storage + view.getUint16(at + 10);
    records.push({
      bytes: name.slice(offset, offset + view.getUint16(at + 8)),
      encoding: view.getUint16(at + 2),
      id: view.getUint16(at + 6),
      language: view.getUint16(at + 4),
      platform: view.getUint16(at),
    });
  }
  const languageTags: Uint8Array[] = [];
  if (format === 1) {
    const tagCount = view.getUint16(6 + 12 * count);
    for (let i = 0; i < tagCount; i++) {
      const at = 8 + 12 * count + 4 * i;
      const offset = storage + view.getUint16(at + 2);
      languageTags.push(name.slice(offset, offset + view.getUint16(at)));
    }
  } else if (format !== 0) {
    throw new RangeError(`Unsupported name table format ${format}`);
  }
  const lower = reserved.map((value) => value.toLowerCase());
  for (const record of records) {
    const replacement = replacements.get(record.id);
    if (replacement !== undefined) {
      record.bytes = encode(record, replacement);
    }
    if (!CHECKED.includes(record.id)) {
      continue;
    }
    const value = (replacement ?? decode(record) ?? "").toLowerCase();
    const hit = lower.find((reservedName) => value.includes(reservedName));
    if (hit !== undefined) {
      throw new RangeError(
        `Name ID ${record.id} contains the reserved name ${JSON.stringify(hit)}`,
      );
    }
  }
  const header = 6 + 12 * count + (format === 1 ? 2 + 4 * languageTags.length : 0);
  const strings = [...records.map(({ bytes }) => bytes), ...languageTags];
  const out = new Uint8Array(header + strings.reduce((sum, bytes) => sum + bytes.length, 0));
  const outView = new DataView(out.buffer);
  outView.setUint16(0, format);
  outView.setUint16(2, count);
  outView.setUint16(4, header);
  let offset = 0;
  const place = (bytes: Uint8Array): number => {
    out.set(bytes, header + offset);
    offset += bytes.length;
    return offset - bytes.length;
  };
  records.forEach((record, i) => {
    const at = 6 + 12 * i;
    outView.setUint16(at, record.platform);
    outView.setUint16(at + 2, record.encoding);
    outView.setUint16(at + 4, record.language);
    outView.setUint16(at + 6, record.id);
    outView.setUint16(at + 8, record.bytes.length);
    outView.setUint16(at + 10, place(record.bytes));
  });
  if (format === 1) {
    outView.setUint16(6 + 12 * count, languageTags.length);
    languageTags.forEach((bytes, i) => {
      const at = 8 + 12 * count + 4 * i;
      outView.setUint16(at, bytes.length);
      outView.setUint16(at + 2, place(bytes));
    });
  }
  map.set("name", out);
  return assembleSfnt(new DataView(font.buffer, font.byteOffset).getUint32(0), map);
}
