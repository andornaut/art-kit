import assert from "node:assert/strict";
import test from "node:test";

import { oklchToSrgb, srgbToOklab, srgbToOklch } from "@andornaut/art-kit/colour";
test("reference vectors, byte roundtrips and neutral hue", () => {
  for (const [rgb, expected] of [
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
    [
      [255, 255, 255],
      [1, 0, 0],
    ],
    [
      [255, 0, 0],
      [0.62795536, 0.22486306, 0.1258463],
    ],
  ]) {
    srgbToOklab(rgb).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
  }
  for (const rgb of [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [12, 90, 184],
    [128, 128, 128],
  ]) {
    assert.deepEqual(oklchToSrgb(srgbToOklch(rgb)), rgb);
  }
  assert.deepEqual(srgbToOklch([128, 128, 128]).slice(1), [0, 0]);
});
test("gamut mapping reduces chroma at fixed lightness and hue", () => {
  const [L, C, h] = srgbToOklch(oklchToSrgb([0.6, 0.9, 40]));
  assert.ok(Math.abs(L - 0.6) < 0.003);
  assert.ok(C < 0.9 && C > 0.1);
  assert.ok(Math.abs(h - 40) < 1);
  assert.deepEqual(oklchToSrgb([0.6, 0.9, -320]), oklchToSrgb([0.6, 0.9, 40]));
  assert.deepEqual(oklchToSrgb([-1, 1, 40]), [0, 0, 0]);
  assert.deepEqual(oklchToSrgb([2, 1, 40]), [255, 255, 255]);
  assert.deepEqual(oklchToSrgb([0.6, -1, 40]), oklchToSrgb([0.6, 0, 0]));
});
test("reject nonfinite triples and invalid bytes", () => {
  for (const fn of [srgbToOklab, srgbToOklch, oklchToSrgb]) {
    for (const value of [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0],
      [true, 0, 0],
    ]) {
      assert.throws(() => fn(value), RangeError);
    }
  }
  for (const value of [
    [-1, 0, 0],
    [256, 0, 0],
    [0.5, 0, 0],
  ]) {
    assert.throws(() => srgbToOklab(value), RangeError);
  }
});
