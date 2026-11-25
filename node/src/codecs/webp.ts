// Non-SIMD WebP encoding and decoding for Node build tools.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import decoderFactory, {
  type WebPModule as WebPDecoder,
} from "@jsquash/webp/codec/dec/webp_dec.js";
import encoderFactory, {
  type WebPModule as WebPEncoder,
} from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";

import type { RgbaImage } from "../raster/rgbaImage.js";

const require = createRequire(import.meta.url);

// Node supplies WebAssembly; its types are independent of browser DOM declarations.
type CompiledWasm = Parameters<typeof initEmscriptenModule>[1];
const wasmHost = globalThis as unknown as {
  readonly WebAssembly: { compile(bytes: Uint8Array): Promise<CompiledWasm> };
};

async function wasmModule(path: string): Promise<CompiledWasm> {
  return wasmHost.WebAssembly.compile(
    await readFile(require.resolve(`@jsquash/webp/codec/${path}`)),
  );
}

let encoder: Promise<WebPEncoder> | undefined;
let decoder: Promise<WebPDecoder> | undefined;

// Lossless with every pixel's colour kept, under clear alpha too, so the file decodes to the
// exact RGBA it was given. Method 6 searches hardest; quality 95 rather than 100 encodes a
// game's atlas pages in about a second rather than about 40, for about 0.5% more bytes.
const LOSSLESS = {
  ...defaultOptions,
  exact: 1,
  lossless: 1,
  method: 6,
  quality: 95,
};

async function encode(
  options: Parameters<WebPEncoder["encode"]>[3],
  { data, height, width }: RgbaImage,
): Promise<Uint8Array> {
  encoder ??= wasmModule("enc/webp_enc.wasm").then((wasm) =>
    initEmscriptenModule(encoderFactory, wasm),
  );
  const bytes = (await encoder).encode(new Uint8Array(data), width, height, options);
  if (bytes === null) {
    throw new Error(`libwebp could not encode a ${width}x${height} image`);
  }
  return new Uint8Array(bytes);
}

// The image as a lossless WebP.
export async function encodeLosslessWebp(image: RgbaImage): Promise<Uint8Array> {
  return encode(LOSSLESS, image);
}

/** Lossy RGB WebP; alphaQuality 100 preserves alpha bytes. RGB, including hidden RGB, can change. */
export async function encodeLossyWebp(
  options: { quality: number; method: number; alphaQuality: number; exact: boolean },
  image: RgbaImage,
): Promise<Uint8Array> {
  if (!Number.isFinite(options?.quality) || options.quality < 0 || options.quality > 100) {
    throw new RangeError("Quality must be finite in 0..100");
  }
  if (!Number.isInteger(options.method) || options.method < 0 || options.method > 6) {
    throw new RangeError("Method must be an integer in 0..6");
  }
  if (
    !Number.isInteger(options.alphaQuality) ||
    options.alphaQuality < 0 ||
    options.alphaQuality > 100
  ) {
    throw new RangeError("Alpha quality must be an integer in 0..100");
  }
  if (typeof options.exact !== "boolean") {
    throw new RangeError("Exact must be a boolean");
  }
  const { data, height, width } = image;
  // libwebp encode.h: WEBP_MAX_DIMENSION is 16383, inclusive.
  if (![width, height].every((v) => Number.isSafeInteger(v) && v > 0 && v <= 16383)) {
    throw new RangeError("Image dimensions must be integers in 1..16383");
  }
  if (!(data instanceof Uint8Array) || data.length !== width * height * 4) {
    throw new RangeError("Image data must contain exactly width * height * 4 RGBA bytes");
  }
  return encode(
    {
      ...defaultOptions,
      alpha_quality: options.alphaQuality,
      exact: options.exact ? 1 : 0,
      lossless: 0,
      method: options.method,
      quality: options.quality,
    },
    image,
  );
}

/**
 * The RGBA image a WebP file decodes to, through the same non-SIMD libwebp build as the encoders,
 * so repeated decodes of the same bytes are identical. Throws RangeError for empty input and Error
 * when libwebp cannot decode the bytes.
 */
export async function decodeWebp(bytes: Uint8Array): Promise<RgbaImage> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new RangeError("Expected nonempty WebP bytes");
  }
  decoder ??= wasmModule("dec/webp_dec.wasm").then((wasm) =>
    initEmscriptenModule(decoderFactory, wasm),
  );
  const image = (await decoder).decode(new Uint8Array(bytes));
  if (image === null) {
    throw new Error("libwebp could not decode the WebP bytes");
  }
  // The decoder returns a view of WASM memory; copy before the next call can reuse it.
  const data = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return { data: data.slice(), height: image.height, width: image.width };
}
