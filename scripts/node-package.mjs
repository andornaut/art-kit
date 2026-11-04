import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, revision] = process.argv.slice(2);
if (!['check', 'pack'].includes(mode)) throw new Error('Expected check or pack mode');
// Dependencies are mounted outside a conventional node_modules directory.
process.env.NODE_PATH = '/deps';
// Inputs and outputs live in the container's writable /tmp volume; the caller copies /tmp/out out.
const work = '/tmp/work';
const out = '/tmp/out';
const root = `${work}/source`;
const descriptor = JSON.parse(readFileSync(`${root}/node/package.json`, 'utf8'));
for (const [name, expected] of Object.entries({ ...descriptor.devDependencies, ...descriptor.peerDependencies })) {
  const actual = JSON.parse(readFileSync(`/deps/${name}/package.json`, 'utf8')).version;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, actual ${actual}`);
}
const version = readFileSync(`${root}/pyproject.toml`, 'utf8').match(/^version = "([^"]+)"$/m)?.[1];
if (!version) throw new Error('Missing project version');
if (mode === 'pack') {
  const identity = `${out}/SOURCE_COMMIT`;
  if (!existsSync(identity) || readFileSync(identity, 'utf8') !== `${revision}\n`) throw new Error('Existing SOURCE_COMMIT must match the release revision');
  const expectedWheel = `art_kit-${version}-py3-none-any.whl`;
  const existing = readdirSync(out);
  if (!existing.includes(expectedWheel)) throw new Error(`Missing expected wheel: ${expectedWheel}`);
  if (existing.some(name => name.endsWith('.whl') && name !== expectedWheel) || existing.some(name => name.endsWith('.tgz'))) throw new Error('Unexpected or stale release artifact');
}
symlinkSync('/deps', `${root}/node/node_modules`);
execFileSync('node', ['/deps/typescript/bin/tsc', '-p', `${root}/node/tsconfig.json`], { stdio: 'inherit' });
const packageDir = `${work}/package`;
mkdirSync(packageDir);
cpSync(`${root}/node/dist`, `${packageDir}/dist`, { recursive: true });
cpSync(`${root}/LICENSE`, `${packageDir}/LICENSE`);
const { devDependencies, ...published } = descriptor;
writeFileSync(`${packageDir}/package.json`, `${JSON.stringify({ ...published, version }, null, 2)}\n`);
writeFileSync(`${packageDir}/SOURCE_COMMIT`, `${revision}\n`);
execFileSync('npm', ['pack', '--ignore-scripts', '--offline', '--pack-destination', work, packageDir], { stdio: 'inherit' });
const archive = `${work}/andornaut-art-kit-${version}.tgz`;
const install = `${work}/installed`;
mkdirSync(`${install}/node_modules/@andornaut`, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', `${install}/node_modules/@andornaut`]);
execFileSync('mv', [`${install}/node_modules/@andornaut/package`, `${install}/node_modules/@andornaut/art-kit`]);
for (const name of Object.keys(descriptor.peerDependencies)) {
  if (name.startsWith('@')) mkdirSync(`${install}/node_modules/${name.split('/')[0]}`, { recursive: true });
  symlinkSync(`/deps/${name}`, `${install}/node_modules/${name}`);
}
const installedManifest = JSON.parse(readFileSync(`${install}/node_modules/@andornaut/art-kit/package.json`));
if (readFileSync(`${install}/node_modules/@andornaut/art-kit/SOURCE_COMMIT`, 'utf8') !== `${revision}\n`) throw new Error('Installed source identity differs');
if (readdirSync(`${install}/node_modules/@andornaut/art-kit`, { recursive: true }).some(path => /(?:^|\/)fixtures(?:\/|$)|\.(?:ttf|otf|woff2?)$/i.test(path))) throw new Error('Font fixtures must not be published');
if (installedManifest.version !== version || existsSync(`${install}/node_modules/@andornaut/art-kit/src`)) throw new Error('Invalid compiled package');
// Existing image-codec consumers do not need optional rendering or font parsing.
for (const name of ['skia-canvas', 'fontkit']) unlinkSync(`${install}/node_modules/${name}`);
for (const subpath of ['atlasBuild', 'atlasLayout', 'draw', 'gif', 'ico', 'indexedPng', 'png', 'quantise', 'raster', 'rgbaImage', 'webp']) {
  execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(`@andornaut/art-kit/${subpath}`)})`], { cwd: install, stdio: 'inherit' });
}
for (const name of ['skia-canvas', 'fontkit']) symlinkSync(`/deps/${name}`, `${install}/node_modules/${name}`);
for (const subpath of Object.keys(descriptor.exports)) {
  execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(`@andornaut/art-kit/${subpath.slice(2)}`)})`], { cwd: install, stdio: 'inherit' });
}
const contractFile = `${install}/contracts.mts`;
writeFileSync(contractFile, Object.keys(descriptor.exports).map(path => `import * as ${path.slice(2)} from '@andornaut/art-kit/${path.slice(2)}';`).join('\n'));
execFileSync('node', ['/deps/typescript/bin/tsc', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--strict', '--skipLibCheck', '--noEmit', '--types', 'node', '--typeRoots', '/deps/@types', contractFile], { cwd: install, stdio: 'inherit' });
if (mode === 'check') {
  const tests = [];
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith('.test.mjs') || entry.name === 'tests.mjs') tests.push(path);
    }
  }
  collect(`${root}/node`);
  if (!tests.length) throw new Error('No Node package tests');
  const targets = tests.map((path, i) => {
    const target = `${install}/test-${i}.test.mjs`;
    cpSync(path, target);
    return target;
  });
  execFileSync('node', ['--test', '--test-concurrency=4', ...targets], { cwd: install, stdio: 'inherit' });
  cpSync(archive, `${out}/andornaut-art-kit-${version}.tgz`);
} else {
  const identity = `${out}/SOURCE_COMMIT`;
  if (existsSync(identity) && readFileSync(identity, 'utf8') !== `${revision}\n`) throw new Error('Existing SOURCE_COMMIT differs');
  const existing = readdirSync(out);
  if (existing.some(name => name.endsWith('.whl') && name !== `art_kit-${version}-py3-none-any.whl`) || existing.some(name => name.endsWith('.tgz'))) throw new Error('Unexpected or stale release artifact');
  const target = `${out}/art-kit-${version}.tgz`;
  if (existsSync(target)) throw new Error('Node artifact already exists');
  cpSync(archive, target);
  writeFileSync(identity, `${revision}\n`);
  const artifacts = readdirSync(out).filter(name => name.endsWith('.whl') || name.endsWith('.tgz') || name === 'SOURCE_COMMIT').sort();
  writeFileSync(`${out}/SHA256SUMS`, artifacts.map(name => `${createHash('sha256').update(readFileSync(`${out}/${name}`)).digest('hex')}  ${name}\n`).join(''));
}
