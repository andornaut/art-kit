import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [mode, ...args] = process.argv.slice(2);

function run(command: string, parameters: readonly string[]): void {
  const result = spawnSync(command, parameters, { cwd: "/work", stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (mode === "exec") {
  if (args.length) {
    run(args[0], args.slice(1));
  } else if (process.env.COMMAND) {
    run("sh", ["-ec", process.env.COMMAND]);
  } else {
    throw new Error("exec requires arguments or COMMAND");
  }
} else {
  if (!["lint", "test", "build"].includes(mode)) {
    throw new Error("Expected lint, test, build or exec");
  }
  if (args.length && mode !== "test") {
    throw new Error("Only test accepts extra arguments");
  }
  const revision = process.env.CHECK_REVISION;
  if (!revision) {
    throw new Error("CHECK_REVISION is required");
  }
  const source = "/tmp/work/source";
  mkdirSync(source, { recursive: true });
  mkdirSync("/tmp/out", { recursive: true });
  cpSync("/work", source, { recursive: true, verbatimSymlinks: true });
  process.env.ART_KIT_TEST_FIXTURES = join(source, "node/tests/fixtures");
  run(process.execPath, [join(source, "scripts/node-package.mts"), mode, revision, ...args]);
  if (mode === "build" && process.env.CHECK_EXPORT === "1") {
    const output = "/work/dist";
    mkdirSync(output, { recursive: true });
    cpSync(join(source, "node/dist"), output, { recursive: true });
    for (const file of readdirSync("/tmp/out")) {
      cpSync(join("/tmp/out", file), join(output, file));
    }
  }
}
