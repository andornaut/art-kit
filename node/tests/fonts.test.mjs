import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { fontCoverage, rasteriseGlyphs } from "@andornaut/art-kit/fonts";
import { buildBitmapFontFromGlyphs } from "@andornaut/art-kit/glyphAtlas";
import { decodePng } from "@andornaut/art-kit/png";
import { Canvas, FontLibrary } from "skia-canvas";

const fixtures = process.env.ART_KIT_TEST_FIXTURES;
assert.ok(fixtures, "Required ART_KIT_TEST_FIXTURES fixture directory");
const font = (weight = "Regular") => `${fixtures}/LiberationSans-${weight}.ttf`;
const options = (weight = "Regular", size = 16) => ({
  path: font(weight),
  size,
  characters: "j_wAVTo .",
});
const CHARS = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), "·"];

test("glyphs are trimmed white coverage with signed bearings, empty spaces and the AA policy", () => {
  const bearings = [];
  for (const weight of ["Regular", "Bold"]) {
    for (const size of [12, 16]) {
      for (const antialias of [true, false]) {
        const { ascent, base, descent, glyphs, kernings, lineHeight } = rasteriseGlyphs({
          ...options(weight, size),
          antialias,
        });
        assert.equal(base, Math.ceil(ascent));
        assert.equal(lineHeight, Math.ceil(ascent + descent));
        assert.deepEqual(kernings, []);
        assert.deepEqual([...glyphs.keys()], [..."j_wAVTo ."]);
        bearings.push(glyphs.get("j").xoffset);
        const space = glyphs.get(" ");
        assert.equal(space.image, undefined);
        assert.ok(space.xadvance > 0);
        let partial = false;
        for (const [char, { image }] of glyphs) {
          if (!image) {
            continue;
          }
          const { data, height, width } = image;
          const alpha = (x, y) => data[(y * width + x) * 4 + 3];
          // Trimmed: every edge row and column holds ink.
          assert.ok(
            [...Array(width).keys()].some((x) => alpha(x, 0)),
            char,
          );
          assert.ok(
            [...Array(width).keys()].some((x) => alpha(x, height - 1)),
            char,
          );
          assert.ok(
            [...Array(height).keys()].some((y) => alpha(0, y)),
            char,
          );
          assert.ok(
            [...Array(height).keys()].some((y) => alpha(width - 1, y)),
            char,
          );
          for (let i = 0; i < data.length; i += 4) {
            const pixel = [...data.subarray(i, i + 4)];
            assert.deepEqual(pixel, pixel[3] ? [255, 255, 255, pixel[3]] : [0, 0, 0, 0]);
            partial ||= pixel[3] > 0 && pixel[3] < 255;
          }
        }
        assert.equal(partial, antialias);
      }
    }
  }
  // j's tail reaches left of the pen at some size and policy.
  assert.ok(Math.min(...bearings) < 0);
});

test("pair kerning uses separate glyph positioning without ligature substitution", () => {
  FontLibrary.use("kerning_reference", font());
  const context = new Canvas(1, 1).getContext("2d");
  context.font = '16px "kerning_reference"';
  context.fontSynthesis = false;
  context.fontHinting = true;
  context.fontSmoothing = true;
  context.fontKerning = "normal";
  context.fontFeatureSettings = {
    liga: false,
    clig: false,
    dlig: false,
    hlig: false,
    rlig: false,
    calt: false,
    rclt: false,
  };
  const unique = [..."fiAV"];
  const expected = unique
    .flatMap((a) =>
      unique.map((b) => ({
        first: a.codePointAt(0),
        second: b.codePointAt(0),
        amount: Math.round(
          context.measureText(a + b).width -
            context.measureText(a).width -
            context.measureText(b).width,
        ),
      })),
    )
    .filter((k) => k.amount !== 0);
  const { kernings } = rasteriseGlyphs({ ...options(), characters: "fiAV", kerning: "all" });
  assert.ok(expected.length > 0);
  assert.deepEqual(kernings, expected);
});

