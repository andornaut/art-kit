import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [mode, ...args] = process.argv.slice(2);
if (!["lint", "test", "build"].includes(mode) || args.length) {
  throw new Error("Expected lint, test or build");
}

function allowed(path: string): boolean {
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

// Each phase starts with a fresh source tree so its generated files cannot affect another phase.
function copySource(destination: string, directory = ""): void {
  mkdirSync(join(destination, directory));
  for (const entry of readdirSync(join("/work", directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!allowed(path)) {
      continue;
    }
    if (entry.isDirectory()) {
      copySource(destination, path);
    } else if (entry.isFile()) {
      cpSync(join("/work", path), join(destination, path));
    } else {
      throw new Error(`Not a regular source path: ${path}`);
    }
  }
}

const scratch = mkdtempSync("/scratch/art-kit-check-");
try {
  const source = join(scratch, "source");
  copySource(source);
  const result = spawnSync(
    process.execPath,
    [join(source, "scripts/node-package.mts"), mode, "private-working-tree"],
    {
      cwd: source,
      stdio: "inherit",
      env: {
        ...process.env,
        HOME: scratch,
        TMPDIR: scratch,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        ART_KIT_PACKAGE_WORK: scratch,
        ART_KIT_PACKAGE_NODE_MODULES: "/scratch/tools/node_modules",
        ART_KIT_TEST_FIXTURES: join(source, "node/tests/fixtures"),
        npm_config_cache: join(scratch, "npm-cache"),
        UV_THREADPOOL_SIZE: "4",
      },
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0 && mode === "build" && existsSync("/outputs")) {
    cpSync(join(source, "node/dist"), "/outputs/dist", { recursive: true });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
