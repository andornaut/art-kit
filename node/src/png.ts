// PNG decoding and encoding for Node build tools.
import { Buffer } from "node:buffer";
import { constants, crc32, createDeflate, type Deflate } from "node:zlib";
import { PNG } from "pngjs";

import type { RgbaImage } from "./rgbaImage.js";

// A PNG's pixels, whatever its colour type, as 8-bit RGBA.
export function decodePng(bytes: Uint8Array): RgbaImage {
  const { data, height, width } = PNG.sync.read(Buffer.from(bytes));
  return { data: new Uint8Array(data), height, width };
}

export interface RgbaPngOptions {
  deflateLevel: number;
  deflateStrategy: number;
  filterType: number;
}

// The encoders write the bytes pngjs 7.0.0 PNG.sync.write writes for the same options: its
// defaults, per-row filter choice, a single IDAT chunk and its zlib settings. They filter one row
// at a time from the caller's pixels into a small batch and deflate each batch as it fills, so
// memory beyond the input is the compressed output plus a bounded working set. Options or images
// outside what that reproduces go through pngjs itself: unknown option keys, filter types pngjs
// rejects, non-integer dimensions, too few pixels and deflate level 0, whose stored blocks are
// sized by how much input each zlib call receives.

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const COLOUR_TYPE_RGB = 2;
const COLOUR_TYPE_RGBA = 6;
const BIT_DEPTH = 8;
// pngjs defaults and its zlib output chunk size.
const DEFAULT_DEFLATE_LEVEL = 9;
const DEFAULT_DEFLATE_STRATEGY = 3;
const DEFLATE_CHUNK_SIZE = 32 * 1024;
const STORED = 0;
const ADAPTIVE = -1;
const FILTER_TYPES = [0, 1, 2, 3, 4] as const;
const OPTION_KEYS = new Set(["deflateLevel", "deflateStrategy", "filterType"]);
// Filtered bytes handed to zlib per call, or one row when a row is longer.
const BATCH_BYTES = 64 * 1024;

export function encodeRgbaPng(
  options: RgbaPngOptions,
  image: RgbaImage,
): Uint8Array {
  return (
    streamedPng(COLOUR_TYPE_RGBA, options, image) ??
    pngjsPng({ colorType: COLOUR_TYPE_RGBA, ...options }, image)
  );
}

// Opaque RGB PNG (colour type 2) bytes; decoding them yields image. Throws RangeError when any
// pixel's alpha is not 255, because colour type 2 has no alpha channel.
export function encodeRgbPng(
  options: RgbaPngOptions,
  image: RgbaImage,
): Uint8Array {
  const { data } = image;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      throw new RangeError(`Pixel ${(i - 3) / 4} has alpha ${data[i]}, not 255`);
    }
  }
  return (
    streamedPng(COLOUR_TYPE_RGB, options, image) ??
    pngjsPng({ colorType: COLOUR_TYPE_RGB, inputHasAlpha: true, ...options }, image)
  );
}

function pngjsPng(options: object, image: RgbaImage): Uint8Array {
  const { data, height, width } = image;
  const png = new PNG({ height, width });
  png.data = Buffer.from(data);
  return PNG.sync.write(png, options);
}

// The filter types pngjs tries on each row, or undefined when it would reject filterType.
function filterTypesOf(options: RgbaPngOptions): readonly number[] | undefined {
  if (!Object.keys(options).includes("filterType")) {
    return FILTER_TYPES;
  }
  const { filterType } = options;
  if (filterType === ADAPTIVE) {
    return FILTER_TYPES;
  }
  return FILTER_TYPES.find((type) => type === filterType) === undefined
    ? undefined
    : [filterType];
}

function isDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && (value | 0) === value;
}

