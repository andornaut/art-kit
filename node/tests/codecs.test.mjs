import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

import { decodePng } from "@andornaut/art-kit/build/png";
import { encodeLosslessWebp, encodeLossyWebp } from "@andornaut/art-kit/build/webp";
import decoderFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import encoderFactory from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";
import { PNG } from "pngjs";

test("lossy WebP rejects invalid required options and RGBA before initializing WASM", async (t) => {
  let compilations = 0;
  t.mock.method(WebAssembly, "compile", () => {
    compilations++;
    throw new Error("Invalid input must not initialize WASM");
  });
  const options = { quality: 72.5, method: 6, alphaQuality: 100, exact: true };
  const image = { width: 1, height: 1, data: new Uint8Array(4) };
  const rejections = [];
  for (const key of Object.keys(options)) {
    const omitted = { ...options };
    delete omitted[key];
    rejections.push(assert.rejects(encodeLossyWebp(omitted, image), RangeError));
  }
  for (const changes of [
    { quality: NaN },
    { quality: 101 },
    { quality: -1 },
    { method: 0.5 },
    { method: 7 },
    { alphaQuality: 1.5 },
    { alphaQuality: -1 },
    { alphaQuality: 101 },
    { exact: 1 },
  ]) {
    rejections.push(assert.rejects(encodeLossyWebp({ ...options, ...changes }, image), RangeError));
  }
  for (const changes of [
    { width: 0 },
    { height: 1.5 },
    { width: 16384 },
    { height: Number.MAX_SAFE_INTEGER + 1 },
    { data: new Uint8Array(3) },
    { data: [0, 0, 0, 0] },
  ]) {
    rejections.push(assert.rejects(encodeLossyWebp(options, { ...image, ...changes }), RangeError));
  }
  await Promise.all(rejections);
  assert.equal(compilations, 0);
});

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

test("lossy WebP matches direct pinned codec settings, repeats bytes and preserves alpha at 100", async () => {
  const width = 32,
    height = 24;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(
        [
          Math.floor((x * 255) / (width - 1)),
          Math.floor((y * 255) / (height - 1)),
          (x * 17 + y * 29) % 256,
          y === 0 && x < 5 ? [0, 1, 127, 254, 255][x] : (x * 13 + y * 7) % 256,
        ],
        (y * width + x) * 4,
      );
    }
  }
  const image = Object.freeze({ width, height, data });
  const before = data.slice();
  const wasm = await WebAssembly.compile(
    await readFile(createRequire(import.meta.url).resolve("@jsquash/webp/codec/enc/webp_enc.wasm")),
  );
  const oracle = await initEmscriptenModule(encoderFactory, wasm);
  const high = Object.freeze({ quality: 72.5, method: 6, alphaQuality: 100, exact: true });
  const low = Object.freeze({ quality: 24, method: 0, alphaQuality: 37, exact: false });
  // Independent calls to the pinned non-SIMD codec, with literal raw codec settings.
  const expectedHigh = new Uint8Array(
    oracle.encode(data.slice(), width, height, {
      ...defaultOptions,
      lossless: 0,
      quality: 72.5,
      method: 6,
      alpha_quality: 100,
      exact: 1,
    }),
  );
  const expectedLow = new Uint8Array(
    oracle.encode(data.slice(), width, height, {
      ...defaultOptions,
      lossless: 0,
      quality: 24,
      method: 0,
      alpha_quality: 37,
      exact: 0,
    }),
  );
  const bytes = await encodeLossyWebp(high, image);
  assert.deepEqual(bytes, expectedHigh);
  assert.deepEqual(await encodeLossyWebp(high, image), bytes);
  const lowBytes = await encodeLossyWebp(low, image);
  assert.deepEqual(lowBytes, expectedLow);
  assert.notDeepEqual(lowBytes, bytes);
  const decoded = await decodeWebp(bytes);
  assert.deepEqual([decoded.width, decoded.height], [width, height]);
  const alpha = (pixels) => pixels.filter((_, i) => i % 4 === 3);
  assert.deepEqual(alpha(decoded.data), alpha(data));
  const opaqueRgb = (pixels) =>
    pixels.filter((_, i) => i % 4 !== 3 && data[i - (i % 4) + 3] === 255);
  assert.notDeepEqual(opaqueRgb(decoded.data), opaqueRgb(data));
  assert.notDeepEqual(alpha((await decodeWebp(lowBytes)).data), alpha(data));
  assert.deepEqual(data, before);
});
