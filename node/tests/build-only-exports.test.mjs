import assert from "node:assert/strict";
import test from "node:test";

// Frozen public flat import surface through v0.27, independent of the current export map.
const RETIRED_IMPORTS = [
  "@andornaut/art-kit/atlasLayout",
  "@andornaut/art-kit/atlasBuild",
  "@andornaut/art-kit/rgbaImage",
  "@andornaut/art-kit/indexedPng",
  "@andornaut/art-kit/png",
  "@andornaut/art-kit/webp",
  "@andornaut/art-kit/woff2",
  "@andornaut/art-kit/gif",
  "@andornaut/art-kit/ico",
  "@andornaut/art-kit/spriteSheet",
  "@andornaut/art-kit/draw",
  "@andornaut/art-kit/colour",
  "@andornaut/art-kit/fonts",
  "@andornaut/art-kit/bitmapFont",
  "@andornaut/art-kit/grid",
  "@andornaut/art-kit/raster",
  "@andornaut/art-kit/glyphAtlas",
  "@andornaut/art-kit/build",
];

test("v0.28 installed package rejects all 18 retired flat import paths", async () => {
  await Promise.all(
    RETIRED_IMPORTS.map((specifier) =>
      assert.rejects(import(specifier), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }, specifier),
    ),
  );
});
