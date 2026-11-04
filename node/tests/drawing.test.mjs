import { Canvas } from "skia-canvas";
import assert from "node:assert/strict";
import test from "node:test";
import { Grid, opaqueCols, opaqueRows } from "@andornaut/art-kit/grid";
import { rgb, contrast } from "@andornaut/art-kit/colour";
import {
  flipped,
  renderFrame,
  composeSheet,
  renderContactSheet,
} from "@andornaut/art-kit/frames";

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
test("frame extents, reflection and Canvas rendering retain transparent pixels", () => {
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
    pixels(renderFrame({}, f)),
    [0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});
test("sheet places and clips cells in order, leaving unused cells transparent", () => {
  const wide = renderFrame({}, [["ff0000", "ff0000"]]);
  const blue = renderFrame({}, [["0000ff"]]);
  const sheet = composeSheet({ columns: 2, cellWidth: 1, cellHeight: 1 }, [
    wide,
    blue,
    blue,
  ]);
  assert.deepEqual(
    pixels(sheet),
    [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0],
  );
  assert.equal(sheet.gpu, false);
});
test("contact sheet preserves ground rows, tag order, nearest scaling and gaps", () => {
  const image = renderContactSheet(
    { resolveRgb: rgb, background: [9, 8, 7], scale: 2, gap: 1 },
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
  const pixel = (x, y) =>
    pixels(image).slice(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    );
  assert.deepEqual(pixel(0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(1, 1), [0, 255, 0, 255]);
  assert.deepEqual(pixel(0, 4), [0, 0, 255, 255]);
  assert.deepEqual(pixel(4, 0), [9, 8, 7, 255]);
  assert.deepEqual(pixel(6, 0), [255, 255, 255, 255]);
});
test("renderFrame resolves palette or callback without mutating authored frames", () => {
  const frame = [["fill", null]];
  assert.deepEqual(
    pixels(renderFrame({ fill: "123456" }, frame)),
    [18, 52, 86, 255, 0, 0, 0, 0],
  );
  assert.deepEqual(
    pixels(renderFrame({ resolveRgb: () => [1, 2, 3] }, frame)),
    [1, 2, 3, 255, 0, 0, 0, 0],
  );
  assert.deepEqual(frame, [["fill", null]]);
});
test("invalid layouts and ragged frames fail explicitly", () => {
  assert.throws(() => renderFrame({}, []), RangeError);
  assert.throws(() => renderFrame({}, [[null], []]), RangeError);
  assert.throws(
    () => composeSheet({ columns: 0, cellWidth: 1, cellHeight: 1 }, []),
    RangeError,
  );
  assert.throws(
    () =>
      renderContactSheet({ resolveRgb: rgb, background: [0, 0, 0] }, [], []),
    RangeError,
  );
});
test("hex channels and WCAG contrast", () => {
  assert.deepEqual(rgb("01aBff"), [1, 171, 255]);
  for (const invalid of ["abcde", "aabbccdd", "#aabbcc", "abc", "", "gg0000", " aabbcc"])
    assert.throws(() => rgb(invalid), RangeError, invalid);
  assert.equal(contrast("000000", "ffffff"), 21);
});

test("opaque extents handle a large solid frame without argument spreading", () => {
  const frame = Array.from({ length: 512 }, () => Array(512).fill("ffffff"));
  assert.deepEqual(opaqueRows([frame]), [0, 511]);
  assert.deepEqual(opaqueCols([frame]), [0, 511]);
});

function pixels(canvas) {
  return [
    ...canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
      .data,
  ];
}
test("sheet uses native Skia source-over semantics for translucent inputs", () => {
  const image = new Canvas(1, 1);
  image.gpu = false;
  const ctx = image.getContext("2d");
  ctx.fillStyle = "rgba(255,0,0,0.5)";
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = "rgba(0,0,255,0.5)";
  ctx.fillRect(0, 0, 1, 1);
  const sheet = composeSheet({ columns: 1, cellWidth: 1, cellHeight: 1 }, [
    image,
  ]);
  assert.deepEqual(pixels(sheet), pixels(image));
  assert.ok(pixels(sheet)[3] > 128 && pixels(sheet)[3] < 255);
});
