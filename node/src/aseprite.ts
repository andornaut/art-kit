/** Aseprite frame/tag serialization with explicit paths and executable. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { rgb } from './colour.js';
import type { Margins, Tag } from './spriteSheet.js';

export type { Tag };
export interface SliceOptions {
  key?: string;
  margins?: Margins;
}
export interface ExportOptions extends SliceOptions {
  columns?: number;
}

/** Generate the source sprite without interpreting client frame or tag policy. */
export function lua(
  palette: readonly string[], tags: readonly Tag[], output: string,
  { key, margins }: SliceOptions = {},
): string {
  const height = tags[0][1][0].length;
  const width = tags[0][1][0][0].length;
  const frames: string[] = [];
  const durations: string[] = [];
  const tagLines: string[] = [];
  let count = 0;
  for (const [name, images, ms] of tags) {
    tagLines.push(`do local t = spr:newTag(${count + 1}, ${count + images.length}); t.name = ${JSON.stringify(name)} end`);
    const times = typeof ms === 'number' ? images.map(() => ms) : ms;
    if (times.length !== images.length) throw new RangeError('Each frame requires one duration');
    images.forEach((frame, i) => {
      const points: string[] = [];
      frame.forEach((row, y) => row.forEach((colour, x) => {
        if (colour) points.push(`{${x},${y},${rgb(colour).join(',')}}`);
      }));
      frames.push(`{${points.join(',')}}`);
      const seconds = times[i] / 1000;
      durations.push(Number.isInteger(seconds) ? `${seconds}.0` : String(seconds));
    });
    count += images.length;
  }
  const paletteLines = palette.map((colour, i) => {
    const [r, g, b] = rgb(colour);
    return `pal:setColor(${i}, Color{ r = ${r}, g = ${g}, b = ${b} })`;
  }).join('\n');
  let slice = '';
  if (margins) {
    if (key === undefined) throw new RangeError('A slice requires a key');
    const [left, top, right, bottom] = margins;
    slice = `do local s = spr:newSlice(Rectangle(0, 0, ${width}, ${height})); s.name = ${JSON.stringify(key)}; s.center = Rectangle(${left}, ${top}, ${width - left - right}, ${height - top - bottom}) end\n`;
  }
  return `
local spr = Sprite(${width}, ${height}, ColorMode.RGB)
local pal = Palette(${palette.length})
${paletteLines}
spr:setPalette(pal)
local rgba = app.pixelColor.rgba
local frames = {${frames.join(',\n')}}
local durations = {${durations.join(',')}}
for i, px in ipairs(frames) do
  if i > 1 then spr:newFrame() end
  local img = spr.layers[1]:cel(i).image
  img:clear()
  for _, p in ipairs(px) do img:drawPixel(p[1], p[2], rgba(p[3], p[4], p[5], 255)) end
  spr.frames[i].duration = durations[i]
end
${tagLines.join('\n')}
${slice}spr:saveAs(${JSON.stringify(output)})
`;
}

function run(executable: string, args: string[], quiet: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Aseprite failed (${signal ?? code})`));
    });
  });
}

/** Write source, sheet and JSON. The caller owns paths and manifest updates. */
async function exportSprite(
  executable: string, palette: readonly string[], tags: readonly Tag[],
  source: string, sheet: string, data: string, options: ExportOptions = {},
): Promise<void> {
  const { columns, margins } = options;
  if (columns !== undefined && (!Number.isSafeInteger(columns) || columns <= 0)) {
    throw new RangeError('columns must be a positive integer');
  }
  for (const path of [source, sheet, data]) await mkdir(dirname(path), { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'art-kit-aseprite-'));
  try {
    const script = join(scratch, 'export.lua');
    await writeFile(script, lua(palette, tags, source, options), 'utf8');
    await run(executable, ['-b', '--script', script], false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const args = ['-b', source, '--sheet', sheet, '--data', data, '--format', 'json-hash', '--list-tags'];
  if (margins) args.push('--list-slices');
  if (columns !== undefined) args.push('--sheet-columns', String(columns));
  await run(executable, args, true);
}

export { exportSprite as export };
