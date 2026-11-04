// Container orchestration for the check, packaging, provisioning and fixture commands.
// Usage: node scripts/container.mts <command> <arguments...>; the scripts/*.sh wrappers document each command.
// Host Node only assembles arguments, streams inputs and copies results; every test, build and download runs in a
// container as uid 19001, which owns nothing on the host. Host paths are read-only bind mounts readable through
// their group or world bits. Writable state lives in a per-run named volume at /tmp (copied up from the image's
// 1777 /tmp), results leave through docker cp as the host user, and the container and volume are removed on exit.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const PYTHON_IMAGE = 'python:3.12';
const NODE_IMAGE = 'node:24.21.0';

class Failure extends Error {
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

// Processes

const children = new Set<ChildProcess>();

interface RunOptions {
  /** Text written to stdin, or a running process whose stdout feeds stdin. */
  input?: string | ChildProcess;
  capture?: boolean;
}

function run(options: RunOptions, command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [options.input === undefined ? 'ignore' : 'pipe', options.capture ? 'pipe' : 'inherit', 'inherit'] });
    children.add(child);
    let stdout = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    // A consumer that exits early reports through its exit status, not a pipe error.
    child.stdin?.on('error', () => {});
    if (typeof options.input === 'string') child.stdin?.end(options.input);
    else if (options.input) options.input.stdout?.pipe(child.stdin!);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve(stdout);
      else reject(new Failure(`${command} ${args[0]} failed: ${signal ?? `exit ${code}`}`, code ?? 1));
    });
  });
}

/** Runs the consumer with the producer's stdout on its stdin; both must succeed. */
async function pipeline(producer: readonly string[], consumer: readonly string[]): Promise<void> {
  const source = spawn(producer[0], producer.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
  children.add(source);
  const produced = new Promise<void>((resolve, reject) => {
    source.on('error', reject);
    source.on('close', (code, signal) => {
      children.delete(source);
      if (code === 0) resolve();
      else reject(new Failure(`${producer[0]} ${producer[1]} failed: ${signal ?? `exit ${code}`}`, code ?? 1));
    });
  });
  await Promise.all([produced, run({ input: source }, consumer[0], consumer.slice(1))]);
}

function git(args: readonly string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) throw new Failure(`git ${args[0]} failed`);
  return result.stdout;
}

// Host guards

function requireIdle(): void {
  if (!(loadavg()[0] < 24)) throw new Failure('One-minute load must be below 24');
}

function fingerprint(): string {
  const hash = createHash('sha256').update(git(['status', '--porcelain=v1', '-z']));
  const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  for (const path of paths) {
    hash.update(`${path}\0`);
    try {
      hash.update(createHash('sha256').update(readFileSync(join(root, path))).digest());
    } catch (error) {
      hash.update(`unreadable:${(error as NodeJS.ErrnoException).code}`);
    }
  }
  return hash.digest('hex');
}

let sourceBefore: string | undefined;

/** Records Git status and listed file contents; verifySource fails if either changes before exit. */
function guardSource(): void {
  sourceBefore = fingerprint();
}

function verifySource(): void {
  if (sourceBefore === undefined) return;
  const before = sourceBefore;
  sourceBefore = undefined;
  if (fingerprint() !== before) throw new Failure('Source changed; discard result');
}

function emptyOutput(path: string): string {
  mkdirSync(path, { recursive: true });
  const output = realpathSync(path);
  if (readdirSync(output).length) throw new Failure('Output directory must be empty');
  return output;
}

function evidenceDirectory(prefix: string): string {
  mkdirSync(join(root, '.claude'), { recursive: true });
  return mkdtempSync(join(root, '.claude', `${prefix}.`));
}

function revision(): string {
  return git(['rev-parse', 'HEAD']).trim();
}

function projectVersion(pyproject: string): string {
  const version = pyproject.match(/^version = "([^"]+)"$/m)?.[1];
  if (!version) throw new Failure('Missing project version');
  return version;
}

