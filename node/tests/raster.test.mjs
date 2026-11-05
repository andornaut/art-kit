import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import * as raster from "@andornaut/art-kit/raster";

const fixtures = process.env.ART_KIT_TEST_FIXTURES;
assert.ok(fixtures, "Required fixture directory");
// Frozen Pillow 13.0.0 references; see fixtures/README.md.
const reference = JSON.parse(readFileSync(join(fixtures, "raster", "pillow.json"), "utf8"));

function decode({ data, height, width }) {
  return { data: new Uint8Array(Buffer.from(data, "base64")), height, width };
}
const inputs = () =>
  Object.fromEntries(
    Object.entries(reference.inputs).map(([name, image]) => [name, decode(image)]),
  );
const point = ([x, y]) => ({ x, y });
const rect = ([x, y, width, height]) => ({ height, width, x, y });
const resolveRgb = (name) => reference.palette[name];

function apply(c, all) {
  const target = all[c.target];
  switch (c.op) {
    case "fill":
      raster.fill({ rect: rect(c.rect), ...(c.mask && { mask: all[c.mask] }) }, c.rgba, target);
      return target;
    case "paste":
      raster.paste(
        {
          at: point(c.at),
          ...(c.mask && { mask: c.mask }),
          ...(c.keepAlpha && { keepAlpha: true }),
        },
        all[c.source],
        target,
      );
      return target;
    case "composite":
      raster.composite(point(c.at), all[c.source], target);
      return target;
    case "crop":
      return raster.crop(rect(c.rect), all[c.source]);
    case "resizeNearest":
      return raster.resizeNearest(c.size[0], c.size[1], all[c.source]);
    case "rotateNearest":
      return raster.rotateNearest(c.angle, all[c.source]);
    case "opaque":
      return raster.opaque(all[c.source]);
    case "grayscale":
      return raster.grayscale(all[c.source]);
    case "channel":
      return raster.channel(c.index, all[c.source]);
    case "copy":
      return { ...all[c.source], data: all[c.source].data.slice() };
    case "composeContactSheet":
      return raster.composeContactSheet(
        { resolveRgb, background: c.background, cellSize: c.cellSize, scale: c.scale, gap: c.gap },
        c.sprites,
        c.grounds,
      );
    default:
      throw new Error(`Unknown fixture operation ${c.op}`);
  }
}

test("raster output is byte-equal to Pillow 13.0.0 references, including partial alpha", () => {
  assert.equal(reference.pillow, "13.0.0");
  const ops = new Set(reference.cases.map(({ op }) => op));
  for (const op of ["fill", "paste", "composite", "composeContactSheet", "rotateNearest"]) {
    assert.ok(ops.has(op), op);
  }
  reference.cases.forEach((c, i) => {
    const all = inputs();
    const before = all.a.data.slice();
    const actual = apply(c, all);
    const expected = decode(c.expected);
    assert.equal(actual.width, expected.width, `case ${i} ${c.op} width`);
    assert.equal(actual.height, expected.height, `case ${i} ${c.op} height`);
    assert.deepEqual(Buffer.from(actual.data), Buffer.from(expected.data), `case ${i} ${c.op}`);
    if (c.target !== "a") {
      assert.deepEqual(all.a.data, before, `case ${i} ${c.op} leaves its source unchanged`);
    }
  });
});

