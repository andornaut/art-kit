import assert from "node:assert/strict";
import { test } from "node:test";
import { packAtlas } from "@andornaut/art-kit/atlasLayout";
import { buildAtlasPages, drawAtlasPage } from "@andornaut/art-kit/atlasBuild";
import { blankImage, blitExtruded } from "@andornaut/art-kit/rgbaImage";

const item = (value, ...sizes) => ({
  value,
  rectangles: sizes.map(([width, height]) => ({ width, height })),
});
const policy = { compare: () => 0, extrude: 1, maxSize: 10, widths: [10] };

test("atomic multirect placement rolls back and retries on a new page", () => {
  const first = item("first", [4, 4]);
  const frames = item("frames", [2, 2], [4, 4]);
  assert.deepEqual(packAtlas(policy, [first, frames]).pages, [
    { height: 6, width: 10, placed: [{ at: [{ x: 1, y: 1 }], item: first }] },
    {
      height: 6,
      width: 10,
      placed: [
        {
          at: [
            { x: 1, y: 1 },
            { x: 5, y: 1 },
          ],
          item: frames,
        },
      ],
    },
  ]);
  assert.equal(packAtlas(policy, [item("oversize", [9, 1])]), undefined);
  assert.equal(packAtlas(policy, [item("atomic", [8, 8], [8, 8])]), undefined);
});

test("layout chooses page count then area then first width and preserves input order", () => {
  const items = [item("b", [2, 2]), item("a", [2, 2])];
  assert.equal(
    packAtlas({ ...policy, maxSize: 8, widths: [4, 8] }, [
      ...items,
      item("c", [2, 2]),
    ]).width,
    8,
  );
  assert.equal(packAtlas({ ...policy, widths: [10, 8] }, items).width, 8);
  assert.equal(packAtlas({ ...policy, widths: [8, 4] }, items).width, 8);
  const result = packAtlas(
    { ...policy, compare: (a, b) => a.value.localeCompare(b.value) },
    items,
  );
  assert.deepEqual(
    result.pages[0].placed.map(({ item }) => item.value),
    ["a", "b"],
  );
  assert.deepEqual(
    items.map(({ value }) => value),
    ["b", "a"],
  );
  assert.deepEqual(packAtlas(policy, []), { pages: [], width: 10 });
});

test("extrusion reads original bounds and retains RGB under zero alpha", () => {
  const source = {
    width: 3,
    height: 1,
    data: Uint8Array.from([1, 2, 3, 0, 4, 5, 6, 128, 7, 8, 9, 255]),
  };
  const target = blankImage(3, 3);
  blitExtruded(
    source,
    { x: 1, y: 0, width: 1, height: 1 },
    1,
    target,
    { x: 1, y: 1 },
    { x: 0, y: 0, width: 3, height: 1 },
  );
  assert.deepEqual(
    target.data,
    Uint8Array.from([...source.data, ...source.data, ...source.data]),
  );
  const clamped = blankImage(3, 3);
  blitExtruded(source, { x: 0, y: 0, width: 1, height: 1 }, 1, clamped, {
    x: 1,
    y: 1,
  });
  assert.deepEqual(
    clamped.data,
    Uint8Array.from(Array(9).fill([1, 2, 3, 0]).flat()),
  );
});

test("page build shares decoding, bypasses supplied images and preserves metadata order", async () => {
  const image = { width: 1, height: 1, data: Uint8Array.from([1, 2, 3, 0]) };
  const reads = [];
  let decodes = 0;
  let encodes = 0;
  const pages = ["shared", "shared", "supplied"].map((source, metadata) => ({
    width: 1,
    height: 1,
    metadata,
    blits: [
      { source, from: { x: 0, y: 0, width: 1, height: 1 }, at: { x: 0, y: 0 } },
    ],
  }));
  const result = await buildAtlasPages(
    {
      read: async (source) => {
        reads.push(source);
        return image.data;
      },
      decode: async () => {
        decodes++;
        return image;
      },
      encode: async (value) => {
        encodes++;
        return value.data;
      },
      decoded: new Map([["supplied", image]]),
      extrude: 0,
    },
    pages,
  );
  assert.deepEqual(reads, ["shared"]);
  assert.equal(decodes, 1);
  assert.equal(encodes, 3);
  assert.deepEqual(
    result.map(({ metadata }) => metadata),
    [0, 1, 2],
  );
  for (const page of result) assert.deepEqual(page.image, image);
  const failure = new Error("read failed");
  await assert.rejects(
    buildAtlasPages(
      {
        read: async () => {
          throw failure;
        },
        decode: () => image,
        encode: () => image.data,
        extrude: 0,
      },
      pages,
    ),
    (error) => error === failure,
  );
  assert.throws(
    () => drawAtlasPage(0, new Map(), pages[0]),
    /No atlas source for shared/,
  );
});