// Containers

const containers = new Set<string>();

interface Container {
  readonly name: string;
}

interface ContainerSpec {
  network: 'none' | 'bridge';
  /** [host source, container target] pairs, each bound read-only with its group added. */
  mounts?: ReadonlyArray<readonly [string, string]>;
  env?: Readonly<Record<string, string>>;
  workdir?: string;
}

function policyArguments(spec: ContainerSpec, name: string): string[] {
  const args = ['--name', name, '--network', spec.network, '--read-only', '--cpus', '4',
    '--user', '19001:19001', '-e', 'HOME=/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=volume,source=${name},target=/tmp`, '-w', spec.workdir ?? '/tmp'];
  for (const [source, target] of spec.mounts ?? []) {
    args.push('--mount', `type=bind,source=${source},target=${target},readonly`, '--group-add', String(statSync(source).gid));
  }
  for (const [key, value] of Object.entries(spec.env ?? {})) args.push('-e', `${key}=${value}`);
  return args;
}

function remove(name: string): void {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', name], { stdio: 'ignore' });
  containers.delete(name);
}

/** Starts an idle policy container, runs body against it and removes the container and its volume. */
async function withContainer<T>(spec: ContainerSpec, prefix: string, image: string, body: (container: Container) => Promise<T>): Promise<T> {
  const name = `${prefix}-${process.pid}-${randomInt(1 << 30)}`;
  containers.add(name);
  try {
    await run({ capture: true }, 'docker', ['run', '--detach', ...policyArguments(spec, name), image, 'sleep', 'infinity']);
    return await body({ name });
  } finally {
    remove(name);
  }
}

interface ExecOptions extends RunOptions {
  workdir?: string;
  env?: Readonly<Record<string, string>>;
}

function exec(options: ExecOptions, container: Container, command: readonly string[]): Promise<string> {
  const args = ['exec'];
  if (options.input !== undefined) args.push('-i');
  if (options.workdir) args.push('-w', options.workdir);
  for (const [key, value] of Object.entries(options.env ?? {})) args.push('-e', `${key}=${value}`);
  return run(options, 'docker', [...args, container.name, ...command]);
}

/** Streams the archive of the given paths at revision into directory inside the container. */
function extractArchive(container: Container, revision: string, paths: readonly string[], directory: string): Promise<void> {
  return pipeline(['git', '-C', root, 'archive', revision, ...paths], ['docker', 'exec', '-i', container.name, 'tar', '-x', '-C', directory]);
}

/** Writes text to a container path with mode 0644 under the container umask. */
async function writeFile(container: Container, path: string, text: string): Promise<void> {
  await exec({ input: text, capture: true }, container, ['tee', path]);
}

function copyOut(container: Container, source: string, destination: string): Promise<string> {
  return run({}, 'docker', ['cp', `${container.name}:${source}`, destination]);
}

function cleanup(): void {
  for (const child of children) child.kill('SIGTERM');
  for (const name of [...containers]) remove(name);
}

process.on('exit', cleanup);
for (const [signal, number] of [['SIGHUP', 1], ['SIGINT', 2], ['SIGTERM', 15]] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(128 + number);
  });
}

// Python commands, removed with the Python package.

const VENV_PYTHON = '/tmp/venv/bin/python';
const SITE_PACKAGES = '/tmp/venv/lib/python3.12/site-packages';

function createVenv(container: Container, systemSitePackages: boolean): Promise<string> {
  return exec({}, container, ['python', '-I', '-m', 'venv', ...(systemSitePackages ? ['--system-site-packages', '--without-pip'] : []), '/tmp/venv']);
}

// Isolated Python ignores PYTHONPATH, so a venv .pth file adds read-only dependency and source paths.
function addPaths(container: Container, pth: string, paths: readonly string[]): Promise<void> {
  return writeFile(container, `${SITE_PACKAGES}/${pth}`, paths.map(path => `${path}\n`).join(''));
}

