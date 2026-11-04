// Animated GIF encoding with exact palettes and binary alpha.
import type { RgbaImage } from "./rgbaImage.js";

// 0 leaves disposal unspecified, 1 keeps the frame and 2 restores the background.
export type GifDisposal = 0 | 1 | 2;

export interface GifOptions {
  // Milliseconds, one for every frame or one per frame; stored in hundredths, truncated.
  durations: number | readonly number[];
  // Repetitions after the first play, 0 for forever; omitted writes no loop extension.
  loop?: number;
  disposal?: GifDisposal;
}

const MAX_COLOURS = 256;
const MAX_CODE = 4096;

interface Frame {
  pixels: Uint32Array;
  colours: number[];
  transparent: number | undefined;
  duration: number;
}

function perFrame(durations: number | readonly number[], count: number): number[] {
  const list =
    typeof durations === "number" ? Array<number>(count).fill(durations) : [...durations];
  if (list.length !== count) {
    throw new RangeError(`Expected ${count} durations, received ${list.length}`);
  }
  for (const ms of list) {
    if (!Number.isFinite(ms) || ms < 0 || Math.trunc(ms / 10) > 0xffff) {
      throw new RangeError(`Invalid GIF duration: ${ms}`);
    }
  }
  return list;
}

// Each pixel as RGBA (R in the high byte), its distinct colours in first-use order and the one
// fully transparent value, if any.
function frameOf(index: number, duration: number, image: RgbaImage): Frame {
  const view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const pixels = new Uint32Array(image.width * image.height);
  const seen = new Set<number>();
  let transparent: number | undefined;
  for (let i = 0; i < pixels.length; i++) {
    const rgba = view.getUint32(i * 4);
    const alpha = rgba & 0xff;
    if (alpha !== 0 && alpha !== 0xff) {
      throw new RangeError(`Frame ${index} pixel ${i} has partial alpha ${alpha}`);
    }
    if (alpha === 0) {
      if (transparent !== undefined && transparent !== rgba) {
        throw new RangeError(`Frame ${index} has more than one fully transparent RGBA value`);
      }
      transparent = rgba;
    }
    pixels[i] = rgba;
    seen.add(rgba);
  }
  if (seen.size > MAX_COLOURS) {
    throw new RangeError(`Frame ${index} has more than ${MAX_COLOURS} colours`);
  }
  return { colours: [...seen], duration, pixels, transparent };
}

function samePixels(a: Uint32Array, b: Uint32Array): boolean {
  return a.every((rgba, i) => rgba === b[i]);
}

// Variable-width LZW with clear codes, as GIF image data expects.
function lzw(minCodeSize: number, indices: Uint8Array): Uint8Array {
  const clear = 1 << minCodeSize;
  const out: number[] = [];
  let codeSize = minCodeSize + 1;
  let next = clear + 2;
  let buffer = 0;
  let bits = 0;
  const table = new Map<number, number>();
  const emit = (code: number) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const key = prefix * 256 + indices[i];
    const code = table.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next < MAX_CODE) {
      table.set(key, next++);
      // The decoder adds each entry one code later, so it widens one entry later too.
      if (next > 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
    } else {
      emit(clear);
      table.clear();
      codeSize = minCodeSize + 1;
      next = clear + 2;
    }
    prefix = indices[i];
  }
  emit(prefix);
  emit(clear + 1);
  if (bits > 0) {
    out.push(buffer & 0xff);
  }
  return Uint8Array.from(out);
}

class Writer {
  readonly bytes: number[] = [];
  u8(...values: number[]): void {
    this.bytes.push(...values);
  }
  u16(value: number): void {
    this.bytes.push(value & 0xff, value >>> 8);
  }
  table(colours: readonly number[], bits: number): void {
    for (let i = 0; i < 1 << bits; i++) {
      const rgba = colours[i] ?? 0;
      this.u8(rgba >>> 24, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff);
    }
  }
  subBlocks(data: Uint8Array): void {
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255);
      this.u8(block.length, ...block);
    }
    this.u8(0);
  }
}

// Table size exponent: GIF colour tables hold 2..256 entries.
function tableBits(count: number): number {
  return Math.max(1, Math.ceil(Math.log2(count)));
}

