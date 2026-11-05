// Container orchestration for the check, packaging and provisioning commands.
// Usage: node scripts/container.mts <command> <arguments...>; the scripts/*.sh wrappers document each command.
// Host Node only assembles arguments, streams inputs and copies results; every test, build and download runs in a
// container as uid 19001, which owns nothing on the host. Host paths are read-only bind mounts readable through
// their group or world bits. Writable state lives in a per-run named volume at /tmp (copied up from the image's
// 1777 /tmp), results leave through docker cp as the host user, and the container and volume are removed on exit.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const NODE_IMAGE = "node:24.21.0";

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
    const child = spawn(command, args, {
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        options.capture ? "pipe" : "inherit",
        "inherit",
      ],
    });
    children.add(child);
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    // A consumer that exits early reports through its exit status, not a pipe error.
    child.stdin?.on("error", () => {});
    if (typeof options.input === "string") {
      child.stdin?.end(options.input);
    } else if (options.input) {
      options.input.stdout?.pipe(child.stdin!);
    }
    child.on("error", reject);
    child.on("close", (code, signal) => {
      children.delete(child);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Failure(`${command} ${args[0]} failed: ${signal ?? `exit ${code}`}`, code ?? 1));
      }
    });
  });
}

/** Runs the consumer with the producer's stdout on its stdin; both must succeed. */
async function pipeline(producer: readonly string[], consumer: readonly string[]): Promise<void> {
  const source = spawn(producer[0], producer.slice(1), { stdio: ["ignore", "pipe", "inherit"] });
  children.add(source);
  const produced = new Promise<void>((resolve, reject) => {
    source.on("error", reject);
    source.on("close", (code, signal) => {
      children.delete(source);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Failure(
            `${producer[0]} ${producer[1]} failed: ${signal ?? `exit ${code}`}`,
            code ?? 1,
          ),
        );
      }
    });
  });
  await Promise.all([produced, run({ input: source }, consumer[0], consumer.slice(1))]);
}

function git(args: readonly string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    throw new Failure(`git ${args[0]} failed`);
  }
  return result.stdout;
}

// Host guards

function requireIdle(): void {
  if (!(loadavg()[0] < 24)) {
    throw new Failure("One-minute load must be below 24");
  }
}

function fingerprint(): string {
  const hash = createHash("sha256").update(git(["status", "--porcelain=v1", "-z"]));
  const paths = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const path of paths) {
    hash.update(`${path}\0`);
    try {
      hash.update(
        createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest(),
      );
    } catch (error) {
      hash.update(`unreadable:${(error as NodeJS.ErrnoException).code}`);
    }
  }
  return hash.digest("hex");
}

let sourceBefore: string | undefined;

/** Records Git status and listed file contents; verifySource fails if either changes before exit. */
function guardSource(): void {
  sourceBefore = fingerprint();
}

function verifySource(): void {
  if (sourceBefore === undefined) {
    return;
  }
  const before = sourceBefore;
  sourceBefore = undefined;
  if (fingerprint() !== before) {
    throw new Failure("Source changed; discard result");
  }
}

function emptyOutput(path: string): string {
  mkdirSync(path, { recursive: true });
  const output = realpathSync(path);
  if (readdirSync(output).length) {
    throw new Failure("Output directory must be empty");
  }
  return output;
}

function evidenceDirectory(prefix: string): string {
  mkdirSync(join(root, ".claude"), { recursive: true });
  return mkdtempSync(join(root, ".claude", `${prefix}.`));
}

function revision(): string {
  return git(["rev-parse", "HEAD"]).trim();
}

// Containers

const containers = new Set<string>();

interface Container {
  readonly name: string;
}

interface ContainerSpec {
  network: "none" | "bridge";
  /** [host source, container target] pairs, each bound read-only with its group added. */
  mounts?: ReadonlyArray<readonly [string, string]>;
  env?: Readonly<Record<string, string>>;
  /** Open-file limit, soft and hard; the image default when omitted. */
  nofile?: number;
}