const BUILD_PINS = `import importlib.metadata as metadata
import re
import tomllib
from pathlib import Path

normalise = lambda name: re.sub(r"[-_.]+", "-", name).lower()
installed = {normalise(dist.metadata["Name"]): dist.version for dist in metadata.distributions(path=["/build-deps"])}
requirements = tomllib.loads(Path("pyproject.toml").read_text())["build-system"]["requires"]
for requirement in requirements:
    pin = re.fullmatch(r"([A-Za-z0-9_.-]+)==([^*<>=!~;\\s]+)", requirement)
    if pin is None:
        raise SystemExit(f"Build dependency must use an exact version pin: {requirement}")
    name, expected = pin.groups()
    actual = installed.get(normalise(name), "missing")
    if actual != expected:
        raise SystemExit(f"Build dependency {name}: expected {expected}, actual {actual} in /build-deps")
`;

const WHEEL_IDENTITY = `import glob, tomllib, zipfile
from email.parser import BytesParser
from pathlib import Path
version = tomllib.loads(Path("/tmp/package/pyproject.toml").read_text())["project"]["version"]
wheels = glob.glob("art_kit-*.whl")
assert wheels == [f"art_kit-{version}-py3-none-any.whl"], wheels
with zipfile.ZipFile(wheels[0]) as wheel:
    assert wheel.read("art_kit/SOURCE_COMMIT") == Path("SOURCE_COMMIT").read_bytes()
    metadata = BytesParser().parsebytes(wheel.read(f"art_kit-{version}.dist-info/METADATA"))
    assert metadata["Name"] == "art-kit" and metadata["Version"] == version
`;

const INSTALLED_WHEEL = `import importlib.metadata as m, os, pathlib, sys
import art_kit
from art_kit import aseprite, colour, fonts, frames, grid
import PIL
package = pathlib.Path(art_kit.__file__).resolve().parent
assert package.is_relative_to(pathlib.Path(sys.prefix))
assert (package / "SOURCE_COMMIT").read_text().strip() == os.environ["EXPECTED_COMMIT"]
assert m.version("art-kit") == os.environ["EXPECTED_VERSION"]
assert PIL.__version__ == "13.0.0"
`;

async function check(pillowPath: string, ruffPath: string, buildPath: string): Promise<void> {
  const [pillow, ruff, build] = [pillowPath, ruffPath, buildPath].map(path => realpathSync(path));
  requireIdle();
  const evidence = evidenceDirectory('check');
  guardSource();
  const spec: ContainerSpec = {
    network: 'none', workdir: '/app', env: { PYTHONDONTWRITEBYTECODE: '1' },
    mounts: [[root, '/app'], [pillow, '/deps'], [ruff, '/ruff'], [build, '/build-deps']],
  };
  await withContainer(spec, 'art-kit-check', PYTHON_IMAGE, async container => {
    await createVenv(container, true);
    await addPaths(container, 'art-kit.pth', ['/deps', '/build-deps', '/app/src']);
    const ruffVersion = (await exec({ capture: true }, container, ['/ruff', '--version'])).trim();
    if (ruffVersion !== 'ruff 0.17.2') throw new Failure(`Expected ruff 0.17.2, actual ${ruffVersion}`);
    console.log(ruffVersion);
    await exec({}, container, [VENV_PYTHON, '-I', '-c', "import PIL; assert PIL.__version__ == '13.0.0'"]);
    await exec({}, container, ['/ruff', 'check', '--no-cache', '.']);
    await exec({}, container, ['/ruff', 'format', '--check', '--no-cache', '.']);
    await exec({}, container, [VENV_PYTHON, '-I', '-m', 'unittest', 'discover', '-s', 'tests', '-v']);
    await exec({}, container, ['mkdir', '-p', '/tmp/package', '/tmp/out/wheels']);
    await exec({}, container, ['cp', '/app/pyproject.toml', '/app/README.md', '/app/LICENSE', '/tmp/package/']);
    await exec({}, container, ['cp', '-R', '/app/src', '/tmp/package/']);
    await exec({}, container, [VENV_PYTHON, '-I', '-m', 'pip', 'wheel', '--no-build-isolation', '--no-deps', '--no-index', '/tmp/package', '--wheel-dir', '/tmp/out/wheels']);
    await exec({}, container, [VENV_PYTHON, '-I', '-c', "import importlib.metadata as m; print({p:m.version(p) for p in ['Pillow','setuptools','wheel']})"]);
    await copyOut(container, '/tmp/out/.', evidence);
  });
  verifySource();
  console.log(`Check evidence: ${evidence}`);
}

