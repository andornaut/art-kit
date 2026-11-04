import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lua, export as exportSprite } from '@andornaut/art-kit/aseprite';

const frame = [[null, 'ff0000'], ['00ff00', null]];
const tags = [['walké', [frame, frame], [100, 200]], ['idle', [frame], 1000]];

test('Lua preserves pixel coordinates, palette order, tag ranges, durations and slice centre', () => {
  const script = lua(['ff0000', '00ff00'], tags, '/out/a sprite.aseprite', {
    key: 'panel', margins: [1, 0, 0, 1],
  });
  assert.match(script, /Sprite\(2, 2, ColorMode.RGB\)/);
  assert.match(script, /pal:setColor\(0, Color\{ r = 255, g = 0, b = 0 \}\)/);
  assert.match(script, /pal:setColor\(1, Color\{ r = 0, g = 255, b = 0 \}\)/);
  assert.match(script, /local frames = \{\{\{1,0,255,0,0\},\{0,1,0,255,0\}\}/);
  assert.match(script, /local durations = \{0.1,0.2,1.0\}/);
  assert.match(script, /newTag\(1, 2\); t.name = "walké"/);
  assert.match(script, /newTag\(3, 3\); t.name = "idle"/);
  assert.match(script, /s.center = Rectangle\(1, 0, 1, 1\)/);
  assert.match(script, /spr:saveAs\("\/out\/a sprite.aseprite"\)/);
  assert.throws(() => lua([], [['x', [frame], []]], 'x'), /one duration/);
  assert.throws(() => lua([], tags, 'x', { margins: [0, 0, 0, 0] }), /requires a key/);
});

async function fixture(body, action) {
  const scratch = await mkdtemp(join(tmpdir(), 'aseprite-test-'));
  try {
    const executable = join(scratch, 'fake engine');
    const log = join(scratch, 'calls.jsonl');
    await writeFile(executable, `#!${process.execPath}\n${body.replaceAll('LOG_PATH', JSON.stringify(log))}`);
    await chmod(executable, 0o755);
    await action(scratch, executable, log);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
const recorder = `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(LOG_PATH, JSON.stringify({args, script:args[1] === '--script' ? fs.readFileSync(args[2], 'utf8') : null})+'\\n');`;

test('export uses literal executable/paths, ordered commands and final-only columns', async () => {
  await fixture(recorder, async (scratch, executable, log) => {
    const source = join(scratch, 'nested', 'a $literal.aseprite');
    const sheet = join(scratch, 'sheet.png');
    const data = join(scratch, 'sheet.json');
    await exportSprite(executable, [], tags, source, sheet, data);
    await exportSprite(executable, [], tags, source, sheet, data, {
      key: 'panel', margins: [0, 0, 0, 0], columns: 6,
    });
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].args.slice(0, 2), ['-b', '--script']);
    assert.match(calls[0].script, /walké/);
    await assert.rejects(stat(calls[0].args[2]), { code: 'ENOENT' });
    const expected = ['-b', source, '--sheet', sheet, '--data', data, '--format', 'json-hash', '--list-tags'];
    assert.deepEqual(calls[1].args, expected);
    assert.deepEqual(calls[3].args, [...expected, '--list-slices', '--sheet-columns', '6']);
    assert.ok(!calls[2].args.includes('--sheet-columns'));
    for (const columns of [0, -1, 1.5, true, NaN]) {
      await assert.rejects(exportSprite(executable, [], tags, source, sheet, data, { columns }), /positive integer/);
    }
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 4);
  });
});

test('source, sheet and missing executable failures propagate, and a failed source stops sheet export', async () => {
  const cases = [
    ['source process', 'process.exit(7);', (executable) => executable, /failed \(7\)/, 1],
    ['sheet process', "if(process.argv[3] !== '--script') process.exit(9);", (executable) => executable, /failed \(9\)/, 2],
    ['missing executable', '', (_, scratch) => join(scratch, 'missing'), { code: 'ENOENT' }, 0],
  ];
  for (const [name, exit, run, error, calls] of cases) {
    await fixture(`${recorder}\n${exit}`, async (scratch, executable, log) => {
      const paths = ['a', 'b', 'c'].map(path => join(scratch, path));
      await assert.rejects(exportSprite(run(executable, scratch), [], tags, ...paths), error, name);
      const logged = calls ? (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse) : [];
      assert.equal(logged.length, calls, `${name} process count`);
      if (calls) await assert.rejects(stat(logged[0].args[2]), { code: 'ENOENT' }, `${name} removes the temporary script`);
    });
  }
});
