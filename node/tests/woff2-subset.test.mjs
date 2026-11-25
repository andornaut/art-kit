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
      error.message === 'Body must have a glyph for U+65E5 "日", U+672C "本", U+1F642 "🙂"',
  );
  await assert.rejects(subsetWoff2({ strings: [42] }, input), TypeError);
  await assert.rejects(subsetWoff2({ strings: ["a"] }, input.subarray(0, 12)), RangeError);
  const ok = await subsetWoff2({ strings: ["ok\t\n"] }, input);
  assert.deepEqual(
    new Set(fontCoverage(await decodedFile("controls.ttf", ok))),
    new Set([0x6f, 0x6b]),
  );
});

function names(font) {
  const name = tables(font).get("name");
  const result = new Map();
  const storage = name.readUInt16BE(4);
  for (let i = 0; i < name.readUInt16BE(2); i++) {
    const at = 6 + 12 * i;
    const [platform, encoding, id] = [0, 2, 6].map((offset) => name.readUInt16BE(at + offset));
    const offset = storage + name.readUInt16BE(at + 10);
    const bytes = name.subarray(offset, offset + name.readUInt16BE(at + 8));
    const value =
      platform === 1 ? bytes.toString("latin1") : Buffer.from(bytes).swap16().toString("utf16le");
    result.set(`${platform}.${encoding}.${name.readUInt16BE(at + 4)}.${id}`, value);
  }
  return result;
}

const ada = {
  family: "AdaUI",
  fullName: "AdaUI Regular",
  postScriptName: "AdaUI-Regular",
  reserved: ["Liberation"],
  uniqueId: "AdaUI Regular 2026",
};

test("Subset WOFF2 renames family, full, unique and PostScript names and keeps licence records", async () => {
  const input = readFileSync(`${root}/LiberationSans-Regular.ttf`);
  const plain = readFileSync(await decodedFile("plain.ttf", await subsetWoff2({ strings }, input)));
  const output = await subsetWoff2({ names: ada, strings }, input);
  assert.deepEqual(output, await subsetWoff2({ names: ada, strings }, input));
  const renamed = readFileSync(await decodedFile("renamed.ttf", output));
  const [before, after] = [names(plain), names(renamed)];
  assert.deepEqual([...after.keys()], [...before.keys()], "Same naming records");
  const expected = { 1: ada.family, 3: ada.uniqueId, 4: ada.fullName, 6: ada.postScriptName };
  for (const [key, value] of after) {
    const id = Number(key.split(".").at(-1));
    if (id in expected) {
      assert.equal(value, expected[id], key);
    } else {
      assert.equal(value, before.get(key), `${key} unchanged`);
    }
    if ([1, 2, 3, 4, 6, 16, 17].includes(id)) {
      assert.ok(!/liberation/i.test(value), `${key}: ${value}`);
    }
  }
  for (const id of [0, 13, 14]) {
    assert.ok(
      [...after.keys()].some((key) => key.endsWith(`.${id}`)),
      `name ID ${id} kept`,
    );
  }
  assert.deepEqual(new Set(fontCoverage(join(scratch, "renamed.ttf"))), wanted);
  // Valid SFNT checksum adjustment: the whole file sums to 0xB1B0AFBA.
  const padded = Buffer.concat([renamed, Buffer.alloc((4 - (renamed.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + padded.readUInt32BE(i)) >>> 0;
  }
  assert.equal(sum, 0xb1b0afba);
});

test("Subset WOFF2 rejects reserved names and invalid PostScript names before subsetting", async () => {
  const input = readFileSync(`${root}/LiberationSans-Regular.ttf`);
  const rename = (names) => subsetWoff2({ names: { ...ada, ...names }, strings: ["a"] }, input);
  await assert.rejects(rename({ family: "Liberation UI" }), {
    name: "RangeError",
    message: 'Name ID 1 must not contain the reserved name "liberation"',
  });
  await assert.rejects(rename({ reserved: ["regular"] }), {
    name: "RangeError",
    message: 'Name ID 2 must not contain the reserved name "regular"',
  });
  const message =
    "PostScript name must be 1..63 printable ASCII characters other than space and [](){}<>/%";
  const postScript = { name: "RangeError", message };
  await assert.rejects(rename({ postScriptName: "Ada UI" }), postScript);
  await assert.rejects(rename({ postScriptName: "AdaUI(1)" }), postScript);
  await assert.rejects(rename({ fullName: "" }), RangeError);
  await assert.rejects(rename({ reserved: [""] }), RangeError);
});