async function pack(buildPath: string, outputPath: string): Promise<void> {
  const build = realpathSync(buildPath);
  requireIdle();
  const output = emptyOutput(outputPath);
  guardSource();
  const commit = revision();
  const epoch = git(['show', '-s', '--format=%ct', commit]).trim();
  const wheel = `art_kit-${projectVersion(git(['show', `${commit}:pyproject.toml`]))}-py3-none-any.whl`;
  const spec: ContainerSpec = { network: 'none', env: { SOURCE_DATE_EPOCH: epoch }, mounts: [[build, '/build-deps']] };
  await withContainer(spec, 'art-kit-pack', PYTHON_IMAGE, async container => {
    await exec({}, container, ['mkdir', '-p', '/tmp/package', '/tmp/out']);
    await extractArchive(container, commit, ['src', 'pyproject.toml', 'README.md', 'LICENSE'], '/tmp/package');
    await writeFile(container, '/tmp/package/src/art_kit/SOURCE_COMMIT', `${commit}\n`);
    await createVenv(container, true);
    await addPaths(container, 'art-build.pth', ['/build-deps']);
    await exec({ workdir: '/tmp/package' }, container, [VENV_PYTHON, '-I', '-c', BUILD_PINS]);
    await exec({ workdir: '/tmp/package' }, container, [VENV_PYTHON, '-I', '-m', 'pip', 'wheel', '--no-build-isolation', '--no-deps', '--no-index', '/tmp/package', '--wheel-dir', '/tmp/out']);
    await exec({}, container, ['cp', '/tmp/package/src/art_kit/SOURCE_COMMIT', '/tmp/out/SOURCE_COMMIT']);
    await exec({ workdir: '/tmp/out' }, container, [VENV_PYTHON, '-I', '-c', WHEEL_IDENTITY]);
    const sums = await exec({ workdir: '/tmp/out', capture: true }, container, ['sha256sum', wheel, 'SOURCE_COMMIT']);
    await writeFile(container, '/tmp/out/SHA256SUMS', sums);
    await copyOut(container, '/tmp/out/.', output);
  });
  verifySource();
  console.log(`Release artifacts: ${output}`);
}

async function verifyWheel(pillowPath: string, releasePath: string, expectedCommit: string): Promise<void> {
  const [pillow, release] = [pillowPath, releasePath].map(path => realpathSync(path));
  requireIdle();
  guardSource();
  const expectedVersion = projectVersion(readFileSync(join(root, 'pyproject.toml'), 'utf8'));
  if (readFileSync(join(release, 'SOURCE_COMMIT'), 'utf8').replace(/\n+$/, '') !== expectedCommit) throw new Failure('SOURCE_COMMIT differs from the expected commit');
  const wheels = readdirSync(release).filter(name => /^art_kit-.*\.whl$/.test(name)).sort();
  if (!wheels.length) throw new Failure('Missing wheel');
  const spec: ContainerSpec = { network: 'none', mounts: [[release, '/release'], [pillow, '/deps']] };
  await withContainer(spec, 'art-kit-verify-wheel', PYTHON_IMAGE, async container => {
    await exec({ workdir: '/release' }, container, ['sha256sum', '--check', 'SHA256SUMS']);
    await createVenv(container, false);
    await exec({}, container, [VENV_PYTHON, '-I', '-m', 'pip', 'install', '--no-index', '--no-deps', ...wheels.map(name => `/release/${name}`)]);
    await addPaths(container, 'pillow.pth', ['/deps']);
    await exec({ env: { EXPECTED_COMMIT: expectedCommit, EXPECTED_VERSION: expectedVersion } }, container, [VENV_PYTHON, '-I', '-c', INSTALLED_WHEEL]);
  });
  verifySource();
  console.log(`Verified wheel: ${release}`);
}

