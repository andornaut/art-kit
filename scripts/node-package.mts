import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

interface Descriptor {
  version: string;
  exports: Record<string, unknown>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

// Subpaths that import the optional Skia peer; every other export must import without the optional peers.
const SKIA_SUBPATHS = ["build/fonts"];

const [mode, revision, ...args] = process.argv.slice(2);
if (!["lint", "test", "build", "pack"].includes(mode)) {
  throw new Error("Expected lint, test, build or pack mode");
}
if (args.length) {
  throw new Error(`Unexpected arguments for ${mode} mode`);
}
// Dependencies are mounted outside a conventional node_modules directory.
const dependencies = process.env.ART_KIT_PACKAGE_NODE_MODULES ?? "/deps";
process.env.NODE_PATH = dependencies;
// Pack uses the writable /tmp volume and exports /tmp/out. Checks use a separate scratch tree.
const work = process.env.ART_KIT_PACKAGE_WORK ?? "/tmp/work";
const root = `${work}/source`;
const descriptor: Descriptor = JSON.parse(readFileSync(`${root}/node/package.json`, "utf8"));
for (const [name, expected] of Object.entries<string>({
  ...descriptor.devDependencies,
  ...descriptor.peerDependencies,
})) {
  const actual = JSON.parse(readFileSync(`${dependencies}/${name}/package.json`, "utf8")).version;
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, actual ${actual}`);
  }
}
const { version } = descriptor;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error("Missing or invalid package version");
}
symlinkSync(dependencies, `${root}/node/node_modules`);
if (mode === "lint") {
  // The linters resolve their configs' imports through node_modules beside them; preserving the symlinked
  // path lets each package find its siblings in /deps.
  symlinkSync(dependencies, `${root}/node_modules`);
  const tool = (path: string, args: readonly string[]): void => {
    execFileSync(
      process.execPath,
      ["--preserve-symlinks", "--preserve-symlinks-main", `${root}/node_modules/${path}`, ...args],
      { cwd: root, stdio: "inherit" },
    );
  };
  tool("prettier/bin/prettier.cjs", ["--check", "."]);
  tool("eslint/bin/eslint.js", ["--max-warnings", "0", "."]);
  execFileSync(
    process.execPath,
    [`${dependencies}/typescript/bin/tsc`, "--noEmit", "-p", `${root}/node/tsconfig.json`],
    { stdio: "inherit" },
  );
  process.exit(0);
}
execFileSync(
  process.execPath,
  [`${dependencies}/typescript/bin/tsc`, "-p", `${root}/node/tsconfig.json`],
  {
    stdio: "inherit",
  },
);
const packageDir = `${work}/package`;
mkdirSync(packageDir);
cpSync(`${root}/node/dist`, `${packageDir}/dist`, { recursive: true });
cpSync(`${root}/LICENSE`, `${packageDir}/LICENSE`);
// The published manifest omits devDependencies.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { devDependencies, ...published } = descriptor;
writeFileSync(`${packageDir}/package.json`, `${JSON.stringify(published, null, 2)}\n`);
writeFileSync(`${packageDir}/SOURCE_COMMIT`, `${revision}\n`);
execFileSync(
  "npm",
  ["pack", "--ignore-scripts", "--offline", "--pack-destination", work, packageDir],
  { stdio: "inherit" },
);
const archive = `${work}/andornaut-art-kit-${version}.tgz`;
const install = `${work}/installed`;
mkdirSync(`${install}/node_modules/@andornaut`, { recursive: true });
execFileSync("tar", ["-xzf", archive, "-C", `${install}/node_modules/@andornaut`]);
renameSync(
  `${install}/node_modules/@andornaut/package`,
  `${install}/node_modules/@andornaut/art-kit`,
);
for (const name of Object.keys(descriptor.peerDependencies)) {
  if (name.startsWith("@")) {
    mkdirSync(`${install}/node_modules/${name.split("/")[0]}`, { recursive: true });
  }
  symlinkSync(`${dependencies}/${name}`, `${install}/node_modules/${name}`);
}
const installedManifest = JSON.parse(
  readFileSync(`${install}/node_modules/@andornaut/art-kit/package.json`, "utf8"),
);
if (
  readFileSync(`${install}/node_modules/@andornaut/art-kit/SOURCE_COMMIT`, "utf8") !==
  `${revision}\n`
) {
  throw new Error("Installed source identity differs");
}
if (
  readdirSync(`${install}/node_modules/@andornaut/art-kit`, {
    encoding: "utf8",
    recursive: true,
  }).some((path) => /(?:^|\/)fixtures(?:\/|$)|\.(?:ttf|otf|woff2?)$/i.test(path))
) {
  throw new Error("Font fixtures must not be published");
}
if (
  installedManifest.version !== version ||
  existsSync(`${install}/node_modules/@andornaut/art-kit/src`)
) {
  throw new Error("Invalid compiled package");
}
const subpaths = Object.keys(descriptor.exports).map((path) => path.slice(2));
for (const subpath of SKIA_SUBPATHS) {
  if (!subpaths.includes(subpath)) {
    throw new Error(`Skia subpath ${subpath} is not exported`);
  }
}
function checkImport(subpath: string): void {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(`@andornaut/art-kit/${subpath}`)})`,
    ],
    { cwd: install, stdio: "inherit" },
  );
}
const optionalPeers = Object.keys(descriptor.peerDependenciesMeta ?? {}).filter(
  (name) => descriptor.peerDependenciesMeta?.[name].optional,
);
for (const name of optionalPeers) {
  unlinkSync(`${install}/node_modules/${name}`);
}
for (const subpath of subpaths.filter((subpath) => !SKIA_SUBPATHS.includes(subpath))) {
  checkImport(subpath);
}
for (const name of optionalPeers) {
  symlinkSync(`${dependencies}/${name}`, `${install}/node_modules/${name}`);
}
for (const subpath of subpaths) {
  checkImport(subpath);
}
const contractFile = `${install}/contracts.mts`;
writeFileSync(
  contractFile,
  subpaths
    .map((subpath, index) => `import * as export${index} from '@andornaut/art-kit/${subpath}';`)
    .join("\n"),
);
execFileSync(
  process.execPath,
  [
    `${dependencies}/typescript/bin/tsc`,
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2023",
    "--strict",
    "--skipLibCheck",
    "--noEmit",
    "--types",
    "node",
    "--typeRoots",
    `${dependencies}/@types`,
    contractFile,
  ],
  { cwd: install, stdio: "inherit" },
);
if (mode === "test") {
  const tests: string[] = [];
  function collect(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(path);
      } else if (entry.name.endsWith(".test.mjs")) {
        tests.push(path);
      }
    }
  }
  collect(`${root}/node`);
  if (!tests.length) {
    throw new Error("No Node package tests");
  }
  const targets = tests.map((path, i) => {
    const target = `${install}/test-${i}.test.mjs`;
    cpSync(path, target);
    return target;
  });
  execFileSync(process.execPath, ["--test", "--test-concurrency=4", ...targets], {
    cwd: install,
    stdio: "inherit",
  });
}
if (mode === "pack") {
  const out = "/tmp/out";
  const tarball = `art-kit-${version}.tgz`;
  cpSync(archive, `${out}/${tarball}`);
  writeFileSync(`${out}/SOURCE_COMMIT`, `${revision}\n`);
  writeFileSync(
    `${out}/SHA256SUMS`,
    [tarball, "SOURCE_COMMIT"]
      .map(
        (name) =>
          `${createHash("sha256")
            .update(readFileSync(`${out}/${name}`))
            .digest("hex")}  ${name}\n`,
      )
      .join(""),
  );
}