function policyArguments(spec: ContainerSpec, name: string): string[] {
  const args = [
    "--name",
    name,
    "--network",
    spec.network,
    "--read-only",
    "--cpus",
    "4",
    "--user",
    "19001:19001",
    "-e",
    "HOME=/tmp",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=volume,source=${name},target=/tmp`,
    "-w",
    "/tmp",
  ];
  if (spec.nofile !== undefined) {
    args.push("--ulimit", `nofile=${spec.nofile}:${spec.nofile}`);
  }
  for (const [source, target] of spec.mounts ?? []) {
    args.push(
      "--mount",
      `type=bind,source=${source},target=${target},readonly`,
      "--group-add",
      String(statSync(source).gid),
    );
  }
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

function remove(name: string): void {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  spawnSync("docker", ["volume", "rm", name], { stdio: "ignore" });
  containers.delete(name);
}

/** Starts an idle policy container, runs body against it and removes the container and its volume. */
async function withContainer<T>(
  spec: ContainerSpec,
  prefix: string,
  image: string,
  body: (container: Container) => Promise<T>,
): Promise<T> {
  const name = `${prefix}-${process.pid}-${randomInt(1 << 30)}`;
  containers.add(name);
  try {
    await run({ capture: true }, "docker", [
      "run",
      "--detach",
      ...policyArguments(spec, name),
      image,
      "sleep",
      "infinity",
    ]);
    return await body({ name });
  } finally {
    remove(name);
  }
}

interface ExecOptions extends RunOptions {
  workdir?: string;
}

function exec(
  options: ExecOptions,
  container: Container,
  command: readonly string[],
): Promise<string> {
  const args = ["exec"];
  if (options.input !== undefined) {
    args.push("-i");
  }
  if (options.workdir) {
    args.push("-w", options.workdir);
  }
  return run(options, "docker", [...args, container.name, ...command]);
}

/** Streams the archive of the given paths at revision into directory inside the container. */
function extractArchive(
  container: Container,
  revision: string,
  paths: readonly string[],
  directory: string,
): Promise<void> {
  return pipeline(
    ["git", "-C", root, "archive", revision, ...paths],
    ["docker", "exec", "-i", container.name, "tar", "-x", "-C", directory],
  );
}

/** Writes text to a container path with mode 0644 under the container umask. */
async function writeFile(container: Container, path: string, text: string): Promise<void> {
  await exec({ input: text, capture: true }, container, ["tee", path]);
}

function copyOut(container: Container, source: string, destination: string): Promise<string> {
  return run({}, "docker", ["cp", `${container.name}:${source}`, destination]);
}

function cleanup(): void {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  for (const name of [...containers]) {
    remove(name);
  }
}

process.on("exit", cleanup);
for (const [signal, number] of [
  ["SIGHUP", 1],
  ["SIGINT", 2],
  ["SIGTERM", 15],
] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(128 + number);
  });
}

// Commands

interface Descriptor {
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

async function check(dependencyPath: string): Promise<void> {
  const dependencies = realpathSync(dependencyPath);
  requireIdle();
  const evidence = evidenceDirectory("check");
  guardSource();
  const commit = revision();
  // The listed top-level entries, so the format and lint gates see the whole tree.
  const entries = [
    ...new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean)
        .map((path) => path.split("/")[0]),
    ),
  ];
  const spec: ContainerSpec = {
    network: "none",
    mounts: [
      [root, "/app"],
      [dependencies, "/deps"],
    ],
    env: {
      npm_config_cache: "/tmp/npm-cache",
      ART_KIT_TEST_FIXTURES: "/tmp/work/source/node/tests/fixtures",
    },
    // A low open-file limit, so the tests catch code that opens every input at once.
    nofile: 256,
  };
  await withContainer(spec, "art-kit-check", NODE_IMAGE, async (container) => {
    await exec({}, container, ["mkdir", "-p", "/tmp/work/source", "/tmp/out"]);
    await exec({}, container, [
      "cp",
      "-R",
      ...entries.map((entry) => `/app/${entry}`),
      "/tmp/work/source/",
    ]);
    await exec({}, container, ["node", "/app/scripts/node-package.mts", "check", commit]);
    await copyOut(container, "/tmp/out/.", evidence);
  });
  verifySource();
  console.log(`Check evidence: ${evidence}`);
}

async function pack(dependencyPath: string, outputPath: string): Promise<void> {
  const dependencies = realpathSync(dependencyPath);
  requireIdle();
  const output = emptyOutput(outputPath);
  guardSource();
  const commit = revision();
  // The packaging program comes from this checkout; the packaged tree is the committed revision.
  const spec: ContainerSpec = {
    network: "none",
    env: { npm_config_cache: "/tmp/npm-cache" },
    mounts: [
      [dependencies, "/deps"],
      [join(root, "scripts/node-package.mts"), "/tools/node-package.mts"],
    ],
  };
  await withContainer(spec, "art-kit-pack", NODE_IMAGE, async (container) => {
    await exec({}, container, ["mkdir", "-p", "/tmp/work/source", "/tmp/out"]);
    await extractArchive(container, commit, ["node", "LICENSE"], "/tmp/work/source");
    await exec({}, container, ["node", "/tools/node-package.mts", "pack", commit]);
    await copyOut(container, "/tmp/out/.", output);
  });
  verifySource();
  console.log(`Release artifacts: ${output}`);
}

async function provision(outputPath: string): Promise<void> {
  requireIdle();
  const output = emptyOutput(outputPath);
  const descriptor: Descriptor = JSON.parse(readFileSync(join(root, "node/package.json"), "utf8"));
  const manifest = JSON.stringify({
    private: true,
    dependencies: { ...descriptor.devDependencies, ...descriptor.peerDependencies },
  });
  await withContainer({ network: "bridge" }, "art-kit-provision", NODE_IMAGE, async (container) => {
    await exec({}, container, ["mkdir", "/tmp/tools"]);
    await writeFile(container, "/tmp/tools/package.json", manifest);
    await exec({ workdir: "/tmp/tools" }, container, [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      "/tmp/npm-cache",
    ]);
    await exec({ workdir: "/tmp/tools/node_modules/skia-canvas" }, container, [
      "node",
      "lib/prebuild.mjs",
      "download",
    ]);
    mkdirSync(join(output, "node"));
    await copyOut(container, "/tmp/tools/node_modules", join(output, "node/node_modules"));
  });
  console.log(`Dependencies: ${output}/node/node_modules`);
}

// Entry point

const USAGE = {
  check: "check <node_modules-directory>",
  pack: "pack <node_modules-directory> <output-directory>",
  provision: "provision <output-directory>",
} as const;

const COMMANDS: Record<keyof typeof USAGE, (...args: string[]) => Promise<void>> = {
  check,
  pack,
  provision,
};

const [command, ...args] = process.argv.slice(2);
try {
  if (!Object.hasOwn(COMMANDS, command)) {
    throw new Failure(`Usage: container.mts <${Object.keys(USAGE).join("|")}> ...`, 2);
  }
  const name = command as keyof typeof USAGE;
  const handler = COMMANDS[name];
  if (args.length !== handler.length) {
    throw new Failure(`Usage: container.mts ${USAGE[name]}`, 2);
  }
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
