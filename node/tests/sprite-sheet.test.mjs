import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodePng } from "@andornaut/art-kit/png";
import { spriteSheet, writeSpriteSheet } from "@andornaut/art-kit/spriteSheet";

const fixtures = process.env.ART_KIT_TEST_FIXTURES;
assert.ok(fixtures, "Required fixture directory");
// Frozen Aseprite 1.2.30 exports; see fixtures/README.md.
const directory = join(fixtures, "sprite-sheet");
const { cases } = JSON.parse(readFileSync(join(directory, "cases.json"), "utf8"));
const reference = (name) => ({
  data: readFileSync(join(directory, `${name}.json`), "utf8"),
  sheet: new Uint8Array(readFileSync(join(directory, `${name}.png`))),
});

// A generated case's frames are rows of palette indices, "." for clear.
const decodeRows = (palette, rows) =>
  rows.map((row) => [...row].map((c) => (c === "." ? null : palette[Number(c)])));

function generatedTags({ palette, tags }) {
  return tags.map(([name, frames, ms]) => [
    name,
    frames.map((rows) => decodeRows(palette, rows)),
    ms,
  ]);
}

// A game export's tags, read back from its sheet and data.
function exportedTags({ data, sheet }) {
  const json = JSON.parse(data);
  const image = decodePng(sheet);
  const entries = Object.values(json.frames);
  const frames = entries.map(({ frame: r }) =>
    Array.from({ length: r.h }, (_, y) =>
      Array.from({ length: r.w }, (__, x) => {
        const i = ((r.y + y) * image.width + r.x + x) * 4;
        return image.data[i + 3] === 0
          ? null
          : Array.from(image.data.subarray(i, i + 3), (v) => v.toString(16).padStart(2, "0")).join(
              "",
            );
      }),
    ),
  );
  return json.meta.frameTags.map(({ from, name, to }) => [
    name,
    frames.slice(from, to + 1),
    entries.slice(from, to + 1).map(({ duration }) => duration),
  ]);
}

for (const c of cases) {
  test(`${c.name} (${c.source}) reproduces Aseprite's data, pixels and PNG bytes`, () => {
    const expected = reference(c.name);
    const tags = c.source === "generated" ? generatedTags(c) : exportedTags(expected);
    const { data, sheet } = spriteSheet({ key: c.key, image: c.image, ...c.options }, tags);
    assert.equal(data, expected.data);
    assert.deepEqual(decodePng(sheet), decodePng(expected.sheet));
    assert.deepEqual(sheet, expected.sheet);
  });
}

const frame = [
  [null, "ff0000"],
  ["00ff00", null],
];
const tags = [
  ["walk", [frame, frame], [100, 200]],
  ["idle", [frame], 1000],
];

test("writeSpriteSheet creates directories and names the sheet file as meta.image", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "sprite-sheet-test-"));
  try {
    const paths = { sheet: join(scratch, "a", "b sheet.png"), data: join(scratch, "c", "b.json") };
    await writeSpriteSheet(paths, { key: "b", columns: 2 }, tags);
    const expected = spriteSheet({ key: "b", image: "b sheet.png", columns: 2 }, tags);
    assert.equal(await readFile(paths.data, "utf8"), expected.data);
    assert.deepEqual(new Uint8Array(await readFile(paths.sheet)), expected.sheet);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("spriteSheet rejects invalid columns, margins, durations and frames", () => {
  const options = { key: "k", image: "k.png" };
  const cases = [
    ...[0, -1, 1.5, true, NaN].map((columns) => [
      { ...options, columns },
      tags,
      /positive integer/,
    ]),
    ...[
      [0, 0, 2, 0],
      [0, 1, 0, 1],
      [-1, 0, 0, 0],
      [0.5, 0, 0, 0],
    ].map((margins) => [{ ...options, margins }, tags, /leave a centre/]),
    [options, [["t", [frame, frame], [100]]], /one duration/],
    [options, [["t", [frame], NaN]], /finite/],
    [options, [["t", [frame, [["ff0000"]]], 100]], /2x2/],
    [
      options,
      [
        ["t", [frame], 100],
        ["empty", [], 100],
      ],
      /no frames/,
    ],
    [options, [], /must have pixels/],
  ];
  for (const [opts, t, error] of cases) {
    assert.throws(() => spriteSheet(opts, t), error);
  }
});
