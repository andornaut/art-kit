import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { gaussianBlur, resizeLanczos3 } from "@andornaut/art-kit/raster";

const fixtures = process.env.ART_KIT_TEST_FIXTURES;
assert.ok(fixtures, "Required fixture directory");
const reference = JSON.parse(readFileSync(join(fixtures, "raster", "filters.json"), "utf8"));

for (const c of reference.cases) {
  test(`filter ${c.op}: frozen independent ${c.name}`, () => {
    const input = reference.inputs[c.input];
    const source = Object.freeze({ ...input, data: Uint8Array.from(input.data) });
    const before = source.data.slice();
    const actual =
      c.op === "resizeLanczos3"
        ? resizeLanczos3(c.width, c.height, source)
        : gaussianBlur({ sigma: c.sigma }, source);
    assert.equal(actual.width, c.width ?? input.width);
    assert.equal(actual.height, c.height ?? input.height);
    assert.deepEqual([...actual.data], c.expected);
    assert.deepEqual(source.data, before, "source unchanged, including hidden RGB");
    assert.notEqual(actual, source);
    assert.notEqual(actual.data.buffer, source.data.buffer);
  });
}

test("filter fixtures retain exact independent provenance and rounded-zero colour probe", () => {
  assert.equal(reference.provenance.revision, "e0673c7eb3c0dddf64eeca081fd9d982bd333a91");
  assert.equal(reference.provenance.blob, "36fe6e77b036cfb7d67c12b91f8350a4a151eb9f");
  const faint = reference.cases.find(({ name }) => name === "positive-alpha-rounds-zero");
  assert.ok(
    faint.expected.some(
      (v, i, data) => i % 4 === 3 && v === 0 && data.slice(i - 3, i).some((rgb) => rgb > 0),
    ),
  );
});

test("filter validation rejects invalid shapes, resize dimensions and sigma options", () => {
  const source = { width: 1, height: 1, data: Uint8Array.from([11, 71, 193, 254]) };
  const before = source.data.slice();
  for (const value of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resizeLanczos3(value, 1, source), RangeError);
    assert.throws(() => resizeLanczos3(1, value, source), RangeError);
  }
  for (const sigma of [0, -1, NaN, Infinity, -Infinity, undefined, "1"]) {
    assert.throws(() => gaussianBlur({ sigma }, source), RangeError);
  }
  assert.throws(() => gaussianBlur({}, source), RangeError);
  for (const bad of [
    { ...source, width: -1 },
    { ...source, height: 0.5 },
    { ...source, width: Infinity },
    { ...source, data: new Uint8Array(3) },
    { ...source, data: new Uint8Array(5) },
  ]) {
    assert.throws(() => resizeLanczos3(2, 2, bad), RangeError);
    assert.throws(() => gaussianBlur({ sigma: 0.5 }, bad), RangeError);
  }
  assert.throws(
    () => resizeLanczos3(1, 1, { width: 0, height: 1, data: new Uint8Array() }),
    RangeError,
  );
  assert.deepEqual(source.data, before);
});

test("filter positive subnormal sigma retains the discrete kernel centre", () => {
  const source = { width: 2, height: 1, data: Uint8Array.from([13, 71, 193, 0, 231, 17, 89, 1]) };
  assert.deepEqual(gaussianBlur({ sigma: Number.MIN_VALUE }, source), source);
});
