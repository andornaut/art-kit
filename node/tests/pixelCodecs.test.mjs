import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  COLOUR_TYPE_INDEXED,
  MAX_PALETTE,
  encodeIndexedPng,
} from "@andornaut/art-kit/indexedPng";
import { decodePng, encodeRgbaPng } from "@andornaut/art-kit/png";
import { blankImage, opaqueRect } from "@andornaut/art-kit/rgbaImage";

const indexedOptions = { level: 9, memLevel: 9 };
const rgbaOptions = { deflateLevel: 9, deflateStrategy: 0, filterType: 0 };
const image = {
  width: 3,
  height: 2,
  data: Uint8Array.from([
    7, 8, 9, 0, 10, 20, 30, 128, 40, 50, 60, 255, 40, 50, 60, 255, 10, 20, 30,
    128, 1, 2, 3, 0,
  ]),
};
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
  assert.equal(
    opaqueRect({ x: 0, y: 3, width: 5, height: 1 }, pixels),
    undefined,
  );
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

test("indexed PNG preserves transparent RGB, alpha and pinned encoded bytes", () => {
  const bytes = encodeIndexedPng(indexedOptions, image);
  assert.deepEqual(decodePng(bytes), image);
  assert.deepEqual(encodeIndexedPng(indexedOptions, image), bytes);
  assert.equal(
    hash(bytes),
    "0cdb21fb95284f8589a3c7d56ad1e2179ef75aa003db69db37ad1fffa675aaba",
  );
});

test("RGBA PNG preserves transparent RGB, alpha and pinned explicit compression bytes", () => {
  const bytes = encodeRgbaPng(rgbaOptions, image);
  assert.deepEqual(decodePng(bytes), image);
  assert.deepEqual(encodeRgbaPng(rgbaOptions, image), bytes);
  assert.equal(
    hash(bytes),
    "7dea245da66c077a0d2cc763057b15c24af98c609bd06a680d57978f0a1a893b",
  );
});