test("nearest resize matches Pillow 13.0.0 sample indices for non-integer ratios", () => {
  // Pillow 13.0.0 resize(NEAREST) of an image whose pixels hold their own index.
  const cases = [
    [
      [3, 2],
      [7, 5],
      [0, 0, 1, 1, 1, 2, 2],
      [0, 0, 1, 1, 1],
    ],
    [
      [5, 4],
      [3, 3],
      [0, 2, 4],
      [0, 2, 3],
    ],
    [
      [7, 3],
      [4, 5],
      [0, 2, 4, 6],
      [0, 0, 1, 2, 2],
    ],
    [
      [4, 4],
      [6, 2],
      [0, 1, 1, 2, 2, 3],
      [1, 3],
    ],
    [
      [3, 3],
      [8, 8],
      [0, 0, 0, 1, 1, 2, 2, 2],
      [0, 0, 0, 1, 1, 2, 2, 2],
    ],
    [
      [6, 5],
      [4, 2],
      [0, 2, 3, 5],
      [1, 3],
    ],
  ];
  for (const [[iw, ih], [ow, oh], xs, ys] of cases) {
    const source = raster.filledImage([0, 0, 0, 255], iw, ih);
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        source.data.set([x, y], (y * iw + x) * 4);
      }
    }
    const out = raster.resizeNearest(ow, oh, source);
    assert.deepEqual(
      [...Array(ow).keys()].map((x) => out.data[x * 4]),
      xs,
    );
    assert.deepEqual(
      [...Array(oh).keys()].map((y) => out.data[y * ow * 4 + 1]),
      ys,
    );
  }
});

test("frameToRgba resolves palette names, hex colours and callbacks", () => {
  const frame = [
    ["a", null, "102030"],
    [null, "toString", "a"],
  ];
  const palette = { a: "ff8000", toString: "0000ff" };
  const image = raster.frameToRgba(palette, frame);
  assert.deepEqual(
    [...image.data],
    [255, 128, 0, 255, 0, 0, 0, 0, 16, 32, 48, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 128, 0, 255],
  );
  assert.deepEqual([...image.data.subarray(4, 8)], [0, 0, 0, 0]);
  const resolved = raster.frameToRgba({ resolveRgb: () => [1, 2, 3] }, frame);
  assert.deepEqual([...resolved.data.subarray(0, 4)], [1, 2, 3, 255]);
  assert.throws(() => raster.frameToRgba(palette, [["a"], []]), RangeError);
});

// sha256 of each sheet's RGBA from the Skia frames.renderContactSheet of v0.16.0; see fixtures/README.md.
const SKIA_CONTACT_SHEETS = {
  "1,0": "8x14 4e6f06fa21e31073c9a6fc5f290dd61a56c2124d51c48fe50940c539a6d8aadf",
  "2,1": "20x36 cfcb7ee831814a39ccaf920750030ed1d6c156a66685e9a069eebc6a8c470393",
  "3,4": "48x90 610d46d1fb6bbd2a07f98806219b40df7db9c5d046abb9a52a467e0898fb8fc0",
};

test("largest-frame contact sheets equal the frozen Skia contact sheets", () => {
  const palette = {
    r: [200, 30, 40],
    g: [20, 180, 60],
    b: [30, 40, 220],
    s: [90, 80, 70],
    t: [250, 240, 200],
  };
  const sprites = [
    [
      "mixed",
      [
        [
          "idle",
          [
            [
              ["r", null, "g"],
              [null, "b", null],
            ],
            [
              ["g", "g"],
              ["r", null],
              [null, "b"],
              ["b", "b"],
            ],
          ],
          1,
        ],
      ],
    ],
    ["tall", [["only", [[["g"], [null], ["r"]], [["b", "r", "g", "b"]]], 1]]],
  ];
  const resolve = (name) => palette[name];
  for (const [scale, gap] of [
    [1, 0],
    [2, 1],
    [3, 4],
  ]) {
    const options = { resolveRgb: resolve, background: [1, 2, 3], scale, gap };
    const sheet = raster.composeContactSheet({ ...options, cellSize: "largest-frame" }, sprites, [
      "s",
      "t",
    ]);
    const digest = createHash("sha256").update(sheet.data).digest("hex");
    assert.equal(
      `${sheet.width}x${sheet.height} ${digest}`,
      SKIA_CONTACT_SHEETS[`${scale},${gap}`],
    );
  }
  assert.throws(
    () =>
      raster.composeContactSheet({ resolveRgb: resolve, background: [0, 0, 0] }, sprites, ["s"]),
    RangeError,
  );
});

