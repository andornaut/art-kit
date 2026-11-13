import assert from "node:assert/strict";
import test from "node:test";

import { oklabToSrgb, oklchToSrgb } from "@andornaut/art-kit/colour";

// Synthetic vectors frozen with Ada the Navigator e0673c7eb3c0dddf64eeca081fd9d982bd333a91,
// art/tools/oklab.ts blob e591b615d25be3ac5bd2ae2e6e226eff088c8f99 (clip/half-even).
// Reject/half-up follows Archie 54c911ea80627f95c9c568f68ec25f5c227334a4,
// art/tools/pixel.ts pickerEncode/pickerHeader. No game palette values are used.
test("inverse Oklab clips linear channels or rejects without gamut relaxation", () => {
  for (const rounding of ["half-even", "half-up"]) {
    for (const [colour, expected] of [
      [
        [0.5, 0.5, -0.5],
        [229, 0, 255],
      ],
      [
        [-1e-10, 0, 0],
        [0, 0, 0],
      ],
      [
        [1.0000000000000002, 0, 0],
        [255, 255, 255],
      ],
    ]) {
      assert.deepEqual(oklabToSrgb({ gamut: "clip", rounding }, colour), expected);
      assert.throws(() => oklabToSrgb({ gamut: "reject", rounding }, colour), RangeError);
    }
  }
});

test("inverse Oklab rounds exact half-byte ties to even or upward", () => {
  for (const gamut of ["clip", "reject"]) {
    // Encoded channels: [2.4999999999999996, 2.5, 2.5]. The first is not a tie.
    const colour = Object.freeze([0.0912106963828446, 0, 0]);
    assert.deepEqual(oklabToSrgb({ gamut, rounding: "half-even" }, colour), [2, 2, 2]);
    assert.deepEqual(oklabToSrgb({ gamut, rounding: "half-up" }, colour), [2, 3, 3]);
    // Encoded channels: [8.5, 8.500000000000002, 8.5]. No fuzzy tie tolerance.
    assert.deepEqual(
      oklabToSrgb({ gamut, rounding: "half-even" }, [0.13715303126697606, 0, 0]),
      [8, 9, 8],
    );
    assert.deepEqual(
      oklabToSrgb({ gamut, rounding: "half-up" }, [0.13715303126697606, 0, 0]),
      [9, 9, 9],
    );
  }
});

test("inverse Oklab uses both sRGB transfer branches and agrees away from ties", () => {
  for (const gamut of ["clip", "reject"]) {
    for (const rounding of ["half-even", "half-up"]) {
      for (const [colour, expected] of [
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        [
          [1, 0, 0],
          [255, 255, 255],
        ],
        [
          [0.42, 0.03, -0.04],
          [84, 70, 99],
        ],
        // Linear channels below 0.0031308: the power branch would give [9, 9, 9].
        [
          [0.14233344807105414, 0, 0],
          [10, 10, 10],
        ],
        // Linear channels above 0.0031308: the linear branch would give [11, 11, 11].
        [
          [0.14717, 0, 0],
          [10, 10, 10],
        ],
      ]) {
        assert.deepEqual(oklabToSrgb({ gamut, rounding }, colour), expected);
      }
    }
  }
});

test("inverse Oklab validates required policies, triples and finite conversion results", () => {
  for (const options of [
    undefined,
    null,
    {},
    { gamut: "clip" },
    { rounding: "half-up" },
    { gamut: "map", rounding: "half-up" },
    { gamut: "clip", rounding: "nearest" },
  ]) {
    assert.throws(() => oklabToSrgb(options, [0.5, 0, 0]), RangeError);
  }
  for (const gamut of ["clip", "reject"]) {
    for (const colour of [
      null,
      undefined,
      [],
      [0, 0],
      [0, 0, 0, 0],
      Array(3),
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0, -Infinity],
      [true, 0, 0],
      ["0", 0, 0],
      [Number.MAX_VALUE, 0, 0],
      [0, Number.MAX_VALUE, 0],
    ]) {
      assert.throws(() => oklabToSrgb({ gamut, rounding: "half-up" }, colour), RangeError);
    }
  }
});

test("inverse Oklab leaves existing OKLCH chroma reduction unchanged", () => {
  assert.deepEqual(oklchToSrgb([0.6, 0.9, 40]), [216, 75, 0]);
  assert.deepEqual(oklchToSrgb([0.6, 0.9, -320]), [216, 75, 0]);
  assert.deepEqual(oklchToSrgb([-1, 1, 40]), [0, 0, 0]);
  assert.deepEqual(oklchToSrgb([2, 1, 40]), [255, 255, 255]);
});
