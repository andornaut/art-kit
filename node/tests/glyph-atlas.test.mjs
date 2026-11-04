import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBitmapFontFromGlyphs as build } from '@andornaut/art-kit/glyphAtlas';
const options = { key: 'a&"\n', face: 'Body\tRegular', size: 16, base: 15, lineHeight: 20, atlasWidth: 6 };
const pixels = new Uint8Array([17, 31, 79, 0, 255, 7, 61, 1]);
const glyph = { image: { width: 2, height: 1, data: pixels }, xoffset: -1, yoffset: -2, xadvance: 3 };
const space = { image: undefined, xoffset: -3, yoffset: 4, xadvance: 5 };
test('copies all RGBA bytes and preserves caller metrics, order and kerning', () => {
  const result = build({ ...options, kernings: [{ first: 106, second: 32, amount: -2 }] }, new Map([['j', glyph], [' ', space], ['A', glyph]]));
  assert.deepEqual([...result.metadata.glyphs.keys()], ['j', ' ', 'A']);
  for (const c of ['j', 'A']) {
    const g = result.metadata.glyphs.get(c);
    const start = (g.y * result.image.width + g.x) * 4;
    assert.deepEqual(result.image.data.slice(start, start + 8), pixels);
    assert.equal(g.xoffset, -1); assert.equal(g.yoffset, -2); assert.equal(g.xadvance, 3);
  }
  assert.equal(result.metadata.glyphs.get('A').y, 3);
  assert.equal(result.metadata.glyphs.get(' ').xoffset, -3);
  assert.equal(result.metadata.glyphs.get(' ').xadvance, 5);
  assert.match(result.xml, /face="Body&#9;Regular"/);
  assert.match(result.xml, /file="a&amp;&quot;&#10;.png"/);
  assert.match(result.xml, /lineHeight="20" base="15"/);
  assert.match(result.xml, /first="106" second="32" amount="-2"/);
  assert.deepEqual(pixels, glyph.image.data);
});
test('rejects invalid inputs and bounded packing overflow', () => {
  const one = new Map([['j', glyph]]);
  for (const patch of [{atlasWidth: 3}, {maxHeight: 2}, {base: NaN}, {face: '\ud800'}, {padding: -1}, {kernings: [{first: 106, second: 65, amount: 1}]}])
    assert.throws(() => build({...options, ...patch}, one), RangeError);
  for (const [key, value] of [['jj', glyph], ['\ud800', glyph], ['j', {...glyph, xadvance: .5}], ['j', {...glyph, image: {...glyph.image, data: pixels.slice(1)}}]])
    assert.throws(() => build(options, new Map([[key, value]])), RangeError);
});
test('supports empty glyph sets and zero padding without inventing metrics', () => {
  const result = build({...options, padding: 0}, new Map([[' ', space]]));
  assert.equal(result.image.height, 1);
  assert.equal(result.metadata.glyphs.get(' ').yoffset, 4);
  assert.equal(build({...options, padding: 0}, new Map()).metadata.glyphs.size, 0);
});
test('an explicit padded layout matches the default layout', () => {
  const glyphs = new Map([['j', glyph], [' ', space], ['A', glyph]]);
  const implicit = build(options, glyphs), explicit = build({ ...options, layout: 'padded' }, glyphs);
  assert.equal(explicit.xml, implicit.xml);
  assert.deepEqual(explicit.image.data, implicit.image.data);
  assert.equal(implicit.metadata.layout, 'padded');
});
