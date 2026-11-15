import assert from "node:assert/strict";
import test from "node:test";

import { compareRgba } from "@andornaut/art-kit/build/compareRgba";

const image = (pixels, width = pixels.length / 4, height = 1) => ({
  width,
  height,
  data: Uint8Array.from(pixels),
});

test("RGBA comparison counts hidden RGB bytes while transparent composites stay equal", () => {
  const expected = image([10, 20, 30, 0]);
  const actual = image([20, 40, 60, 0]);
  const result = compareRgba(
    {
      backgrounds: [
        [0, 0, 0],
        [255, 255, 255],
        [12, 34, 56],
      ],
    },
    expected,
    actual,
  );
  assert.equal(result.kind, "compared");
  assert.deepEqual(result.raw, {
    equal: false,
    differingPixels: 1,
    differingChannels: 3,
    maxAbsoluteError: 30,
    alpha: { differingPixels: 0, maxAbsoluteError: 0 },
  });
  assert.deepEqual(result.composites, [
    { background: [0, 0, 0], rmse: 0, maxAbsoluteError: 0 },
    { background: [255, 255, 255], rmse: 0, maxAbsoluteError: 0 },
    { background: [12, 34, 56], rmse: 0, maxAbsoluteError: 0 },
  ]);
});

test("RGBA comparison reports raw and alpha errors with hand-calculated opaque composites", () => {
  const expected = image([0, 0, 0, 255, 255, 0, 0, 255]);
  const actual = image([3, 6, 9, 255, 255, 0, 0, 170]);
  const result = compareRgba(
    {
      backgrounds: [
        [0, 0, 0],
        [255, 255, 255],
      ],
    },
    expected,
    actual,
  );
  assert.deepEqual(result.raw, {
    equal: false,
    differingPixels: 2,
    differingChannels: 4,
    maxAbsoluteError: 85,
    alpha: { differingPixels: 1, maxAbsoluteError: 85 },
  });
  // First pixel contributes 3²+6²+9²=126 on either background. Second contributes 85²
  // on black, or two 85² terms on white. Divide by six RGB samples, not eight RGBA bytes.
  assert.deepEqual(result.composites, [
    { background: [0, 0, 0], rmse: Math.sqrt(7351 / 6), maxAbsoluteError: 85 },
    { background: [255, 255, 255], rmse: Math.sqrt(14576 / 6), maxAbsoluteError: 85 },
  ]);
});

test("RGBA comparison uses unrounded encoded-domain doubles rather than byte composites", () => {
  const result = compareRgba(
    { backgrounds: [[0, 0, 0]] },
    image([1, 2, 4, 128]),
    image([0, 0, 0, 0]),
  );
  assert.deepEqual(result.composites, [
    {
      background: [0, 0, 0],
      maxAbsoluteError: 512 / 255,
      rmse: Math.sqrt(((128 / 255) ** 2 + (256 / 255) ** 2 + (512 / 255) ** 2) / 3),
    },
  ]);
});

test("RGBA comparison supports explicit raw-only comparison and never mutates or aliases inputs", () => {
  const pixels = image([12, 34, 56, 0, 78, 90, 123, 255]);
  const original = pixels.data.slice();
  const background = Object.freeze([17, 53, 91]);
  const options = Object.freeze({ backgrounds: Object.freeze([background]) });
  Object.freeze(pixels);
  const result = compareRgba(options, pixels, pixels);
  assert.deepEqual(result.raw, {
    equal: true,
    differingPixels: 0,
    differingChannels: 0,
    maxAbsoluteError: 0,
    alpha: { differingPixels: 0, maxAbsoluteError: 0 },
  });
  assert.deepEqual(result.composites, [{ background: [17, 53, 91], rmse: 0, maxAbsoluteError: 0 }]);
  result.composites[0].background[0] = 0;
  assert.deepEqual(background, [17, 53, 91]);
  assert.deepEqual(pixels.data, original);
  assert.deepEqual(compareRgba({ backgrounds: [] }, pixels, pixels), {
    kind: "compared",
    width: 2,
    height: 1,
    raw: result.raw,
    composites: [],
  });
});

test("RGBA comparison dimension mismatch contains no pixel metrics, even with equal storage lengths", () => {
  assert.deepEqual(
    compareRgba(
      { backgrounds: [] },
      image(new Array(8).fill(0), 2, 1),
      image(new Array(8).fill(0), 1, 2),
    ),
    {
      kind: "dimension-mismatch",
      expected: { width: 2, height: 1 },
      actual: { width: 1, height: 2 },
    },
  );
});

test("RGBA comparison validates explicit backgrounds and both image buffers before reporting", () => {
  const valid = image([1, 2, 3, 255]);
  for (const options of [
    undefined,
    {},
    { backgrounds: null },
    { backgrounds: [[256, 0, 0]] },
    { backgrounds: [Array(3)] },
  ]) {
    assert.throws(() => compareRgba(options, valid, valid), RangeError);
  }
  for (const invalid of [
    { ...valid, width: 0 },
    { ...valid, height: 1.5 },
    { ...valid, width: Number.MAX_SAFE_INTEGER, height: 2 },
    { ...valid, data: new Uint8Array(3) },
    { ...valid, data: [1, 2, 3, 255] },
  ]) {
    assert.throws(() => compareRgba({ backgrounds: [] }, invalid, valid), RangeError);
    assert.throws(() => compareRgba({ backgrounds: [] }, valid, invalid), RangeError);
  }
  const mismatch = image(new Array(8).fill(0), 2, 1);
  assert.throws(() => compareRgba({}, mismatch, valid), RangeError);
  assert.throws(
    () => compareRgba({ backgrounds: [] }, mismatch, { ...valid, data: new Uint8Array(3) }),
    RangeError,
  );
});
