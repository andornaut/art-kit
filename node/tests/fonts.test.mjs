import assert from "node:assert/strict";
import { test } from "node:test";
import { Canvas, FontLibrary } from "skia-canvas";
import { buildBitmapFont } from "@andornaut/art-kit/fonts";

const fonts = process.env.ART_KIT_TEST_FONTS;
assert.ok(fonts, "Required ART_KIT_TEST_FONTS fixture directory");
const options = (weight = "Regular", size = 16) => ({
  path: `${fonts}/LiberationSans-${weight}.ttf`,
  size,
  key: "font",
  characters: "j_wAVTo .",
  atlasWidth: 64,
});

test("native CPU atlas retains signed bearings, spaces, bounds and AA policy", () => {
  for (const weight of ["Regular", "Bold"])
    for (const size of [12, 16]) {
      for (const antialias of [true, false]) {
        const { image, metadata } = buildBitmapFont({
          ...options(weight, size),
          antialias,
        });
        assert.equal(image.gpu, false);
        assert.equal(metadata.hinting, true);
        assert.equal(metadata.fallback, "system");
        const j = metadata.glyphs.get("j");
        assert.ok(j.xoffset < 0);
        const space = metadata.glyphs.get(" ");
        assert.equal(space.width * space.height, 0);
        assert.ok(space.xadvance > 0);
        const ctx = image.getContext("2d");
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        const alphas = pixels.filter((_, i) => i % 4 === 3);
        assert.ok(alphas.some((a) => a === 255));
        assert.equal(
          alphas.some((a) => a > 0 && a < 255),
          antialias,
        );
        // Each rasterized pixel belongs to a measured placement, with clear gutters.
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            if (pixels[(y * image.width + x) * 4 + 3]) {
              assert.ok(
                [...metadata.glyphs.values()].some(
                  (g) =>
                    x >= g.x &&
                    y >= g.y &&
                    x < g.x + g.width &&
                    y < g.y + g.height,
                ),
                `escaped ink at ${x},${y}`,
              );
            }
          }
        assert.ok(
          ctx
            .getImageData(j.x, j.y, j.width, j.height)
            .data.some((a, i) => i % 4 === 3 && a),
        );
      }
    }
});

test("metadata/XML preserve caller policy, whitespace and kerning", () => {
  const key = 'A\tB\nC\rD & "<';
  const { metadata, xml } = buildBitmapFont({
    ...options(),
    key,
    lineHeight: 23,
    characters: "AV j😀A",
    kerning: "all",
  });
  assert.deepEqual([...metadata.glyphs.keys()], [..."AV j😀"]);
  assert.equal(metadata.lineHeight, 23);
  const av = metadata.kernings.find((k) => k.first === 65 && k.second === 86);
  assert.ok(av.amount < 0);
  assert.match(xml, /A&#9;B&#10;C&#13;D &amp; &quot;&lt;/);
  assert.match(xml, /id="128512"/);
  assert.match(xml, /lineHeight="23"/);
  assert.match(xml, /smooth="1" aa="1"/);
  assert.match(xml, new RegExp(`kernings count="${metadata.kernings.length}"`));
  const plain = buildBitmapFont(options()).metadata;
  assert.equal(plain.kerning, "none");
  assert.equal(plain.kernings.length, 0);
});

test("builder rejects impossible atlases and invalid input before rendering", () => {
  const opts = options();
  for (const field of [
    "size",
    "atlasWidth",
    "lineHeight",
    "padding",
  ]) {
    assert.throws(() => buildBitmapFont({ ...opts, [field]: 0 }), RangeError);
  }
  assert.throws(
    () => buildBitmapFont({ ...opts, atlasWidth: 2 }),
    /atlas width/,
  );
  assert.throws(
    () => buildBitmapFont({ ...opts, characters: ["ab"] }),
    /Unicode/,
  );
  assert.throws(
    () => buildBitmapFont({ ...opts, characters: ["\ud800"] }),
    /Unicode/,
  );
  assert.throws(() => buildBitmapFont({ ...opts, key: "\0" }), /XML/);
  assert.throws(() => buildBitmapFont({ ...opts, key: "\ud800" }), /XML/);
  assert.throws(
    () => buildBitmapFont({ ...opts, path: "/missing-font.ttf" }),
    /ENOENT/,
  );
  const { image, metadata } = buildBitmapFont({ ...opts, characters: " " });
  assert.ok(image.height > 0);
  assert.equal(metadata.glyphs.get(" ").width, 0);
});


test("pair kerning uses separate glyph positioning without ligature substitution", () => {
  const path = `${fonts}/LiberationSans-Regular.ttf`;
  FontLibrary.use("kerning_reference", path);
  const context = new Canvas(1, 1).getContext("2d");
  context.font = '16px "kerning_reference"';
  context.fontSynthesis = false;
  context.fontHinting = true;
  context.fontSmoothing = true;
  context.fontKerning = "normal";
  context.fontFeatureSettings = { liga: false, clig: false, dlig: false, hlig: false, rlig: false, calt: false, rclt: false };
  const unique = [..."fiAV"];
  const expected = unique.flatMap(a => unique.map(b => ({
    first: a.codePointAt(0), second: b.codePointAt(0),
    amount: Math.round(context.measureText(a + b).width - context.measureText(a).width - context.measureText(b).width),
  }))).filter(k => k.amount !== 0);
  const { metadata } = buildBitmapFont({ ...options(), characters: "fiAV", kerning: "all" });
  assert.ok(expected.length > 0);
  assert.deepEqual(metadata.kernings, expected);
});

test("explicit face and baseline change metadata without moving atlas ink", () => {
  const original = buildBitmapFont(options());
  const font = buildBitmapFont({ ...options(), face: 'Regular & "face"', base: 19 });
  assert.equal(font.metadata.face, 'Regular & "face"');
  assert.equal(font.metadata.base, 19);
  assert.match(font.xml, /face="Regular &amp; &quot;face&quot;"/);
  assert.match(font.xml, /base="19"/);
  assert.match(font.xml, /file="font.png"/);
  const delta = 19 - original.metadata.base;
  for (const [char, glyph] of font.metadata.glyphs) {
    const old = original.metadata.glyphs.get(char);
    assert.equal(glyph.yoffset, glyph.height ? old.yoffset + delta : 0);
  }
  const pixels = f => f.image.getContext("2d").getImageData(0, 0, f.image.width, f.image.height).data;
  assert.deepEqual(pixels(font), pixels(original));
  for (const base of [-1, 1.5, NaN, 16385])
    assert.throws(() => buildBitmapFont({ ...options(), base }), /Base/);
});

test("all kerning emits each nonzero ordered pair once, bounded to 256 characters", () => {
  const characters = "AVTofi jAV";
  for (const weight of ["Regular", "Bold"]) {
    const all = buildBitmapFont({ ...options(weight), characters, kerning: "all" });
    const keys = all.metadata.kernings.map(k => `${k.first},${k.second}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(all.metadata.kernings.length > 0);
    assert.ok(all.metadata.kernings.every(k => k.amount !== 0 && Number.isInteger(k.amount)));
    assert.equal(all.metadata.kerning, "all");
  }
  const tooMany = Array.from({ length: 257 }, (_, i) => String.fromCodePoint(0x100 + i));
  assert.throws(() => buildBitmapFont({ ...options(), kerning: "all", characters: tooMany }), /256/);
  assert.throws(() => buildBitmapFont({ ...options(), kerning: "unknown" }), /Kerning/);
});