async function drawFixtures(pillowPath: string): Promise<void> {
  const pillow = realpathSync(pillowPath);
  requireIdle();
  const spec: ContainerSpec = { network: 'none', env: { PYTHONDONTWRITEBYTECODE: '1' }, mounts: [[join(root, 'node/tests'), '/tests'], [pillow, '/deps']] };
  await withContainer(spec, 'art-kit-draw-fixtures', PYTHON_IMAGE, async container => {
    await createVenv(container, true);
    await addPaths(container, 'draw-deps.pth', ['/deps']);
    await exec({}, container, ['mkdir', '/tmp/out']);
    await exec({}, container, [VENV_PYTHON, '-I', '/tests/draw_fixtures.py', '/tmp/out/draw.json']);
    await copyOut(container, '/tmp/out/draw.json', join(root, 'node/tests/fixtures/draw.json'));
  });
}

// Python art_kit fonts.pack and bmfont_xml references for the packed glyph atlas layout. The v0.10.0 and v0.5.0
// modules stream from git show into the container.
async function bmfontFixtures(pillowPath: string): Promise<void> {
  const pillow = realpathSync(pillowPath);
  requireIdle();
  const references = { 'fonts_v0100.py': 'v0.10.0', 'fonts_v050.py': 'v0.5.0' };
  const spec: ContainerSpec = { network: 'none', env: { PYTHONDONTWRITEBYTECODE: '1' }, mounts: [[join(root, 'node/tests'), '/tests'], [pillow, '/deps']] };
  await withContainer(spec, 'art-kit-bmfont-fixtures', PYTHON_IMAGE, async container => {
    await createVenv(container, true);
    await addPaths(container, 'bmfont-deps.pth', ['/deps']);
    await exec({}, container, ['mkdir', '/tmp/out', '/tmp/references']);
    for (const [name, tag] of Object.entries(references))
      await writeFile(container, `/tmp/references/${name}`, git(['show', `${tag}:src/art_kit/fonts.py`]));
    await exec({}, container, [VENV_PYTHON, '-I', '/tests/bmfont_fixtures.py', '/tmp/references', '/tests/fixtures', '/tmp/out/bmfont-packed.json']);
    await copyOut(container, '/tmp/out/bmfont-packed.json', join(root, 'node/tests/fixtures/bmfont-packed.json'));
  });
}

/** Adds group read, and group search where any execute bit is set, as chmod -R g+rX does. */
function grantGroupRead(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  chmodSync(path, stat.mode | 0o040 | (stat.isDirectory() || stat.mode & 0o111 ? 0o010 : 0));
  if (stat.isDirectory()) for (const name of readdirSync(path)) grantGroupRead(join(path, name));
}

