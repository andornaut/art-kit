import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Canvas, FontLibrary } from "skia-canvas";
import { rasteriseGlyphs } from "@andornaut/art-kit/fonts";
import { buildBitmapFontFromGlyphs } from "@andornaut/art-kit/glyphAtlas";
import { decodePng } from "@andornaut/art-kit/png";

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
  for (const weight of ["Regular", "Bold"])
    for (const size of [12, 16])
      for (const antialias of [true, false]) {
        const { glyphs, base, lineHeight, ascent, descent, kernings } = rasteriseGlyphs({
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
          if (!image) continue;
          const { data, width, height } = image;
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
  for (const size of [0, 1.5, 16385])
    assert.throws(() => rasteriseGlyphs({ ...options(), size }), RangeError);
  assert.throws(() => rasteriseGlyphs({ ...options(), characters: ["ab"] }), /Unicode/);
  assert.throws(() => rasteriseGlyphs({ ...options(), characters: ["\ud800"] }), /Unicode/);
  assert.throws(() => rasteriseGlyphs({ ...options(), path: "/missing-font.ttf" }), /ENOENT/);
});

// The two games' pipelines over rasteriseGlyphs reproduce their frozen buildBitmapFont outputs.
function chibiStyle(key, size, weight) {
  const r = rasteriseGlyphs({ path: font(weight), size, characters: CHARS, kerning: "all" });
  for (const { image } of r.glyphs.values())
    if (image) for (let i = 0; i < image.data.length; i += 4) image.data.fill(255, i, i + 3);
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
])
  test(`game font pipeline matches the frozen buildBitmapFont reference: ${key}`, () => {
    const { image, xml } = pipeline(key, size, weight);
    const expected = decodePng(readFileSync(`${fixtures}/fonts/${key}.png`));
    assert.equal(xml, readFileSync(`${fixtures}/fonts/${key}.fnt`, "utf8"));
    assert.deepEqual([image.width, image.height], [expected.width, expected.height]);
    assert.ok(Buffer.from(image.data).equals(Buffer.from(expected.data)));
  });
