import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  drawBitmapText,
  measureBitmapText,
  readBitmapFont,
} from "@andornaut/art-kit/build/bitmapFont";
import { buildBitmapFontFromGlyphs } from "@andornaut/art-kit/build/glyphAtlas";
import { blankImage } from "@andornaut/art-kit/build/rgbaImage";

const root = process.env.ART_KIT_TEST_FIXTURES;
const fixture = JSON.parse(readFileSync(`${root}/bitmap-font.json`, "utf8"));
const image = ({ data, height, width }) => ({
  width,
  height,
  data: Uint8Array.from(Buffer.from(data, "base64")),
});
const options = () => ({
  font: readBitmapFont(fixture.xml),
  lineSpacing: 1,
  missing: { fallback: 63, absent: "skip" },
});

test("bitmap font reads both glyphAtlas layouts and the committed Chibi XML dialect", () => {
  for (const layout of ["padded", "packed"]) {
    const supplied = new Map([
      ["A", { image: blankImage(2, 2), xoffset: -1, yoffset: -2, xadvance: 3 }],
      [" ", { image: undefined, xoffset: 0, yoffset: 0, xadvance: 2 }],
      ["🙂", { image: blankImage(1, 1), xoffset: 1, yoffset: 0, xadvance: -1 }],
    ]);
    const built = buildBitmapFontFromGlyphs(
      {
        key: 'a&b"',
        face: 'Quotes "and" & symbols 🙂',
        size: 4,
        base: -2,
        lineHeight: 5,
        atlasWidth: 8,
        layout,
        ...(layout === "packed" ? { antialias: true } : {}),
        kernings: [{ first: 65, second: 128578, amount: -1 }],
      },
      supplied,
    );
    const font = readBitmapFont(built.xml);
    assert.equal(font.page, 'a&b".png');
    assert.equal(font.base, -2);
    assert.equal(font.lineHeight, 5);
    assert.deepEqual([font.width, font.height], [built.image.width, built.image.height]);
    assert.deepEqual([...font.glyphs.values()], [...built.metadata.glyphs.values()]);
    assert.deepEqual(font.kernings, built.metadata.kernings);
  }
  for (const name of ["chibi-regular-16", "chibi-bold-16"]) {
    const font = readBitmapFont(readFileSync(`${root}/fonts/${name}.fnt`, "utf8"));
    assert.equal(font.page, `${name}.png`);
    assert.ok(font.glyphs.has(32) && font.glyphs.get(32).width === 0);
    assert.ok(font.kernings.some(({ amount }) => amount < 0));
  }
  const quoted = readBitmapFont(fixture.xml.replaceAll('"', "'"));
  assert.equal(quoted.page, "a&b.png");
});

test("bitmap font measures signed metrics, original-code-point fallback and literal LF lines", () => {
  const opts = options();
  assert.deepEqual(measureBitmapText(opts, "AΩV\n 🙂\n"), {
    lineAdvances: [7, 1, 0],
    height: 14,
    glyphBounds: { x: -1, y: -1, width: 8, height: 5 },
  });
  assert.deepEqual(measureBitmapText(opts, ""), {
    lineAdvances: [0],
    height: 4,
    glyphBounds: undefined,
  });
  assert.deepEqual(measureBitmapText(opts, " \n"), {
    lineAdvances: [2, 0],
    height: 9,
    glyphBounds: undefined,
  });
  assert.deepEqual(measureBitmapText(opts, "Z").lineAdvances, [-3]);
  assert.deepEqual(measureBitmapText({ ...opts, lineSpacing: -3 }, "A\nV").lineAdvances, [3, 2]);
  assert.equal(measureBitmapText({ ...opts, lineSpacing: -3 }, "A\nV").height, 5);
  assert.deepEqual(measureBitmapText(opts, "A\nV").lineAdvances, [3, 2]);
  // CR is a missing scalar here, not normalized into LF; the explicit fallback advances it.
  assert.deepEqual(measureBitmapText(opts, "\r\n").lineAdvances, [2, 0]);
  const font = { ...opts.font, glyphs: new Map(opts.font.glyphs) };
  font.glyphs.delete(63);
  assert.deepEqual(measureBitmapText({ ...opts, font }, "AΩV").lineAdvances, [4]);
  assert.deepEqual(measureBitmapText({ ...opts, missing: "skip" }, "AΩV").lineAdvances, [4]);
  assert.throws(
    () => measureBitmapText({ ...opts, missing: "reject" }, "Ω"),
    /Glyph U\+3A9 must be in the font/,
  );
  assert.throws(
    () => measureBitmapText({ ...opts, font, missing: { fallback: 63, absent: "reject" } }, "Ω"),
    /Glyph U\+3A9 must be in the font/,
  );
});