// Pillow 13.0.0 references for the GIF and ICO encoders. generate rewrites pillow.json from Pillow's decodes of
// its own saves; crosscheck encodes the fixture inputs with the current Node source and compares Pillow's decodes.
async function pillowReference(mode: string, provisionPath: string): Promise<void> {
  if (mode !== 'generate' && mode !== 'crosscheck') throw new Failure(`Usage: container.mts ${USAGE.pillow}`, 2);
  const provision = realpathSync(provisionPath);
  const fixture = '/app/node/tests/fixtures/gif-ico';
  const reference = '/app/tests/gif_ico_reference.py';
  requireIdle();
  const python = (mounts: ReadonlyArray<readonly [string, string]>): ContainerSpec => ({
    network: 'none', env: { PYTHONPATH: '/deps', PYTHONDONTWRITEBYTECODE: '1' },
    mounts: [[root, '/app'], [join(provision, 'python'), '/deps'], ...mounts],
  });
  if (mode === 'generate') {
    const target = join(root, 'node/tests/fixtures/gif-ico/pillow.json');
    await withContainer(python([]), 'art-kit-pillow-generate', PYTHON_IMAGE, async container => {
      await exec({}, container, ['python', reference, 'generate', '/tmp/pillow.json']);
      await copyOut(container, '/tmp/pillow.json', target);
    });
    console.log(`Generated: ${target}`);
    return;
  }
  guardSource();
  const encoded = evidenceDirectory('pillow');
  const node: ContainerSpec = { network: 'none', mounts: [[root, '/app'], [join(provision, 'node/node_modules'), '/deps']] };
  await withContainer(node, 'art-kit-pillow-encode', NODE_IMAGE, async container => {
    await exec({}, container, ['mkdir', '/tmp/src']);
    await exec({}, container, ['cp', '-R', '/app/node/src', '/app/node/tsconfig.json', '/app/node/package.json', '/tmp/src/']);
    await exec({}, container, ['ln', '-s', '/deps', '/tmp/src/node_modules']);
    await exec({}, container, ['node', '/deps/typescript/bin/tsc', '-p', '/tmp/src/tsconfig.json']);
    await exec({}, container, ['node', `${fixture}/encode.mjs`, '/tmp/src/dist', `${fixture}/pillow.json`, '/tmp/out']);
    await copyOut(container, '/tmp/out/.', encoded);
  });
  grantGroupRead(encoded);
  await withContainer(python([[encoded, '/encoded']]), 'art-kit-pillow-crosscheck', PYTHON_IMAGE, async container => {
    await exec({}, container, ['python', reference, 'crosscheck', `${fixture}/pillow.json`, '/encoded']);
  });
  verifySource();
  console.log(`Encoded: ${encoded}`);
}

// Node commands

