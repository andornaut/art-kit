// Lossless non-SIMD WebP encoding for Node build tools.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import encoderFactory, {
  type WebPModule as WebPEncoder,
} from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";

import type { RgbaImage } from "./rgbaImage.js";

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

// The image as a lossless WebP.
export async function encodeLosslessWebp({ data, height, width }: RgbaImage): Promise<Uint8Array> {
  encoder ??= wasmModule("enc/webp_enc.wasm").then((wasm) =>
    initEmscriptenModule(encoderFactory, wasm),
  );
  const bytes = (await encoder).encode(new Uint8Array(data), width, height, LOSSLESS);
  if (bytes === null) {
    throw new Error(`libwebp could not encode a ${width}x${height} image`);
  }
  return new Uint8Array(bytes);
}
