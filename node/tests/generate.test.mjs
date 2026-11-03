import assert from 'node:assert/strict';
import test from 'node:test';
import * as generate from '@andornaut/art-kit/generate';
import * as grid from '@andornaut/art-kit/grid';
import * as colour from '@andornaut/art-kit/colour';
import * as frames from '@andornaut/art-kit/frames';
import { buildBitmapFont } from '@andornaut/art-kit/fonts';
import { export as exportAseprite, lua as asepriteLua } from '@andornaut/art-kit/aseprite';

test('generation entry exposes the owning implementations without wrappers', () => {
  for (const [name, value] of Object.entries({
    ...grid, ...colour, ...frames, buildBitmapFont, exportAseprite, asepriteLua,
  })) {
    assert.equal(generate[name], value, name);
  }
  assert.equal(typeof generate.exportBitmapFont, 'function');
  assert.equal('export' in generate, false);
  assert.equal('lua' in generate, false);
});