interface Descriptor {
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

async function checkNode(dependencyPath: string): Promise<void> {
  const dependencies = realpathSync(dependencyPath);
  requireIdle();
  const evidence = evidenceDirectory('node');
  guardSource();
  const commit = revision();
  const spec: ContainerSpec = {
    network: 'none', mounts: [[root, '/app'], [dependencies, '/deps']],
    env: { npm_config_cache: '/tmp/npm-cache', ART_KIT_TEST_FONTS: '/tmp/work/source/node/tests/fixtures' },
  };
  await withContainer(spec, 'art-kit-node', NODE_IMAGE, async container => {
    await exec({}, container, ['mkdir', '-p', '/tmp/work/source', '/tmp/out']);
    await exec({}, container, ['cp', '-R', '/app/node', '/app/pyproject.toml', '/app/LICENSE', '/tmp/work/source/']);
    await exec({}, container, ['node', '/app/scripts/node-package.mts', 'check', commit]);
    await copyOut(container, '/tmp/out/.', evidence);
  });
  verifySource();
  console.log(`Node evidence: ${evidence}`);
}

async function packNode(dependencyPath: string, outputPath: string): Promise<void> {
  const [dependencies, output] = [dependencyPath, outputPath].map(path => realpathSync(path));
  requireIdle();
  guardSource();
  const commit = revision();
  const tarball = `art-kit-${projectVersion(git(['show', `${commit}:pyproject.toml`]))}.tgz`;
  // The packaging program comes from this checkout; the packaged tree is the committed revision.
  const spec: ContainerSpec = {
    network: 'none', env: { npm_config_cache: '/tmp/npm-cache' },
    mounts: [[dependencies, '/deps'], [output, '/release'], [join(root, 'scripts/node-package.mts'), '/tools/node-package.mts']],
  };
  await withContainer(spec, 'art-kit-pack-node', NODE_IMAGE, async container => {
    await exec({}, container, ['mkdir', '-p', '/tmp/work/source', '/tmp/out']);
    await extractArchive(container, commit, ['node', 'pyproject.toml', 'LICENSE'], '/tmp/work/source');
    await exec({}, container, ['cp', '-R', '/release/.', '/tmp/out/']);
    await exec({}, container, ['node', '/tools/node-package.mts', 'pack', commit]);
    await copyOut(container, `/tmp/out/${tarball}`, join(output, tarball));
    await copyOut(container, '/tmp/out/SHA256SUMS', join(output, 'SHA256SUMS'));
  });
  verifySource();
  console.log(`Release artifacts: ${output}`);
}

async function provision(outputPath: string): Promise<void> {
  requireIdle();
  const output = emptyOutput(outputPath);
  await withContainer({ network: 'bridge' }, 'art-kit-provision-python', PYTHON_IMAGE, async container => {
    await exec({}, container, ['python', '-I', '-m', 'pip', 'install', '--no-cache-dir', '--target', '/tmp/python', 'Pillow==13.0.0', 'ruff==0.17.2', 'setuptools==84.2.1', 'wheel==0.48.0']);
    await copyOut(container, '/tmp/python', join(output, 'python'));
  });
  const descriptor: Descriptor = JSON.parse(readFileSync(join(root, 'node/package.json'), 'utf8'));
  const manifest = JSON.stringify({ private: true, dependencies: { ...descriptor.devDependencies, ...descriptor.peerDependencies } });
  await withContainer({ network: 'bridge' }, 'art-kit-provision-node', NODE_IMAGE, async container => {
    await exec({}, container, ['mkdir', '/tmp/tools']);
    await writeFile(container, '/tmp/tools/package.json', manifest);
    await exec({ workdir: '/tmp/tools' }, container, ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', '/tmp/npm-cache']);
    await exec({ workdir: '/tmp/tools/node_modules/skia-canvas' }, container, ['node', 'lib/prebuild.mjs', 'download']);
    mkdirSync(join(output, 'node'));
    await copyOut(container, '/tmp/tools/node_modules', join(output, 'node/node_modules'));
  });
  console.log(`Dependencies: ${output}/python and ${output}/node/node_modules`);
}

// Entry point

const USAGE = {
  check: 'check <Pillow dependency directory> <Ruff binary> <build dependency directory>',
  'check-node': 'check-node <node_modules-directory>',
  pack: 'pack <build-dependency-directory> <output-directory>',
  'pack-node': 'pack-node <node_modules-directory> <output-directory>',
  provision: 'provision <output-directory>',
  'verify-wheel': 'verify-wheel <Pillow dependency directory> <release directory> <expected commit>',
  'draw-fixtures': 'draw-fixtures <Pillow dependency directory>',
  'bmfont-fixtures': 'bmfont-fixtures <Pillow dependency directory>',
  pillow: 'pillow <generate|crosscheck> <provision-directory>',
} as const;

const COMMANDS: Record<keyof typeof USAGE, (...args: string[]) => Promise<void>> = {
  check, 'check-node': checkNode, pack, 'pack-node': packNode, provision,
  'verify-wheel': verifyWheel, 'draw-fixtures': drawFixtures, 'bmfont-fixtures': bmfontFixtures,
  pillow: pillowReference,
};

const [command, ...args] = process.argv.slice(2);
try {
  if (!Object.hasOwn(COMMANDS, command)) throw new Failure(`Usage: container.mts <${Object.keys(USAGE).join('|')}> ...`, 2);
  const name = command as keyof typeof USAGE;
  const handler = COMMANDS[name];
  if (args.length !== handler.length) throw new Failure(`Usage: container.mts ${USAGE[name]}`, 2);
  await handler(...args);
} catch (error) {
  console.error(error instanceof Failure ? error.message : error);
  process.exitCode = error instanceof Failure ? error.code : 1;
} finally {
  cleanup();
  try {
    verifySource();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
