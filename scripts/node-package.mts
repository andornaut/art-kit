import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Descriptor {
  version: string;
  exports: Record<string, unknown>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

// Subpaths that import the optional Skia peer; every other export must import without the optional peers.
const SKIA_SUBPATHS = ['fonts', 'frames', 'generate'];

const [mode, revision] = process.argv.slice(2);
if (!['check', 'pack'].includes(mode)) throw new Error('Expected check or pack mode');
// Dependencies are mounted outside a conventional node_modules directory.
process.env.NODE_PATH = '/deps';
// Inputs and outputs live in the container's writable /tmp volume; the caller copies /tmp/out out.
const work = '/tmp/work';
const out = '/tmp/out';
const root = `${work}/source`;
const descriptor: Descriptor = JSON.parse(readFileSync(`${root}/node/package.json`, 'utf8'));
for (const [name, expected] of Object.entries<string>({ ...descriptor.devDependencies, ...descriptor.peerDependencies })) {
  const actual = JSON.parse(readFileSync(`/deps/${name}/package.json`, 'utf8')).version;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, actual ${actual}`);
}
const { version } = descriptor;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Missing or invalid package version');
symlinkSync('/deps', `${root}/node/node_modules`);
execFileSync('node', ['/deps/typescript/bin/tsc', '-p', `${root}/node/tsconfig.json`], { stdio: 'inherit' });
const packageDir = `${work}/package`;
mkdirSync(packageDir);
cpSync(`${root}/node/dist`, `${packageDir}/dist`, { recursive: true });
cpSync(`${root}/LICENSE`, `${packageDir}/LICENSE`);
const { devDependencies, ...published } = descriptor;
writeFileSync(`${packageDir}/package.json`, `${JSON.stringify(published, null, 2)}\n`);
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
const installedManifest = JSON.parse(readFileSync(`${install}/node_modules/@andornaut/art-kit/package.json`, 'utf8'));
if (readFileSync(`${install}/node_modules/@andornaut/art-kit/SOURCE_COMMIT`, 'utf8') !== `${revision}\n`) throw new Error('Installed source identity differs');
if (readdirSync(`${install}/node_modules/@andornaut/art-kit`, { encoding: 'utf8', recursive: true }).some(path => /(?:^|\/)fixtures(?:\/|$)|\.(?:ttf|otf|woff2?)$/i.test(path))) throw new Error('Font fixtures must not be published');
if (installedManifest.version !== version || existsSync(`${install}/node_modules/@andornaut/art-kit/src`)) throw new Error('Invalid compiled package');
const subpaths = Object.keys(descriptor.exports).map(path => path.slice(2));
for (const subpath of SKIA_SUBPATHS) if (!subpaths.includes(subpath)) throw new Error(`Skia subpath ${subpath} is not exported`);
const optionalPeers = Object.keys(descriptor.peerDependenciesMeta ?? {}).filter(name => descriptor.peerDependenciesMeta?.[name].optional);
for (const name of optionalPeers) unlinkSync(`${install}/node_modules/${name}`);
for (const subpath of subpaths.filter(subpath => !SKIA_SUBPATHS.includes(subpath))) {
  execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(`@andornaut/art-kit/${subpath}`)})`], { cwd: install, stdio: 'inherit' });
}
for (const name of optionalPeers) symlinkSync(`/deps/${name}`, `${install}/node_modules/${name}`);
for (const subpath of subpaths) {
  execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(`@andornaut/art-kit/${subpath}`)})`], { cwd: install, stdio: 'inherit' });
}
const contractFile = `${install}/contracts.mts`;
writeFileSync(contractFile, subpaths.map(subpath => `import * as ${subpath} from '@andornaut/art-kit/${subpath}';`).join('\n'));
execFileSync('node', ['/deps/typescript/bin/tsc', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--strict', '--skipLibCheck', '--noEmit', '--types', 'node', '--typeRoots', '/deps/@types', contractFile], { cwd: install, stdio: 'inherit' });
if (mode === 'check') {
  const tests: string[] = [];
  function collect(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith('.test.mjs')) tests.push(path);
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
  const tarball = `art-kit-${version}.tgz`;
  cpSync(archive, `${out}/${tarball}`);
  writeFileSync(`${out}/SOURCE_COMMIT`, `${revision}\n`);
  writeFileSync(`${out}/SHA256SUMS`, [tarball, 'SOURCE_COMMIT'].map(name => `${createHash('sha256').update(readFileSync(`${out}/${name}`)).digest('hex')}  ${name}\n`).join(''));
}
