import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

import { decodePng } from "@andornaut/art-kit/png";
import { encodeLosslessWebp } from "@andornaut/art-kit/webp";
import decoderFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";
import { PNG } from "pngjs";

// The pinned peer's own decoder checks that encoding is lossless.
async function decodeWebp(bytes) {
  const wasm = await WebAssembly.compile(
    await readFile(createRequire(import.meta.url).resolve("@jsquash/webp/codec/dec/webp_dec.wasm")),
  );
  const { data, height, width } = (await initEmscriptenModule(decoderFactory, wasm)).decode(bytes);
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

test("PNG colour types 2 and 6 decode to RGBA", () => {
  for (const [name, colorType, alphas] of [
    ["RGB", 2, [255, 255]],
    ["RGBA", 6, [0, 128]],
  ]) {
    const image = new PNG({ width: 2, height: 1 });
    const data = Uint8Array.from([1, 2, 3, alphas[0], 250, 251, 252, alphas[1]]);
    image.data.set(data);
    assert.deepEqual(
      decodePng(PNG.sync.write(image, { colorType })),
      { width: 2, height: 1, data },
      name,
    );
  }
});

test("non-SIMD lossless WebP preserves transparent RGB and pinned encoder bytes", async () => {
  const image = {
    width: 2,
    height: 1,
    data: Uint8Array.from([1, 2, 3, 0, 250, 251, 252, 128]),
  };
  const bytes = await encodeLosslessWebp(image);
  // Fixed output from the b32a507 encoder with @jsquash/webp 1.5.0.
  assert.equal(
    Buffer.from(bytes).toString("hex"),
    "5249464628000000574542505650384c1b0000002f010000100f7081fccd2793b6693bff82f70d60303f2a10d1ff0000",
  );
  assert.deepEqual(await decodeWebp(bytes), image);
  assert.deepEqual(await encodeLosslessWebp(image), bytes);
});