test("all kerning emits each nonzero ordered pair once, bounded to 256 characters", () => {
  for (const weight of ["Regular", "Bold"]) {
    const { kernings } = rasteriseGlyphs({
      ...options(weight),
      characters: "AVTofi jAV",
      kerning: "all",
    });
    const keys = kernings.map((k) => `${k.first},${k.second}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(kernings.length > 0);
    assert.ok(kernings.every((k) => k.amount !== 0 && Number.isInteger(k.amount)));
  }
  const tooMany = Array.from({ length: 257 }, (_, i) => String.fromCodePoint(0x100 + i));
  assert.throws(
    () => rasteriseGlyphs({ ...options(), kerning: "all", characters: tooMany }),
    /256/,
  );
  assert.throws(() => rasteriseGlyphs({ ...options(), kerning: "unknown" }), /Kerning/);
});

test("rasterization rejects invalid input before rendering", () => {
  for (const size of [0, 1.5, 16385]) {
    assert.throws(() => rasteriseGlyphs({ ...options(), size }), RangeError);
  }
  assert.throws(() => rasteriseGlyphs({ ...options(), characters: ["ab"] }), /Unicode/);
  assert.throws(() => rasteriseGlyphs({ ...options(), characters: ["\ud800"] }), /Unicode/);
  assert.throws(() => rasteriseGlyphs({ ...options(), path: "/missing-font.ttf" }), /ENOENT/);
});

test("rasterization rejects every character the font file does not map, before drawing", () => {
  assert.throws(
    () => rasteriseGlyphs({ ...options(), characters: "Aあb😀" }),
    (error) =>
      error instanceof RangeError &&
      error.message ===
        `${font()} has no glyph for U+3042 ${JSON.stringify("あ")}, U+1F600 ${JSON.stringify("😀")}`,
  );
});

// Synthetic sfnt files: a table directory holding only a cmap with the given subtables.
const scratch = mkdtempSync(join(tmpdir(), "font-coverage-test-"));
after(() => rmSync(scratch, { force: true, recursive: true }));
const u16 = (...values) => values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]);
const u32 = (...values) => values.flatMap((v) => [...u16(v >>> 16), ...u16(v & 0xffff)]);
function format4(segments) {
  const all = [...segments, { start: 0xffff, end: 0xffff, delta: 1 }];
  const n = all.length;
  const glyphIds = [];
  const rangeOffsets = all.map((segment, i) => {
    if (!segment.glyphs) {
      return 0;
    }
    const offset = 2 * (n - i + glyphIds.length);
    glyphIds.push(...segment.glyphs);
    return offset;
  });
  const body = [
    ...u16(2 * n, 0, 0, 0),
    ...u16(...all.map((s) => s.end), 0),
    ...u16(...all.map((s) => s.start)),
    ...u16(...all.map((s) => (s.delta ?? 0) & 0xffff)),
    ...u16(...rangeOffsets, ...glyphIds),
  ];
  return [...u16(4, 6 + body.length, 0), ...body];
}
function format12(groups) {
  return [
    ...u16(12, 0),
    ...u32(16 + 12 * groups.length, 0, groups.length),
    ...u32(...groups.flat()),
  ];
}
function sfnt(subtables, version = 0x00010000) {
  let offset = 4 + 8 * subtables.length;
  const records = subtables.flatMap(({ encoding, platform, table }) => {
    const record = [...u16(platform, encoding), ...u32(offset)];
    offset += table.length;
    return record;
  });
  const cmap = [...u16(0, subtables.length), ...records, ...subtables.flatMap((s) => s.table)];
  return Buffer.from([
    ...u32(version),
    ...u16(1, 0, 0, 0),
    ...Buffer.from("cmap", "latin1"),
    ...u32(0, 28, cmap.length),
    ...cmap,
  ]);
}
let files = 0;
function write(bytes) {
  const path = join(scratch, `font-${files++}.ttf`);
  writeFileSync(path, bytes);
  return path;
}
const unicode4 = (segments) => ({ platform: 3, encoding: 1, table: format4(segments) });
const unicode12 = (groups) => ({ platform: 3, encoding: 10, table: format12(groups) });

for (const [name, bytes, expected] of [
  [
    "format 4 deltas",
    sfnt([unicode4([{ start: 0x41, end: 0x43, delta: -0x40 }])]),
    [0x41, 0x42, 0x43],
  ],
  [
    "format 4 delta onto .notdef",
    sfnt([unicode4([{ start: 0x41, end: 0x42, delta: -0x41 }])]),
    [0x42],
  ],
  [
    "format 4 glyph index array, with .notdef and a delta",
    sfnt([unicode4([{ start: 0x61, end: 0x64, delta: 2, glyphs: [5, 0, 7, 0xfffe] }])]),
    [0x61, 0x63],
  ],
  [
    "format 12 groups beyond the BMP",
    sfnt([
      unicode12([
        [0x20, 0x20, 0],
        [0x1f600, 0x1f601, 10],
      ]),
    ]),
    [0x1f600, 0x1f601],
  ],
  [
    "format 12 in preference to format 4",
    sfnt([
      unicode4([{ start: 0x41, end: 0x41, delta: 1 }]),
      { platform: 0, encoding: 4, table: format12([[0x42, 0x42, 3]]) },
    ]),
    [0x42],
  ],
  [
    "format 4 under a Unicode platform ID",
    sfnt([{ platform: 0, encoding: 3, table: format4([{ start: 0x30, end: 0x30, delta: 1 }]) }]),
    [0x30],
  ],
  ["an OpenType CFF sfnt", sfnt([unicode12([[0x41, 0x41, 1]])], 0x4f54544f), [0x41]],
]) {
  test(`font coverage reads the mapped code points: ${name}`, () => {
    assert.deepEqual(
      [...fontCoverage(write(bytes))].sort((a, b) => a - b),
      expected,
    );
  });
}

const liberation = readFileSync(font());
for (const [name, bytes, reason] of [
  ["a font collection", Buffer.from("ttcf", "latin1"), /collections/],
  ["a WOFF file", Buffer.from("wOFF\0\x01\0\0", "latin1"), /sfnt/],
  ["an empty file", Buffer.alloc(0), /past the end/],
  ["a truncated font", liberation.subarray(0, 64), /past the end/],
  ["no cmap table", Buffer.from([...u32(0x00010000), ...u16(0, 0, 0, 0)]), /no cmap/],
  [
    "no Unicode subtable",
    sfnt([{ platform: 1, encoding: 0, table: format4([{ start: 0x41, end: 0x41, delta: 1 }]) }]),
    /no Unicode cmap subtable/,
  ],
  ["a reversed format 12 group", sfnt([unicode12([[0x42, 0x41, 1]])]), /not a Unicode range/],
  [
    "a format 12 group past U+10FFFF",
    sfnt([unicode12([[0x41, 0x110000, 1]])]),
    /not a Unicode range/,
  ],
]) {
  test(`font coverage rejects ${name}`, () => {
    const path = write(bytes);
    assert.throws(
      () => fontCoverage(path),
      (error) =>
        error instanceof RangeError &&
        error.message.startsWith(`${path} is not a supported font: `) &&
        reason.test(error.message),
    );
    assert.throws(() => rasteriseGlyphs({ ...options(), path }), RangeError);
  });
}

for (const weight of ["Regular", "Bold"]) {
  test(`font coverage of the Liberation Sans ${weight} fixture`, () => {
    const coverage = fontCoverage(font(weight));
    for (const char of [...CHARS, "é", "€", "–"]) {
      assert.ok(coverage.has(char.codePointAt(0)), char);
    }
    for (const char of ["あ", "😀", "\u{10ffff}"]) {
      assert.ok(!coverage.has(char.codePointAt(0)), char);
    }
  });
}

// The two games' pipelines over rasteriseGlyphs reproduce their frozen buildBitmapFont outputs.
function chibiStyle(key, size, weight) {
  const r = rasteriseGlyphs({ path: font(weight), size, characters: CHARS, kerning: "all" });
  for (const { image } of r.glyphs.values()) {
    if (image) {
      for (let i = 0; i < image.data.length; i += 4) {
        image.data.fill(255, i, i + 3);
      }
    }
  }
  return buildBitmapFontFromGlyphs(
    {
      layout: "packed",
      antialias: true,
      key,
      face: key,
      size,
      base: r.base,
      lineHeight: r.base + Math.ceil(r.descent) + 1,
      atlasWidth: 256,
      kernings: r.kernings,
    },
    r.glyphs,
  );
}
function archieStyle(key, size, weight) {
  const r = rasteriseGlyphs({
    path: font(weight),
    size,
    characters: CHARS,
    antialias: false,
    hinting: false,
  });
  return buildBitmapFontFromGlyphs(
    {
      atlasWidth: 256,
      base: r.base,
      face: key,
      kernings: [],
      key,
      lineHeight: r.lineHeight + 1,
      padding: 1,
      size,
    },
    r.glyphs,
  );
}
for (const [key, pipeline, size, weight] of [
  ["chibi-regular-16", chibiStyle, 16, "Regular"],
  ["chibi-bold-16", chibiStyle, 16, "Bold"],
  ["archie-regular-12", archieStyle, 12, "Regular"],
  ["archie-bold-8", archieStyle, 8, "Bold"],
]) {
  test(`game font pipeline matches the frozen buildBitmapFont reference: ${key}`, () => {
    const { image, xml } = pipeline(key, size, weight);
    const expected = decodePng(readFileSync(`${fixtures}/fonts/${key}.png`));
    assert.equal(xml, readFileSync(`${fixtures}/fonts/${key}.fnt`, "utf8"));
    assert.deepEqual([image.width, image.height], [expected.width, expected.height]);
    assert.ok(Buffer.from(image.data).equals(Buffer.from(expected.data)));
  });
}
