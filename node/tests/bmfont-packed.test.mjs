import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildBitmapFontFromGlyphs as build } from '@andornaut/art-kit/glyphAtlas';

// Frozen packed-layout references; see fixtures/README.md.
const fixtures = JSON.parse(readFileSync(`${process.env.ART_KIT_TEST_FONTS}/bmfont-packed.json`, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function inputs(fixture) {
  const glyphs = new Map(fixture.glyphs.map(({ char, image, ...metrics }) => [char, {
    image: image && { width: image.width, height: image.height, data: new Uint8Array(Buffer.from(image.data, 'base64')) },
    ...metrics }]));
  const { key, face, size, line_height: lineHeight, base } = fixture.info;
  const options = { layout: 'packed', antialias: fixture.antialias, key, face, size, base, lineHeight,
    atlasWidth: fixture.width, kernings: fixture.kernings };
  return { glyphs, options };
}

for (const fixture of fixtures.cases) {
  test(`packed layout matches the frozen reference: ${fixture.name}`, () => {
    const { glyphs, options } = inputs(fixture);
    const { image, xml, metadata } = build(options, glyphs);
    assert.equal(xml, fixture.xml);
    assert.deepEqual([image.width, image.height], [fixture.atlas.width, fixture.atlas.height]);
    assert.equal(sha256(image.data), fixture.atlas.sha256);
    assert.deepEqual([...metadata.glyphs].map(([char, { x, y }]) => [char, x, y]), fixture.places);
    assert.equal(metadata.layout, 'packed');
    assert.equal(metadata.antialias, fixture.antialias);
  });
}

test('fixtures cover every packed-layout rule', () => {
  const { cases } = fixtures;
  assert.ok(cases.some(c => c.kernings.length === 0) && cases.some(c => c.kernings.some(k => k.amount === -1)));
  assert.ok(cases.some(c => c.antialias) && cases.some(c => !c.antialias));
  assert.ok(cases.some(c => c.glyphs.some(g => g.image === null)));
  assert.ok(cases.some(c => c.glyphs.some(g => g.char.codePointAt(0) > 0xffff)));
  assert.ok(cases.some(c => /face='/.test(c.xml)) && cases.some(c => /face="[^"]*&quot;/.test(c.xml)));
  assert.ok(cases.some(c => c.glyphs.some(g => g.image?.width === c.width)));
  assert.ok(fixtures.legacy_matches >= 1);
});

test('packed layout requires antialias and rejects padding; padded rejects antialias', () => {
  const base = { key: 'k', face: 'F', size: 1, base: 1, lineHeight: 1, atlasWidth: 4 };
  const glyphs = new Map([['a', { image: { width: 5, height: 1, data: new Uint8Array(20) }, xoffset: 0, yoffset: 0, xadvance: 1 }]]);
  for (const options of [{ layout: 'packed' }, { layout: 'packed', antialias: 1 }, { layout: 'packed', antialias: true, padding: 0 },
    { layout: 'padded', antialias: false }, { antialias: true }, { layout: 'extruded' }])
    assert.throws(() => build({ ...base, ...options }, new Map()), RangeError);
  assert.throws(() => build({ ...base, layout: 'packed', antialias: false }, glyphs), /exceeds atlas width/);
  assert.throws(() => build({ ...base, layout: 'packed', antialias: false, maxHeight: 2 },
    new Map([['a', { image: { width: 4, height: 3, data: new Uint8Array(48) }, xoffset: 0, yoffset: 0, xadvance: 1 }]])), /maximum height/);
});
