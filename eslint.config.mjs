import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createNodeResolver } from "eslint-plugin-import-x/node-resolver";
import noCycle from "eslint-plugin-import-x/rules/no-cycle";
import globals from "globals";
import ts from "typescript-eslint";

import { plugins, sourceRules, toolingRules } from "./eslint.config.base.mjs";

const KIT_FILES = ["node/src/**/*.ts"];
const TEST_FILES = ["node/tests/**/*.mjs"];

// The package loads only node: builtins, its own modules and its declared peer dependencies.
const OUTSIDE_PACKAGE = {
  message: "node/src/ imports only node: builtins, its peers and its own modules by relative path.",
  regex: "^(?!node:|\\.{1,2}/|pngjs$|skia-canvas$|@jsquash/webp/)",
};

export default defineConfig(
  {
    ignores: [".claude/", ".worktrees/", "**/node_modules/", "**/dist/"],
  },
  js.configs.recommended,
  ts.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: KIT_FILES,
    plugins,
    rules: {
      ...sourceRules,
      "no-restricted-imports": ["error", { patterns: [OUTSIDE_PACKAGE] }],
      "no-restricted-syntax": ["error", "WithStatement", "ImportExpression"],
    },
  },
  // No import cycles: a module in a cycle can run before what it imports has loaded. Type-only
  // imports are erased at build time, so they never form one.
  {
    files: KIT_FILES,
    plugins: { "import-x": { rules: { "no-cycle": noCycle } } },
    rules: { "import-x/no-cycle": "error" },
    settings: {
      "import-x/extensions": [".ts"],
      "import-x/resolver-next": [createNodeResolver({ extensions: [".ts", ".js"] })],
    },
  },
  // Tests and tooling: they verify or produce what ships rather than being it.
  {
    files: [...TEST_FILES, "*.mjs", "scripts/**/*.mts"],
    plugins,
    rules: toolingRules,
  },
);