test("integer-factor nearest resize replicates every pixel, including RGB under clear alpha", () => {
  const all = inputs();
  for (const source of [all.a, all.b, all.rotateWide]) {
    for (const factor of [1, 2, 3, 5]) {
      const expected = new Uint8Array(source.width * factor * source.height * factor * 4);
      for (let y = 0; y < source.height * factor; y++) {
        for (let x = 0; x < source.width * factor; x++) {
          const read = (Math.floor(y / factor) * source.width + Math.floor(x / factor)) * 4;
          expected.set(source.data.subarray(read, read + 4), (y * source.width * factor + x) * 4);
        }
      }
      const out = raster.resizeNearest(source.width * factor, source.height * factor, source);
      assert.deepEqual(Buffer.from(out.data), Buffer.from(expected));
    }
  }
});

test("fill, paste and composite mutate in place; other operations return new images", () => {
  const image = raster.filledImage([1, 2, 3, 0], 2, 2);
  raster.fill({ rect: { x: 1, y: 1, width: 5, height: 5 } }, [9, 9, 9, 255], image);
  assert.deepEqual([...image.data], [1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 9, 9, 9, 255]);
  assert.deepEqual([...raster.opaque(image).data.subarray(0, 4)], [1, 2, 3, 255]);
  assert.deepEqual([...image.data.subarray(0, 4)], [1, 2, 3, 0]);
  raster.paste({ at: { x: -1, y: 0 } }, image, image);
  assert.deepEqual([...image.data], [1, 2, 3, 0, 1, 2, 3, 0, 9, 9, 9, 255, 9, 9, 9, 255]);
  const target = raster.filledImage([5, 5, 5, 200], 1, 1);
  raster.paste(
    { at: { x: 0, y: 0 }, keepAlpha: true },
    raster.filledImage([7, 8, 9, 10], 1, 1),
    target,
  );
  assert.deepEqual([...target.data], [7, 8, 9, 200]);
  raster.composite({ x: 0, y: 0 }, raster.filledImage([0, 0, 0, 0], 1, 1), target);
  assert.deepEqual([...target.data], [7, 8, 9, 200]);
  assert.deepEqual(Object.keys(raster).sort(), [
    "channel",
    "composeContactSheet",
    "composeSheet",
    "composite",
    "crop",
    "fill",
    "filledImage",
    "frameToRgba",
    "grayscale",
    "opaque",
    "paste",
    "resizeNearest",
    "rotateNearest",
  ]);
});

test("invalid geometry and plane sizes throw RangeError", () => {
  const image = raster.filledImage([0, 0, 0, 0], 2, 2);
  const plane = { width: 2, height: 2, data: new Uint8Array(4) };
  for (const call of [
    () => raster.filledImage([0, 0, 0, 0], 1.5, 2),
    () => raster.filledImage([0, 0, 0, 0], -1, 2),
    () => raster.filledImage([0, 0, 0, 256], 1, 1),
    () => raster.fill({ rect: { x: 0.5, y: 0, width: 1, height: 1 } }, [0, 0, 0, 0], image),
    () =>
      raster.fill({ rect: { x: 0, y: 0, width: 1, height: 2 }, mask: plane }, [0, 0, 0, 0], image),
    () =>
      raster.paste({ at: { x: 0, y: 0 } }, { width: 2, height: 2, data: new Uint8Array(3) }, image),
    () => raster.paste({ at: { x: 0, y: 0 }, mask: plane }, image, image),
    () =>
      raster.fill(
        {
          rect: { x: 0, y: 0, width: 2, height: 2 },
          mask: { width: 2, height: 2, data: new Uint8Array(3) },
        },
        [0, 0, 0, 0],
        image,
      ),
    () => raster.crop({ x: 0, y: 0, width: -1, height: 1 }, image),
    () => raster.resizeNearest(2.5, 1, image),
    () => raster.channel(4, image),
  ]) {
    assert.throws(call, RangeError);
  }
  raster.fill({ rect: { x: 0, y: 0, width: 2, height: 2 }, mask: plane }, [0, 0, 0, 0], image);
});