// Encodes every frame whole. Consecutive identical frames merge into one, adding durations, as
// Pillow 13.0.0 merges them. Pillow decodes the result to the input frames with the frame count,
// size, durations, loop and disposal it decodes from its own save of the same frames, and to the
// same pixels whenever its quantizer keeps every colour: always for RGB input of at most 256
// colours, but not for many-colour RGBA input, where this encoder stays exact and Pillow does not.
// Fully transparent pixels use a transparency index; partial alpha, more than one fully
// transparent RGBA value or more than 256 colours in a frame throw RangeError. Frames share a
// global palette when they hold at most 256 colours together, otherwise each has its own.
export function encodeGif(options: GifOptions, frames: readonly RgbaImage[]): Uint8Array {
  const { disposal = 0, loop } = options;
  if (frames.length === 0) {
    throw new RangeError("A GIF needs at least one frame");
  }
  const { height, width } = frames[0];
  if (![width, height].every((side) => Number.isInteger(side) && side >= 1 && side <= 0xffff)) {
    throw new RangeError(`Invalid GIF size ${width}x${height}`);
  }
  if (![0, 1, 2].includes(disposal)) {
    throw new RangeError(`Unsupported GIF disposal: ${disposal}`);
  }
  if (loop !== undefined && !(Number.isInteger(loop) && loop >= 0 && loop <= 0xffff)) {
    throw new RangeError(`Invalid GIF loop: ${loop}`);
  }
  const durations = perFrame(options.durations, frames.length);
  const kept: Frame[] = [];
  frames.forEach((image, index) => {
    if (image.width !== width || image.height !== height) {
      throw new RangeError(
        `Frame ${index} is ${image.width}x${image.height}, not ${width}x${height}`,
      );
    }
    const frame = frameOf(index, durations[index], image);
    const last = kept.at(-1);
    if (last && samePixels(last.pixels, frame.pixels)) {
      last.duration += frame.duration;
      return;
    }
    // Pillow restores an opaque frame's area to its background colour, an index into a palette
    // order this encoder does not reproduce, so a later transparent pixel would differ.
    if (
      last &&
      disposal === 2 &&
      last.transparent === undefined &&
      frame.transparent !== undefined
    ) {
      throw new RangeError(`Frame ${index} is transparent after an opaque frame with disposal 2`);
    }
    kept.push(frame);
  });
  const union = [...new Set(kept.flatMap((frame) => frame.colours))];
  const global = union.length <= MAX_COLOURS ? union : undefined;
  const out = new Writer();
  out.u8(...new TextEncoder().encode("GIF89a"));
  out.u16(width);
  out.u16(height);
  const globalBits = tableBits(global?.length ?? 2);
  out.u8(global ? 0x80 | (globalBits - 1) : 0, 0, 0);
  if (global) {
    out.table(global, globalBits);
  }
  if (loop !== undefined) {
    out.u8(0x21, 0xff, 11, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1);
    out.u16(loop);
    out.u8(0);
  }
  kept.forEach((frame, position) => {
    const colours = global ?? frame.colours;
    const indexOf = new Map(colours.map((rgba, index) => [rgba, index]));
    const transparency =
      frame.transparent === undefined ? undefined : indexOf.get(frame.transparent);
    const hundredths = Math.trunc(frame.duration / 10);
    if (hundredths > 0xffff) {
      throw new RangeError(`Merged GIF duration exceeds the format limit: ${frame.duration}`);
    }
    // Pillow gives a later frame a spare transparency index whenever its palette has room, so
    // its control block, and a decoded duration of 0, appears even without other content.
    const spare = position > 0 && frame.colours.length < MAX_COLOURS;
    if (transparency !== undefined || hundredths !== 0 || disposal !== 0 || spare) {
      out.u8(0x21, 0xf9, 4, (disposal << 2) | Number(transparency !== undefined));
      out.u16(hundredths);
      out.u8(transparency ?? 0, 0);
    }
    out.u8(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    const bits = tableBits(colours.length);
    if (global) {
      out.u8(0);
    } else {
      out.u8(0x80 | (bits - 1));
      out.table(colours, bits);
    }
    const minCodeSize = Math.max(2, bits);
    out.u8(minCodeSize);
    out.subBlocks(
      lzw(
        minCodeSize,
        Uint8Array.from(frame.pixels, (rgba) => indexOf.get(rgba) ?? 0),
      ),
    );
  });
  out.u8(0x3b);
  return Uint8Array.from(out.bytes);
}
