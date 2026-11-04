import assert from 'node:assert/strict';
import test from 'node:test';
import * as generate from '@andornaut/art-kit/generate';
import { Grid } from '@andornaut/art-kit/grid';
import { contrast, rgb } from '@andornaut/art-kit/colour';
import { composeSheet, flipped, renderContactSheet, renderFrame } from '@andornaut/art-kit/frames';
import { export as exportAseprite, lua as asepriteLua } from '@andornaut/art-kit/aseprite';
import { spriteSheet, writeSpriteSheet } from '@andornaut/art-kit/spriteSheet';

test('generation entry re-exports the owning implementations without wrappers', () => {
  const owners = { Grid, contrast, rgb, composeSheet, flipped, renderContactSheet, renderFrame, exportAseprite, asepriteLua, spriteSheet, writeSpriteSheet };
  assert.deepEqual(Object.keys(generate).sort(), Object.keys(owners).sort());
  for (const [name, value] of Object.entries(owners)) assert.equal(generate[name], value, name);
});
