import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bmfontXml, pack, rasterize, rasterizeGlyph } from '@andornaut/art-kit/fonts';

const pixel = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 96]) };

test('font packing preserves insertion order, alpha, spacing and empty glyphs', () => {
  const glyphs = new Map([
    ['j', [pixel, -1, 3, 4]], [' ', [undefined, 0, 0, 5]], ['A', [pixel, 0, 3, 8]],
  ]);
  const { image, places } = pack(3, glyphs);
  assert.equal(image.height, 4);
  assert.deepEqual([...places], [['j', [0, 0]], [' ', [0, 0]], ['A', [0, 2]]]);
  assert.deepEqual([...image.data.slice(0, 4)], [255, 255, 255, 96]);
  assert.deepEqual([...image.data.slice(24, 28)], [255, 255, 255, 96]);
  assert.throws(() => pack(1, new Map([['W', [{ ...pixel, width: 2 }, 0, 0, 3]]])), /W.*width 2.*width 1/);
  assert.throws(() => pack(0, glyphs), /positive integer/);
});

test('BMFont XML preserves signed metrics, Unicode IDs, escaping and caller kerning', () => {
  const glyphs = new Map([['😀', [pixel, -1, -2, 3]], [' ', [undefined, 0, 0, 5]]]);
  const { image, places } = pack(16, glyphs);
  const info = { key: 'a&b', face: 'A "B" & C', size: 16, lineHeight: 20, base: 15 };
  const xml = bmfontXml(info, [image.width, image.height], places, glyphs, { antialias: true, kernings: [['😀', ' ', -1]] });
  assert.match(xml, /face='A "B" &amp; C'/);
  assert.match(xml, /file="a&amp;b.png"/);
  assert.match(xml, /smooth="1" aa="1"/);
  assert.match(xml, /id="128512".*xoffset="-1" yoffset="-2" xadvance="3"/);
  assert.match(xml, /first="128512" second="32" amount="-1"/);
  assert.match(bmfontXml(info, [16, 2], places, glyphs), /smooth="0" aa="0"/);
});

const fonts = process.env.ART_KIT_TEST_FONTS;
assert.ok(fonts, 'Required font fixture directory ART_KIT_TEST_FONTS is missing');
test('native font rasterization retains signed ink, grayscale alpha and space advance', () => {
  for (const weight of ['Regular', 'Bold']) {
    const options = { path: `${fonts}/LiberationSans-${weight}.ttf`, size: 16, antialias: true };
    const { glyphs, ascent, descent } = rasterize(options, 'j_wA ');
    assert.deepEqual([...glyphs.keys()], [...'j_wA ']);
    assert.ok(ascent > 0 && descent >= 0);
    assert.ok(glyphs.get('j')[1] < 0);
    assert.equal(glyphs.get(' ')[0], undefined);
    assert.ok(glyphs.get(' ')[3] > 0);
    const j = glyphs.get('j')[0];
    assert.ok(j.data.some((alpha, index) => index % 4 === 3 && alpha > 0 && alpha < 255));
    for (let i = 0; i < j.data.length; i += 4) assert.deepEqual([...j.data.slice(i, i + 3)], [255, 255, 255]);
    const binary = rasterizeGlyph({ ...options, antialias: false }, 'j')[0];
    assert.ok(binary.data.every((value, index) => index % 4 !== 3 || value === 0 || value === 255));
    assert.throws(() => rasterizeGlyph(options, 'ab'), /one Unicode/);
    assert.throws(() => rasterizeGlyph({ ...options, size: 0 }, 'a'), /positive integer/);
  }
});


test('BMFont attributes preserve tab, LF and CR as numeric references', () => {
  const text = 'a\tb\nc\rd & "quoted"';
  const xml = bmfontXml({ key: text, face: text, size: 16, lineHeight: 20, base: 15 }, [1, 1], new Map(), new Map());
  assert.match(xml, /a&#9;b&#10;c&#13;d/);
  assert.ok(!/[\t\r]/.test(xml));
  // XML parsers normalize literal attribute whitespace, but preserve references.
  for (const [attribute, expected] of [['face', text], ['file', text + '.png']]) {
    const value = xml.match(new RegExp(attribute + `=(['"])(.*?)\\1`))[2];
    const parsed = value.replace(/[\t\r\n]/g, ' ').replace(/&#(\d+);|&(amp|quot|lt|gt);/g,
      (_, code, entity) => code ? String.fromCodePoint(Number(code)) : ({ amp: '&', quot: '"', lt: '<', gt: '>' })[entity]);
    assert.equal(parsed, expected);
  }
});

test('batch prepares its font once without caching subsequent calls', () => {
  const options = { path: `${fonts}/LiberationSans-Regular.ttf`, size: 16 };
  function* chars() {
    yield 'A';
    options.path = '/missing-art-kit-test-font.ttf';
    yield 'j';
  }
  assert.deepEqual([...rasterize(options, chars()).glyphs.keys()], ['A', 'j']);
  assert.throws(() => rasterize(options, 'A'), /ENOENT/);
});
