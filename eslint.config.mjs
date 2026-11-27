import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createNodeResolver } from "eslint-plugin-import-x/node-resolver";
import noCycle from "eslint-plugin-import-x/rules/no-cycle";
import globals from "globals";
import ts from "typescript-eslint";

import { plugins, sourceRules, toolingRules } from "./eslint.config.base.mjs";

const KIT_FILES = ["node/src/**/*.ts"];
const TEST_FILES = ["node/tests/**/*.mjs"];
const SCRIPT_FILES = ["scripts/**/*.mts", "tests/container/**/*.mts"];

// The package loads only node: builtins, its own modules and its declared peer dependencies.
const OUTSIDE_PACKAGE = {
  message: "node/src/ imports only node: builtins, its peers and its own modules by relative path.",
  regex: "^(?!node:|\\.{1,2}/|pngjs$|skia-canvas$|@jsquash/webp/)",
};

// The areas of node/src, lowest first, and the other areas each one may import. Type-only
// imports follow the same layers.
const LAYERS = {
  raster: [],
  codecs: ["raster"],
  atlas: ["raster", "codecs"],
  fonts: ["raster"],
  build: [],
};

// A later no-restricted-imports replaces an earlier one, so each area keeps OUTSIDE_PACKAGE. A
// relative path that leaves the area must enter an area it may import.
const layerConfigs = Object.entries(LAYERS).map(([area, imports]) => {
  const allowed = imports.length ? imports.join(" and ") : "no other area";
  const otherArea = {
    message: `node/src/${area}/ imports ${allowed}.`,
    regex: `^\\.\\./(?!(?:${[area, ...imports].join("|")})/)`,
  };
  return {
    files: [`node/src/${area}/**/*.ts`],
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_PACKAGE, otherArea] }] },
  };
});

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
  ...layerConfigs,
  {
    files: ["node/src/raster/draw/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            OUTSIDE_PACKAGE,
            {
              message: "Drawing primitives import only rgbaImage and types from the parent area.",
              regex: "^\\.\\./(?!(?:rgbaImage|types)\\.js$)",
            },
          ],
        },
      ],
    },
  },
  // No import cycles: a module in a cycle can run before what it imports has loaded. Type-only
  // imports are erased at build time, so they never form one. An import whose specifiers are all
  // inline `type` still loads its module under type stripping, so it must be written as
  // `import type`.
  {
    files: [...KIT_FILES, ...SCRIPT_FILES],
    rules: { "@typescript-eslint/no-import-type-side-effects": "error" },
  },
  {
    files: [...KIT_FILES, ...SCRIPT_FILES, ...TEST_FILES],
    plugins: { "import-x": { rules: { "no-cycle": noCycle } } },
    rules: { "import-x/no-cycle": "error" },
    settings: {
      "import-x/extensions": [".ts", ".mts", ".mjs"],
      // Source modules name their .ts siblings with a .js extension.
      "import-x/resolver-next": [
        createNodeResolver({
          extensionAlias: { ".js": [".ts", ".js"] },
          extensions: [".ts", ".mts", ".js", ".mjs"],
        }),
      ],
    },
  },
  // Tests and tooling: they verify or produce what ships rather than being it.
  {
    files: [...TEST_FILES, "*.mjs", ...SCRIPT_FILES],
    plugins,
    rules: toolingRules,
  },
);
