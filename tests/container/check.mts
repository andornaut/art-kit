import { lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

for (const [relative, dependencies] of [
  ["node/node_modules", "/opt/tools/node_modules"],
  ["tests/container/node_modules", "/opt/lint/node_modules"],
]) {
  const target = resolve("/work", relative);
  mkdirSync(dirname(target), { recursive: true });
  try {
    const existing = lstatSync(target);
    if (!existing.isSymbolicLink() || realpathSync(target) !== dependencies) {
      throw new Error(`Refusing to replace existing dependency path: ${relative}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    symlinkSync(dependencies, target, "dir");
  }
}
