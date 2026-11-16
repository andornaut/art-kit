import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { encodeWoff2 } from "@andornaut/art-kit/build/woff2";
import decompress from "wawoff2/decompress.js";

const root = process.env.ART_KIT_TEST_FIXTURES;
const { assertFontSemantics, tables } = await import(`${root}/woff2-semantics.mjs`);
const font = (weight) => readFileSync(`${root}/LiberationSans-${weight}.ttf`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("WOFF2 retains full TrueType tables and every glyph's outlines and hinting deterministically", async () => {
  // Existing SIL OFL fixtures, not MIT helper-code assets; no new font payload is published.
  const regular = font("Regular"),
    bold = font("Bold");
  const before = [Buffer.from(regular), Buffer.from(bold)];
  const encoded = await Promise.all([encodeWoff2(regular), encodeWoff2(bold)]);
  const repeated = await Promise.all([encodeWoff2(regular), encodeWoff2(bold)]);
  // Decode sequentially: the upstream decoder also returns a borrowed WASM-memory view.
  const decodedRegular = new Uint8Array(await decompress(encoded[0]));
  const decodedBold = new Uint8Array(await decompress(encoded[1]));
  for (const [input, output, repeat, decoded, expected] of [
    [
      regular,
      encoded[0],
      repeated[0],
      decodedRegular,
      "117cf9934bc60480a4ca9333d031eb87cd84875323d2f0b3c7d2d7d9c9cb7797",
    ],
    [
      bold,
      encoded[1],
      repeated[1],
      decodedBold,
      "f18fd806e028a3433a505f983f788eb29f92e450e0f4098c720789a0f682791b",
    ],
  ]) {
    assert.equal(Buffer.from(output.subarray(0, 4)).toString("ascii"), "wOF2");
    assert.deepEqual(output, repeat);
    assert.equal(sha256(output), expected, "Pinned wawoff2 2.0.1 output");
    assert.ok(assertFontSemantics(input, decoded) > 0);
  }
  assert.deepEqual([regular, bold], before);
});

test("WOFF2 retains full variable Tiny5 tables, glyphs and licence metadata", async () => {
  const input = readFileSync(`${root}/tiny5/Tiny5.ttf`);
  const before = Buffer.from(input);
  assert.equal(input.length, 433432);
  assert.equal(sha256(input), "588626f2c1b164f55927c0d8123f4bc134651aad7d257da68fc19b0824b0d8fa");
  const original = tables(input);
  for (const tag of ["fvar", "gvar", "HVAR"]) {
    assert.ok(original.get(tag)?.length, `${tag}: nonempty original variation table`);
  }
  assert.equal(original.get("fvar").readUInt16BE(8), 5, "Variable axis count");
  assert.equal(original.get("fvar").readUInt16BE(12), 9, "Named instance count");
  const output = await encodeWoff2(input);
  const repeated = await encodeWoff2(input);
  assert.equal(Buffer.from(output.subarray(0, 4)).toString("ascii"), "wOF2");
  assert.deepEqual(output, repeated);
  assert.equal(output.length, 72928);
  assert.equal(
    sha256(output),
    "a62e647c26d6e411173a5289520b73bb1309122fe859644b730e6ac2fae897cd",
    "Pinned wawoff2 2.0.1 variable output",
  );
  const decoded = new Uint8Array(await decompress(output));
  assert.equal(assertFontSemantics(input, decoded), 1942);
  assert.deepEqual(input, before);
});

test("WOFF2 rejects unsupported or corrupt fonts without poisoning the cached encoder", async () => {
  const valid = font("Regular");
  const dsig = Buffer.from(valid);
  dsig.write("DSIG", 12, "ascii");
  const duplicate = Buffer.from(valid);
  duplicate.copy(duplicate, 28, 12, 16);
  const outside = Buffer.from(valid);
  outside.writeUInt32BE(valid.length + 4, 20);
  const cff = Buffer.from(valid);
  cff.write("OTTO", 0, "ascii");
  const ttc = Buffer.from(valid);
  ttc.write("ttcf", 0, "ascii");
  const cffTables = ["CFF ", "CFF2"].map((tag) => {
    const input = Buffer.from(valid);
    input.write(tag, 12, "ascii");
    return input;
  });
  await Promise.all([
    assert.rejects(encodeWoff2([0, 1, 0, 0]), RangeError),
    ...[
      new Uint8Array(),
      valid.subarray(0, 12),
      dsig,
      duplicate,
      outside,
      cff,
      ttc,
      ...cffTables,
    ].map((input) => assert.rejects(encodeWoff2(input), RangeError)),
  ]);
  const corrupt = Buffer.from(valid);
  for (let i = 12; i < 12 + 16 * corrupt.readUInt16BE(4); i += 16) {
    if (corrupt.toString("ascii", i, i + 4) === "glyf") {
      corrupt.writeInt16BE(32767, corrupt.readUInt32BE(i + 8));
    }
  }
  await assert.rejects(encodeWoff2(corrupt), /ConvertTTFToWOFF2 failed/);
  // Respect byteOffset/byteLength, including on the encoder call after the failed one.
  const padded = new Uint8Array(valid.length + 8);
  padded.set(valid, 4);
  const bytes = await encodeWoff2(padded.subarray(4, 4 + valid.length));
  assert.ok(assertFontSemantics(valid, new Uint8Array(await decompress(bytes))) > 0);
});