// The PNG bytes, or undefined when pngjs must encode it.
function streamedPng(
  colourType: number,
  options: RgbaPngOptions,
  image: RgbaImage,
): Uint8Array | undefined {
  const { data, height, width } = image;
  const filterTypes = filterTypesOf(options);
  const level = options.deflateLevel ?? DEFAULT_DEFLATE_LEVEL;
  if (
    filterTypes === undefined ||
    level === STORED ||
    !Object.keys(options).every((key) => OPTION_KEYS.has(key)) ||
    !isDimension(width) ||
    !isDimension(height) ||
    data.length < width * height * 4
  ) {
    return undefined;
  }
  const deflater = SyncDeflater.open({
    chunkSize: DEFLATE_CHUNK_SIZE,
    level,
    strategy: options.deflateStrategy ?? DEFAULT_DEFLATE_STRATEGY,
  });
  if (deflater === undefined) {
    return undefined;
  }
  try {
    deflateRows(deflater, colourType, filterTypes, image);
    return assemble(colourType, deflater, image);
  } finally {
    deflater.close();
  }
}

function deflateRows(
  deflater: SyncDeflater,
  colourType: number,
  filterTypes: readonly number[],
  image: RgbaImage,
): void {
  const { data, height, width } = image;
  const bpp = colourType === COLOUR_TYPE_RGB ? 3 : 4;
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const batch = new Uint8Array(Math.max(1, Math.floor(BATCH_BYTES / stride)) * stride);
  // The row above the first reads as zeros.
  let previous: Uint8Array = new Uint8Array(rowBytes);
  let packed: Uint8Array = new Uint8Array(colourType === COLOUR_TYPE_RGB ? rowBytes : 0);
  let used = 0;
  for (let y = 0; y < height; y++) {
    const start = y * width * 4;
    let row: Uint8Array;
    if (colourType === COLOUR_TYPE_RGB) {
      for (let x = 0, from = start; x < rowBytes; x += 3, from += 4) {
        packed[x] = data[from];
        packed[x + 1] = data[from + 1];
        packed[x + 2] = data[from + 2];
      }
      row = packed;
    } else {
      row = data.subarray(start, start + rowBytes);
    }
    filterRow(filterTypes, bpp, previous, row, batch, used);
    used += stride;
    if (used + stride > batch.length || y === height - 1) {
      deflater.write(constants.Z_NO_FLUSH, batch.subarray(0, used));
      used = 0;
    }
    if (colourType === COLOUR_TYPE_RGB) {
      [previous, packed] = [packed, previous];
    } else {
      previous = row;
    }
  }
  deflater.write(constants.Z_FINISH, new Uint8Array(0));
}

// Writes the filter type byte then the filtered row at out[at], choosing the type with the lowest
// sum of absolute filtered differences and the earliest type on a tie.
function filterRow(
  filterTypes: readonly number[],
  bpp: number,
  previous: Uint8Array,
  row: Uint8Array,
  out: Uint8Array,
  at: number,
): void {
  let selected = filterTypes[0];
  if (filterTypes.length > 1) {
    let min = Infinity;
    for (const type of filterTypes) {
      const sum = filterSum(type, bpp, previous, row);
      if (sum < min) {
        selected = type;
        min = sum;
      }
    }
  }
  out[at] = selected;
  for (let x = 0; x < row.length; x++) {
    out[at + 1 + x] = row[x] - predict(selected, bpp, previous, row, x);
  }
}

function filterSum(
  type: number,
  bpp: number,
  previous: Uint8Array,
  row: Uint8Array,
): number {
  let sum = 0;
  for (let x = 0; x < row.length; x++) {
    sum += Math.abs(row[x] - predict(type, bpp, previous, row, x));
  }
  return sum;
}

function predict(
  type: number,
  bpp: number,
  previous: Uint8Array,
  row: Uint8Array,
  x: number,
): number {
  switch (type) {
    case 1:
      return x >= bpp ? row[x - bpp] : 0;
    case 2:
      return previous[x];
    case 3:
      return ((x >= bpp ? row[x - bpp] : 0) + previous[x]) >> 1;
    case 4: {
      const left = x >= bpp ? row[x - bpp] : 0;
      const above = previous[x];
      const upLeft = x >= bpp ? previous[x - bpp] : 0;
      const paeth = left + above - upLeft;
      const pLeft = Math.abs(paeth - left);
      const pAbove = Math.abs(paeth - above);
      const pUpLeft = Math.abs(paeth - upLeft);
      if (pLeft <= pAbove && pLeft <= pUpLeft) {
        return left;
      }
      return pAbove <= pUpLeft ? above : upLeft;
    }
    default:
      return 0;
  }
}

