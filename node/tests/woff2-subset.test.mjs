import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fontCoverage, rasteriseGlyphs } from "@andornaut/art-kit/build/fonts";
import { encodeWoff2, subsetWoff2 } from "@andornaut/art-kit/build/woff2";
import decompress from "wawoff2/decompress.js";

const root = process.env.ART_KIT_TEST_FIXTURES;
const { tables } = await import(`${root}/woff2-semantics.mjs`);
const scratch = mkdtempSync(join(tmpdir(), "art-kit-subset-"));
const strings = ["Play again", "Settings\nVolume: 80%", "Café, naïve, “quoted”"];
const wanted = new Set(
  [...strings.join("")].map((char) => char.codePointAt(0)).filter((c) => c >= 0x20),
);

// Decode sequentially: the upstream decoder returns a borrowed WASM-memory view.
async function decodedFile(name, woff2) {
  const path = join(scratch, name);
  writeFileSync(path, new Uint8Array(await decompress(woff2)));
  return path;
}

function nameIds(font) {
  const name = tables(font).get("name");
  const ids = new Set();
  for (let i = 0; i < name.readUInt16BE(2); i++) {
    ids.add(name.readUInt16BE(6 + 12 * i + 6));
  }
  return ids;
}

test("Subset WOFF2 maps exactly the strings' characters and renders them as the full font does", async () => {
  const path = `${root}/LiberationSans-Regular.ttf`;
  const input = readFileSync(path);
  const before = Buffer.from(input);
  const output = await subsetWoff2({ label: "LiberationSans-Regular", strings }, input);
  assert.equal(Buffer.from(output.subarray(0, 4)).toString("ascii"), "wOF2");
  assert.deepEqual(output, await subsetWoff2({ strings }, input), "Deterministic output");
  const full = await encodeWoff2(input);
  assert.ok(output.length * 10 < full.length, `${output.length} bytes, full ${full.length}`);
  const subset = await decodedFile("regular.ttf", output);
  assert.deepEqual(new Set(fontCoverage(subset)), wanted);
  for (const id of [0, 1, 2, 13, 14]) {
    if (nameIds(input).has(id)) {
      assert.ok(nameIds(readFileSync(subset)).has(id), `name ID ${id} kept`);
    }
  }
  const characters = [...wanted].map((c) => String.fromCodePoint(c)).join("");
  const render = (font) => rasteriseGlyphs({ characters, kerning: "all", path: font, size: 16 });
  assert.deepEqual(render(subset), render(path), "Glyph pixels, metrics and kerning");
  assert.deepEqual(input, before);
});

test("Subset WOFF2 keeps every variation axis of a variable font", async () => {
  const input = readFileSync(`${root}/tiny5/Tiny5.ttf`);
  const output = await subsetWoff2({ strings: ["START", "Score 0123456789"] }, input);
  assert.ok(output.length < 20000, `${output.length} bytes`);
  const decoded = readFileSync(await decodedFile("tiny5.ttf", output));
  const subset = tables(decoded);
  for (const tag of ["fvar", "gvar", "HVAR"]) {
    assert.ok(subset.get(tag)?.length, `${tag} kept`);
  }
  assert.equal(subset.get("fvar").readUInt16BE(8), 5, "Variable axis count");
  assert.equal(subset.get("fvar").readUInt16BE(12), 9, "Named instance count");
});

test("Subset WOFF2 names every unmapped character and ignores controls", async () => {
  const input = readFileSync(`${root}/LiberationSans-Regular.ttf`);
  await assert.rejects(
    subsetWoff2({ label: "Body", strings: ["ok\t\n", "日本", "🙂"] }, input),
    (error) =>
      error instanceof RangeError &&
      error.message === 'Body has no glyph for U+65E5 "日", U+672C "本", U+1F642 "🙂"',
  );
  await assert.rejects(subsetWoff2({ strings: [42] }, input), TypeError);
  await assert.rejects(subsetWoff2({ strings: ["a"] }, input.subarray(0, 12)), RangeError);
  const ok = await subsetWoff2({ strings: ["ok\t\n"] }, input);
  assert.deepEqual(
    new Set(fontCoverage(await decodedFile("controls.ttf", ok))),
    new Set([0x6f, 0x6b]),
  );
});
