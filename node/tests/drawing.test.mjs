import assert from "node:assert/strict";
import test from "node:test";
import { Grid, outline } from "@andornaut/art-kit/grid";
import { rgb, contrast } from "@andornaut/art-kit/colour";
import {
  flipped,
  opaque_rows,
  opaque_cols,
  to_image,
  tile_sheet,
  contact_sheet,
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
  const out = outline((c) => c.toUpperCase(), f, { close: true });
  assert.equal(out[1][1], "A");
  assert.equal(out[2][1], "D");
  assert.equal(f[1][1], null);
  assert.deepEqual(outline(null, f, { enabled: false }), f);
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
test("frame extents, reflection and RGBA conversion retain transparent pixels", () => {
  const f = [
    [null, "ff0000"],
    [null, null],
  ];
  assert.deepEqual(opaque_rows([f]), [0, 0]);
  assert.deepEqual(opaque_cols([f]), [1, 1]);
  assert.equal(opaque_rows([[[null]]]), null);
  assert.deepEqual(flipped(f), [
    ["ff0000", null],
    [null, null],
  ]);
  assert.deepEqual(
    [...to_image(f).data],
    [0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});
test("tile sheet source-over blends overlapping tiles instead of overwriting", () => {
  const tiles = [
    {
      width: 2,
      height: 1,
      data: Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 128]),
    },
    { width: 1, height: 1, data: Uint8Array.from([0, 0, 255, 128]) },
  ];
  assert.deepEqual(
    [...tile_sheet(1, 2, tiles).data],
    [255, 0, 0, 255, 85, 0, 170, 192],
  );
});
test("contact sheet preserves ground rows, frame order, nearest scaling and gaps", () => {
  const image = contact_sheet(
    (c) => rgb(c),
    [["sprite", [["tag", [[[null, "ff0000"]]], 100]]]],
    ["00ff00", "0000ff"],
    { background: [9, 8, 7], scale: 2, gap: 1 },
  );
  assert.equal(image.width, 6);
  assert.equal(image.height, 8);
  assert.deepEqual([...image.data.slice(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual(
    [...image.data.slice(4 * 6 * 4, 4 * 6 * 4 + 4)],
    [0, 0, 255, 255],
  );
  assert.deepEqual([...image.data.slice(4 * 4, 4 * 5)], [9, 8, 7, 255]);
});
test("hex channels and WCAG contrast", () => {
  assert.deepEqual(rgb("01aBff"), [1, 171, 255]);
  assert.equal(contrast("000000", "ffffff"), 21);
});

test("opaque extents handle a large solid frame without argument spreading", () => {
  const frame = Array.from({ length: 512 }, () => Array(512).fill("ffffff"));
  assert.deepEqual(opaque_rows([frame]), [0, 511]);
  assert.deepEqual(opaque_cols([frame]), [0, 511]);
});