// Signature, IHDR, one IDAT holding the whole zlib stream, then IEND.
function assemble(
  colourType: number,
  deflater: SyncDeflater,
  image: RgbaImage,
): Uint8Array {
  const out = Buffer.allocUnsafe(SIGNATURE.length + 25 + 12 + deflater.length + 12);
  out.set(SIGNATURE, 0);
  let at = SIGNATURE.length;
  const header = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, BIT_DEPTH, colourType, 0, 0, 0);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  at = writeChunk(out, at, "IHDR", [header]);
  at = writeChunk(out, at, "IDAT", deflater.pieces);
  writeChunk(out, at, "IEND", []);
  return out;
}

// Writes a chunk holding pieces in order at out[at] and returns the offset after it.
function writeChunk(
  out: Buffer,
  at: number,
  type: string,
  pieces: readonly Uint8Array[],
): number {
  let end = at + 8;
  for (const piece of pieces) {
    out.set(piece, end);
    end += piece.length;
  }
  out.writeUInt32BE(end - at - 8, at);
  out.write(type, at + 4, "latin1");
  out.writeUInt32BE(crc32(out.subarray(at + 4, end)), end);
  return end + 4;
}

interface ZlibHandle {
  writeSync(
    flush: number,
    input: Uint8Array,
    inputOffset: number,
    inputLength: number,
    output: Uint8Array,
    outputOffset: number,
    outputLength: number,
  ): void;
}

// The engine fields node:zlib's own one-shot deflateSync drives: the native handle and the
// [availOut, availIn] state it reports after each call.
interface DeflateEngine {
  _handle?: ZlibHandle | null;
  _writeState?: Uint32Array;
}

// Incremental synchronous deflate. It makes the same native calls as deflateSync with the same
// output buffering, but keeps the stream open between inputs. Its output is the concatenation of
// pieces.
class SyncDeflater {
  readonly pieces: Uint8Array[] = [];
  length = 0;
  private readonly engine: Deflate;
  private readonly handle: ZlibHandle;
  private readonly state: Uint32Array;
  private readonly chunkSize: number;
  private buffer: Buffer;
  private offset = 0;

  private constructor(
    engine: Deflate,
    handle: ZlibHandle,
    state: Uint32Array,
    chunkSize: number,
  ) {
    this.engine = engine;
    this.handle = handle;
    this.state = state;
    this.chunkSize = chunkSize;
    this.buffer = Buffer.allocUnsafe(chunkSize);
  }

  // The deflater, or undefined when this Node's zlib engine lacks the native fields it drives.
  static open(options: {
    chunkSize: number;
    level: number;
    strategy: number;
  }): SyncDeflater | undefined {
    const engine = createDeflate(options);
    // Errors also reach engine.errored synchronously; this listener keeps the later event quiet.
    engine.on("error", () => {});
    const { _handle: handle, _writeState: state } = engine as unknown as DeflateEngine;
    if (typeof handle?.writeSync !== "function" || !(state instanceof Uint32Array)) {
      engine.close();
      return undefined;
    }
    return new SyncDeflater(engine, handle, state, options.chunkSize);
  }

  write(flush: number, input: Uint8Array): void {
    let inputOffset = 0;
    let inputLength = input.length;
    for (;;) {
      const outputLength = this.chunkSize - this.offset;
      this.handle.writeSync(
        flush,
        input,
        inputOffset,
        inputLength,
        this.buffer,
        this.offset,
        outputLength,
      );
      if (this.engine.errored) {
        throw this.engine.errored;
      }
      const [availOut, availIn] = this.state;
      const have = outputLength - availOut;
      if (have > 0) {
        this.pieces.push(this.buffer.subarray(this.offset, this.offset + have));
        this.offset += have;
        this.length += have;
      }
      if (availOut !== 0) {
        return;
      }
      this.buffer = Buffer.allocUnsafe(this.chunkSize);
      this.offset = 0;
      inputOffset += inputLength - availIn;
      inputLength = availIn;
    }
  }

  close(): void {
    this.engine.close();
  }
}