test("bitmap font tinted composition matches frozen independent Chibi drawLabel bytes", () => {
  // Frozen pinned consumer bodies with injected synthetic inputs, not this implementation.
  assert.equal(fixture.reference.blob, "2a0afcb77a78e515f389e17c064860cb7980a5d2");
  for (const c of fixture.cases) {
    const opts = options();
    if (!c.fallback) {
      opts.font.glyphs.delete(63);
    }
    const atlas = image(fixture.atlas),
      before = atlas.data.slice();
    const target = image(fixture.target);
    drawBitmapText(
      { ...opts, atlas, at: c.at, tint: fixture.tint, lineSpacing: c.lineSpacing },
      c.text,
      target,
    );
    assert.deepEqual(target.data, Uint8Array.from(Buffer.from(c.expected, "base64")), c.name);
    assert.deepEqual(atlas.data, before, `${c.name}: atlas must not mutate`);
  }
});

test("bitmap font distinguishes glyph rectangles from alpha ink and retains hidden target RGB", () => {
  const opts = options(),
    atlas = image(fixture.atlas);
  // A's first pixel is clear but its complete declared rectangle remains in glyphBounds.
  assert.deepEqual(measureBitmapText(opts, "A").glyphBounds, { x: -1, y: -1, width: 2, height: 2 });
  const target = {
    width: 2,
    height: 2,
    data: Uint8Array.from([41, 42, 43, 0, 41, 42, 43, 0, 41, 42, 43, 0, 41, 42, 43, 0]),
  };
  drawBitmapText({ ...opts, atlas, at: { x: 1, y: 1 }, tint: [23, 145, 201] }, "A", target);
  assert.deepEqual(
    [...target.data],
    [41, 42, 43, 0, 23, 145, 201, 128, 23, 145, 201, 255, 23, 145, 201, 1],
  );
});

test("bitmap font rejects unsupported XML layouts and corrupt scalar, count and rect data", () => {
  const duplicate = /<char\b[^>]*\/>/.exec(fixture.xml)[0];
  for (const xml of [
    fixture.xml.replace('packed="0"', 'packed="1"'),
    fixture.xml.replace('pages="1"', 'pages="2"'),
    fixture.xml.replace('chnl="15"', 'chnl="8"'),
    fixture.xml.replace('count="6"', 'count="7"'),
    fixture.xml.replace('width="2"', 'width="8"'),
    fixture.xml.replace('id="65"', 'id="55296"'),
    fixture.xml.replace("&amp;", "&external;"),
    `<!DOCTYPE font SYSTEM "unresolved"><font/>`,
    fixture.xml.replace("</chars>", `${duplicate}</chars>`),
    fixture.xml.replace("</chars>", "</pages>"),
    fixture.xml.replace('xadvance="3"', 'xadvance="3.5"'),
  ]) {
    assert.throws(() => readBitmapFont(xml), RangeError);
  }
});

test("bitmap font validates layout and images atomically before drawing", () => {
  const opts = {
    ...options(),
    atlas: image(fixture.atlas),
    at: { x: 1, y: 1 },
    tint: fixture.tint,
  };
  const large = { ...opts.font, glyphs: new Map(opts.font.glyphs) };
  large.glyphs.set(65, { ...large.glyphs.get(65), xadvance: Number.MAX_SAFE_INTEGER });
  for (const [changes, text] of [
    [{ missing: "reject" }, "AΩ"],
    [{ lineSpacing: undefined }, "A"],
    [{ lineSpacing: -4 }, "A"],
    [{ missing: undefined }, "A"],
    [{ missing: { fallback: 63, absent: "invent" } }, "A"],
    [{ atlas: { ...opts.atlas, width: 6 } }, "A"],
    [{ at: { x: 0.5, y: 0 } }, "A"],
    [{ font: large }, "AA"],
    [{ at: { x: 0, y: Number.MAX_SAFE_INTEGER } }, "A\nA"],
    [{ tint: [256, 0, 0] }, "A"],
    [{}, "A\ud800"],
  ]) {
    const target = image(fixture.target),
      before = target.data.slice();
    assert.throws(() => drawBitmapText({ ...opts, ...changes }, text, target), RangeError);
    assert.deepEqual(target.data, before);
  }
  const alias = { ...opts.atlas, data: opts.atlas.data.subarray() };
  assert.throws(
    () => drawBitmapText(opts, "A", alias),
    /must match the font size and be separate from target/,
  );
});
