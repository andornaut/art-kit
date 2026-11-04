import assert from "node:assert/strict";
import test from "node:test";

import { contrast, rgb } from "@andornaut/art-kit/colour";
import { flipped, Grid, opaqueCols, opaqueRows } from "@andornaut/art-kit/grid";
import { composeContactSheet, composeSheet, frameToRgba } from "@andornaut/art-kit/raster";

test("grid truncates coordinates, resolves own palette keys and keeps Bresenham ties", () => {
  const g = new Grid({ a: "ffffff" }, 4, 3);
  g.p(-0.9, 0, "a");
  assert.equal(g.px[0][0], "ffffff");
  g.line(0, 0, 3, 2, "x");
  assert.deepEqual(g.px, [
    ["x", null, null, null],
    [null, "x", "x", null],
    [null, null, null, "x"],
  ]);
  g.p(0, 0, "toString");
  assert.equal(g.px[0][0], "toString");
});
test("outline uses original neighbours in top bottom left right priority and closes bottom", () => {
  const f = [
    [null, "a", null],
    ["b", null, "c"],
    [null, "d", null],
  ];
  const g = new Grid({}, 3, 3);
  g.px = f;
  const out = g.outlined({ edge: (c) => c.toUpperCase(), close: true });
  assert.equal(out[1][1], "A");
  assert.equal(out[2][1], "D");
  assert.equal(f[1][1], null);
  assert.deepEqual(g.outlined({ enabled: false }), f);
  assert.throws(() => g.outlined(), /outline colour rule/);
  // A null edge leaves the pixel clear.
  const skipped = g.outlined({ edge: (c) => (c === "a" ? null : c.toUpperCase()) });
  assert.equal(skipped[1][1], null);
  assert.equal(skipped[0][0], "B");
  assert.equal(skipped[0][2], "C");
});
test("pixel-centred shapes and triangle boundaries remain explicit", () => {
  for (const method of ["ell", "blob", "cel"]) {
    const g = new Grid({}, 3, 3);
    g[method](1.5, 1.5, 1, 1, "f");
    assert.deepEqual(g.px, [
      [null, "f", null],
      ["f", "f", "f"],
      [null, "f", null],
    ]);
  }
  const g = new Grid({}, 2, 2);
  g.tri([0, 0], [2, 0], [0, 2], "f");
  assert.deepEqual(g.px, [
    ["f", "f"],
    ["f", null],
  ]);
});
test("frame extents, reflection and RGBA rendering retain transparent pixels", () => {
  const f = [
    [null, "ff0000"],
    [null, null],
  ];
  assert.deepEqual(opaqueRows([f]), [0, 0]);
  assert.deepEqual(opaqueCols([f]), [1, 1]);
  assert.equal(opaqueRows([[[null]]]), null);
  assert.deepEqual(flipped(f), [
    ["ff0000", null],
    [null, null],
  ]);
  assert.deepEqual(
    [...frameToRgba({}, f).data],
    [0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});
test("sheet places and clips cells in order, leaving unused cells transparent", () => {
  const wide = frameToRgba({}, [["ff0000", "ff0000"]]);
  const blue = frameToRgba({}, [["0000ff"]]);
  const sheet = composeSheet({ columns: 2, cellWidth: 1, cellHeight: 1 }, [wide, blue, blue]);
  assert.deepEqual([...sheet.data], [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
});
test("sheet copies RGBA exactly, including partial alpha and RGB under clear alpha", () => {
  const image = { width: 2, height: 1, data: Uint8Array.of(10, 20, 30, 128, 40, 50, 60, 0) };
  const sheet = composeSheet({ columns: 1, cellWidth: 3, cellHeight: 2 }, [image]);
  assert.deepEqual([sheet.width, sheet.height], [3, 2]);
  assert.deepEqual([...sheet.data.subarray(0, 8)], [...image.data]);
  assert.ok(sheet.data.subarray(8).every((v) => v === 0));
});
test("contact sheet preserves ground rows, tag order, nearest scaling and gaps", () => {
  const image = composeContactSheet(
    { resolveRgb: rgb, background: [9, 8, 7], cellSize: "largest-frame", scale: 2, gap: 1 },
    [
      [
        "sprite",
        [
          ["one", [[[null, "ff0000"]]], 100],
          ["two", [[["ffffff", null]]], 100],
        ],
      ],
    ],
    ["00ff00", "0000ff"],
  );
  assert.equal(image.width, 12);
  assert.equal(image.height, 8);
  const pixel = (x, y) => [
    ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
  ];
  assert.deepEqual(pixel(0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(1, 1), [0, 255, 0, 255]);
  assert.deepEqual(pixel(0, 4), [0, 0, 255, 255]);
  assert.deepEqual(pixel(4, 0), [9, 8, 7, 255]);
  assert.deepEqual(pixel(6, 0), [255, 255, 255, 255]);
});
test("frameToRgba resolves palette or callback without mutating authored frames", () => {
  const frame = [["fill", null]];
  assert.deepEqual([...frameToRgba({ fill: "123456" }, frame).data], [18, 52, 86, 255, 0, 0, 0, 0]);
  assert.deepEqual(
    [...frameToRgba({ resolveRgb: () => [1, 2, 3] }, frame).data],
    [1, 2, 3, 255, 0, 0, 0, 0],
  );
  assert.deepEqual(frame, [["fill", null]]);
});
test("invalid layouts and ragged frames fail explicitly", () => {
  assert.throws(() => frameToRgba({}, []), RangeError);
  assert.throws(() => frameToRgba({}, [[null], []]), RangeError);
  assert.throws(
    () =>
      composeSheet({ columns: 0, cellWidth: 1, cellHeight: 1 }, [frameToRgba({}, [["000000"]])]),
    RangeError,
  );
  assert.throws(() => composeSheet({ columns: 1, cellWidth: 1, cellHeight: 1 }, []), RangeError);
  assert.throws(
    () =>
      composeContactSheet(
        { resolveRgb: rgb, background: [0, 0, 0], cellSize: "largest-frame" },
        [],
        [],
      ),
    RangeError,
  );
});
test("hex channels and WCAG contrast", () => {
  assert.deepEqual(rgb("01aBff"), [1, 171, 255]);
  for (const invalid of ["abcde", "aabbccdd", "#aabbcc", "abc", "", "gg0000", " aabbcc"]) {
    assert.throws(() => rgb(invalid), RangeError, invalid);
  }
  assert.equal(contrast("000000", "ffffff"), 21);
});

test("opaque extents handle a large solid frame without argument spreading", () => {
  const frame = Array.from({ length: 512 }, () => Array(512).fill("ffffff"));
  assert.deepEqual(opaqueRows([frame]), [0, 511]);
  assert.deepEqual(opaqueCols([frame]), [0, 511]);
});
