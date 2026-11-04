import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeIndexedPng } from "@andornaut/art-kit/indexedPng";
import { decodePng, encodeRgbPng, encodeRgbaPng } from "@andornaut/art-kit/png";
import { blankImage, opaqueRect } from "@andornaut/art-kit/rgbaImage";

const indexedOptions = { level: 9, memLevel: 9 };
const rgbaOptions = { deflateLevel: 9, deflateStrategy: 0, filterType: 0 };
const image = {
  width: 3,
  height: 2,
  data: Uint8Array.from([
    7, 8, 9, 0, 10, 20, 30, 128, 40, 50, 60, 255, 40, 50, 60, 255, 10, 20, 30, 128, 1, 2, 3, 0,
  ]),
};
// An 8-bit indexed PNG holds at most 256 palette entries; IHDR byte 25 is its colour type.
const MAX_PALETTE = 256;
const COLOUR_TYPE_INDEXED = 3;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("opaque bounds respect the window and include partial alpha", () => {
  const pixels = blankImage(5, 4);
  pixels.data[3] = 255;
  pixels.data[(1 * 5 + 2) * 4 + 3] = 1;
  pixels.data[(2 * 5 + 3) * 4 + 3] = 128;
  assert.deepEqual(opaqueRect({ x: 1, y: 1, width: 3, height: 2 }, pixels), {
    x: 2,
    y: 1,
    width: 2,
    height: 2,
  });
  assert.equal(opaqueRect({ x: 0, y: 3, width: 5, height: 1 }, pixels), undefined);
});

test("indexed encoding accepts 256 distinct RGBA colours and declines 257", () => {
  const pixels = blankImage(MAX_PALETTE + 1, 1);
  for (let i = 0; i <= MAX_PALETTE; i++) {
    pixels.data.set([i & 255, i >>> 8, 7, 255], i * 4);
  }
  const accepted = {
    width: MAX_PALETTE,
    height: 1,
    data: pixels.data.subarray(0, MAX_PALETTE * 4),
  };
  const bytes = encodeIndexedPng(indexedOptions, accepted);
  assert.equal(bytes[25], COLOUR_TYPE_INDEXED);
  assert.deepEqual(decodePng(bytes), accepted);
  assert.equal(encodeIndexedPng(indexedOptions, pixels), undefined);
});

test("indexed and RGBA PNG preserve transparent RGB, alpha and pinned explicit compression bytes", () => {
  for (const [name, encode, sha256] of [
    [
      "indexed",
      () => encodeIndexedPng(indexedOptions, image),
      "0cdb21fb95284f8589a3c7d56ad1e2179ef75aa003db69db37ad1fffa675aaba",
    ],
    [
      "RGBA",
      () => encodeRgbaPng(rgbaOptions, image),
      "7dea245da66c077a0d2cc763057b15c24af98c609bd06a680d57978f0a1a893b",
    ],
  ]) {
    const bytes = encode();
    assert.deepEqual(decodePng(bytes), image, `${name} decode`);
    assert.deepEqual(encode(), bytes, `${name} deterministic`);
    assert.equal(hash(bytes), sha256, `${name} pinned bytes`);
  }
});

const opaque = {
  ...image,
  data: image.data.map((value, i) => (i % 4 === 3 ? 255 : value)),
};
// IHDR data starts at byte 16; colour type follows width, height and bit depth.
const COLOUR_TYPE_OFFSET = 25;

test("RGB PNG writes colour type 2 and decodes to the opaque input", () => {
  const bytes = encodeRgbPng(rgbaOptions, opaque);
  assert.equal(Buffer.from(bytes.subarray(12, 16)).toString("latin1"), "IHDR");
  assert.equal(bytes[COLOUR_TYPE_OFFSET - 1], 8);
  assert.equal(bytes[COLOUR_TYPE_OFFSET], 2);
  assert.deepEqual(decodePng(bytes), opaque);
});

test("RGB PNG rejects any alpha other than 255", () => {
  for (const alpha of [0, 128, 254]) {
    const data = opaque.data.slice();
    data[4 * 4 + 3] = alpha;
    assert.throws(
      () => encodeRgbPng(rgbaOptions, { ...opaque, data }),
      { name: "RangeError", message: `Pixel 4 has alpha ${alpha}, not 255` },
      `alpha ${alpha}`,
    );
  }
});

test("RGB PNG encodes empty dimensions like RGBA PNG", () => {
  for (const [width, height] of [
    [0, 0],
    [0, 2],
    [2, 0],
  ]) {
    const name = `${width}x${height}`;
    const empty = { width, height, data: new Uint8Array(0) };
    const rgb = encodeRgbPng(rgbaOptions, empty);
    const rgba = encodeRgbaPng(rgbaOptions, empty);
    assert.deepEqual(rgb.subarray(16, 24), rgba.subarray(16, 24), `${name} IHDR dimensions`);
    assert.equal(rgb[COLOUR_TYPE_OFFSET], 2, `${name} RGB colour type`);
    assert.equal(rgba[COLOUR_TYPE_OFFSET], 6, `${name} RGBA colour type`);
  }
});
