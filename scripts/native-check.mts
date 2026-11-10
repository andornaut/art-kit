import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const [mode, ...args] = process.argv.slice(2);
if (!["check", "lint", "test", "build"].includes(mode) || (mode !== "test" && args.length)) {
  throw new Error("Usage: node scripts/native-check.mts <check|lint|test|build> [testflags...]");
}
// Test selection flags are Node options, never executable code or positional source paths.
for (let i = 0; i < args.length; i++) {
  if (/^--test-(?:name-pattern|skip-pattern|only|timeout)(?:=|$)/.test(args[i])) {
    if (!args[i].includes("=") && args[i] !== "--test-only") {
      if (++i === args.length) {
        throw new Error("Missing test flag value");
      }
    }
  } else {
    throw new Error(`Unsupported test flag: ${args[i]}`);
  }
}

function git(args: string[]): string | undefined {
  if (!existsSync(join(root, ".git"))) {
    return undefined;
  }
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status === 0) {
    return result.stdout;
  }
  if (existsSync(join(root, ".git"))) {
    throw new Error("Git source inspection failed");
  }
  return undefined;
}

let stagingOutput: string | undefined;
function allowed(path: string): boolean {
  if (stagingOutput && (path === stagingOutput || path.startsWith(`${stagingOutput}/`))) {
    return false;
  }
  return !path.split(/[\\/]/).some(
    (part) =>
      // eslint-disable-next-line max-len
      /^(?:\.git|\.agents|\.claude|\.codex|\.worktrees|\.private|\.ssh|\.aws|\.gnupg|node_modules|dist|\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials(?:\..*)?|AGENTS\.md|CLAUDE(?:\.local)?\.md|GEMINI\.md|\.dev\.vars(?:\..*)?|\.env(?:\..*)?)$/i.test(
        part,
      ) ||
      /\.(?:env|pem|key|crt|cer|p12|pfx|kdbx|age|gpg)$/i.test(part) ||
      /\.sops\./i.test(part),
  );
}

// Reject links before reading content, including directory links in Git-listed paths.
function regular(path: string): void {
  const parts = path.split("/");
  let current = root;
  for (const [i, part] of parts.entries()) {
    if (!part || part === "." || part === ".." || isAbsolute(part)) {
      throw new Error("Invalid source path");
    }
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symbolic source path is unsupported: ${path}`);
    }
    if (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(`Not a regular source path: ${path}`);
    }
  }
}

function files(): string[] {
  const listed = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (listed !== undefined) {
    return [...new Set(listed.split("\0").filter((path) => path && allowed(path)))]
      .filter((path) => {
        try {
          lstatSync(join(root, path));
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
          }
          throw error;
        }
      })
      .sort();
  }
  const found: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (!allowed(path)) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(path);
      } else {
        regular(path);
        found.push(path);
      }
    }
  }
  visit("");
  return found.sort();
}

function fingerprint(): string {
  const hash = createHash("sha256");
  hash.update(
    git([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ...(stagingOutput ? [`:(exclude)${stagingOutput}`] : []),
    ]) ?? "no-git",
  );
  for (const path of files()) {
    regular(path);
    hash.update(JSON.stringify([path, lstatSync(join(root, path)).mode]));
    hash.update(readFileSync(join(root, path)));
  }
  return hash.digest("hex");
}

const dependencies = realpathSync(
  resolve(root, process.env.ART_KIT_NODE_MODULES ?? "node/node_modules"),
);
const revision =
  process.env.CHECK_REVISION ?? git(["rev-parse", "HEAD"])?.trim() ?? "private-working-tree";
const before = fingerprint();
const scratch = mkdtempSync(join(tmpdir(), "art-kit-native-"));
let status: number;
try {
  const source = join(scratch, "source");
  const output = join(scratch, "output");
  mkdirSync(source);
  mkdirSync(output);
  for (const path of files()) {
    regular(path);
    mkdirSync(dirname(join(source, path)), { recursive: true });
    cpSync(join(root, path), join(source, path));
  }
  if (fingerprint() !== before) {
    throw new Error("Source changed during snapshot; discard this run");
  }
  const options = {
    cwd: source,
    stdio: "inherit" as const,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
      ),
      HOME: scratch,
      TMPDIR: scratch,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      ART_KIT_PACKAGE_WORK: scratch,
      ART_KIT_PACKAGE_OUT: output,
      ART_KIT_PACKAGE_ROOT: source,
      ART_KIT_PACKAGE_NODE_MODULES: dependencies,
      ART_KIT_TEST_FIXTURES: join(source, "node/tests/fixtures"),
      npm_config_cache: join(scratch, "npm-cache"),
      UV_THREADPOOL_SIZE: "4",
    },
  };
  if (mode === "lint" || mode === "check") {
    execFileSync(
      "shellcheck",
      [
        "-x",
        "-P",
        "SCRIPTDIR",
        "tests/container/run",
        "tests/container/check",
        "scripts/check.sh",
        "scripts/pack.sh",
        "scripts/provision.sh",
      ],
      options,
    );
    execFileSync(
      process.execPath,
      [realpathSync(join(root, "tests/container/node_modules/.bin/markdownlint-cli2"))],
      options,
    );
  }
  const result = spawnSync(
    process.execPath,
    [join(source, "scripts/node-package.mts"), mode, revision, ...args],
    options,
  );
  if (result.error) {
    throw result.error;
  }
  status = result.status ?? 1;
  if (fingerprint() !== before) {
    throw new Error("Source changed during check; discard this run");
  }
  if (status === 0 && mode === "build") {
    const node = join(root, "node");
    if (lstatSync(node).isSymbolicLink() || realpathSync(node) !== node) {
      throw new Error("Unsafe node output directory");
    }
    const target = join(node, "dist");
    if (
      existsSync(target) ||
      (() => {
        try {
          lstatSync(target);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
          }
          throw error;
        }
      })()
    ) {
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) {
        throw new Error("Unsafe node/dist output");
      }
    }
    const staging = mkdtempSync(join(node, ".native-dist-"));
    stagingOutput = `node/${staging.slice(node.length + 1)}`;
    try {
      cpSync(join(source, "node/dist"), staging, { recursive: true });
      // Only the ignored native compiler output is replaced; release artifacts stay separate.
      if (git(["ls-files", "--", "node/dist"])?.trim()) {
        throw new Error("Refusing to replace tracked node/dist");
      }
      if (fingerprint() !== before) {
        throw new Error("Source changed before build export");
      }
      rmSync(target, { recursive: true, force: true });
      renameSync(staging, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
} finally {
  try {
    if (fingerprint() !== before) {
      status = 1;
      console.error("Source fingerprint changed; result is invalid");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
if (status === 0) {
  console.log(`Native ${mode}: source fingerprint ${before} unchanged`);
}
process.exitCode = status;
