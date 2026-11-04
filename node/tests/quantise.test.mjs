import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encodeGif } from "@andornaut/art-kit/gif";
import { quantise } from "@andornaut/art-kit/quantise";

const fixtures = process.env.ART_KIT_TEST_FONTS;
assert.ok(fixtures, "Required ART_KIT_TEST_FONTS fixture directory");

// Two 8x6 frames of a gradient, a moving block and a clear border column.
function goldenInput() {
  return [0, 1].map((f) => {
    const width = 8;
    const height = 6;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (x === 0) continue;
        const block = x >= 2 + f * 3 && x < 5 + f * 3 && y >= 2 && y < 4;
        data.set(block ? [240, 40 + f * 20, 30, 255] : [x * 30 + f, y * 40, (x * y * 7) % 256, 255], i);
      }
    }
    return { data, height, width };
  });
}

const distinct = (frames) =>
  new Set(frames.flatMap(({ data }) => Array.from({ length: data.length / 4 }, (_, i) => data.subarray(i * 4, i * 4 + 4).join())));

test("quantise matches the committed golden palette and pixels", () => {
  const golden = JSON.parse(readFileSync(`${fixtures}/quantise-golden.json`, "utf8"));
  const { frames, palette } = quantise({ maxColours: golden.maxColours }, goldenInput());
  assert.deepEqual(palette, golden.palette);
  assert.deepEqual(frames.map(({ data }) => Buffer.from(data).toString("hex")), golden.frames);
});

test("quantise is deterministic and bounds the shared palette", () => {
  for (const maxColours of [2, 5, 16, 40]) {
    const first = quantise({ maxColours }, goldenInput());
    const second = quantise({ maxColours }, goldenInput());
    assert.deepEqual(first, second);
    assert.ok(first.palette.length <= maxColours);
    const entries = new Set(first.palette.map((entry) => entry.join()));
    for (const colour of distinct(first.frames)) assert.ok(entries.has(colour), colour);
  }
});

test("quantise preserves transparent pixels as one entry", () => {
  const input = goldenInput();
  input[1].data.set([9, 9, 9, 0], 4);
  const { frames, palette } = quantise({ maxColours: 4 }, input);
  assert.deepEqual(palette[0], [0, 0, 0, 0]);
  frames.forEach((frame, f) => {
    for (let i = 3; i < frame.data.length; i += 4) assert.equal(frame.data[i] === 0, input[f].data[i] === 0);
  });
  assert.ok(frames[1].data.subarray(4, 8).every((v) => v === 0));
});

test("quantise returns inputs that already fit unchanged", () => {
  const input = goldenInput();
  const count = distinct(input).size;
  const { frames, palette } = quantise({ maxColours: count }, input);
  assert.equal(palette.length, count);
  assert.deepEqual(palette[0], [0, 0, 0, 0]);
  frames.forEach((frame, f) => assert.equal(frame, input[f]));
});

test("quantise rejects partial alpha and invalid limits", () => {
  const input = goldenInput();
  input[0].data[7] = 128;
  assert.throws(() => quantise({ maxColours: 8 }, input), RangeError);
  // One entry is the transparent one, leaving none for opaque colours.
  assert.throws(() => quantise({ maxColours: 1 }, goldenInput()), /no entry for opaque/);
  for (const maxColours of [0, 257, 2.5]) assert.throws(() => quantise({ maxColours }, goldenInput()), RangeError);
});

test("encodeGif accepts quantised frames", () => {
  const { frames } = quantise({ maxColours: 5 }, goldenInput());
  const bytes = encodeGif({ durations: 100, loop: 0, disposal: 2 }, frames);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), "GIF89a");
  assert.equal(bytes.at(-1), 0x3b);
});
