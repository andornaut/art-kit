import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildAtlasPages, drawAtlasPage } from "@andornaut/art-kit/atlasBuild";
import { packAtlas } from "@andornaut/art-kit/atlasLayout";
import { decodePng, encodeRgbaPng } from "@andornaut/art-kit/png";
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
    packAtlas({ ...policy, maxSize: 8, widths: [4, 8] }, [...items, item("c", [2, 2])]).width,
    8,
  );
  assert.equal(packAtlas({ ...policy, widths: [10, 8] }, items).width, 8);
  assert.equal(packAtlas({ ...policy, widths: [8, 4] }, items).width, 8);
  const result = packAtlas({ ...policy, compare: (a, b) => a.value.localeCompare(b.value) }, items);
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
    {
      from: { x: 1, y: 0, width: 1, height: 1 },
      extrude: 1,
      at: { x: 1, y: 1 },
      bounds: { x: 0, y: 0, width: 3, height: 1 },
    },
    source,
    target,
  );
  assert.deepEqual(target.data, Uint8Array.from([...source.data, ...source.data, ...source.data]));
  const clamped = blankImage(3, 3);
  blitExtruded(
    { from: { x: 0, y: 0, width: 1, height: 1 }, extrude: 1, at: { x: 1, y: 1 } },
    source,
    clamped,
  );
  assert.deepEqual(clamped.data, Uint8Array.from(Array(9).fill([1, 2, 3, 0]).flat()));
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
    blits: [{ source, from: { x: 0, y: 0, width: 1, height: 1 }, at: { x: 0, y: 0 } }],
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
  for (const page of result) {
    assert.deepEqual(page.image, image);
  }
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
  assert.throws(() => drawAtlasPage(0, new Map(), pages[0]), /No atlas source for shared/);
});

test("packs wide strips and tall and wide rectangles once into bounded nonoverlapping extruded cells", () => {
  for (const [name, sizes] of [
    [
      "wide strips",
      [
        [672, 42],
        [384, 80],
        [300, 36],
        [250, 26],
      ],
    ],
    [
      "tall and wide rectangles",
      [
        [48, 720],
        [640, 96],
        [336, 272],
        [96, 204],
      ],
    ],
  ]) {
    const items = sizes.map((size, index) => item(index, size));
    const extrude = 1;
    const maxSize = 2048;
    const result = packAtlas({ ...policy, extrude, maxSize, widths: [maxSize] }, items);
    assert.ok(result, `${name} packs`);
    const placed = [];
    for (const page of result.pages) {
      assert.ok(page.width <= maxSize && page.height <= maxSize, `${name} page size`);
      const cells = [];
      for (const { at, item: entry } of page.placed) {
        placed.push(entry.value);
        assert.equal(at.length, entry.rectangles.length, `${name} placements`);
        for (const [index, rectangle] of entry.rectangles.entries()) {
          const left = at[index].x - extrude;
          const top = at[index].y - extrude;
          const right = left + rectangle.width + 2 * extrude;
          const bottom = top + rectangle.height + 2 * extrude;
          assert.ok(
            left >= 0 && top >= 0 && right <= page.width && bottom <= page.height,
            `${name} cell within page`,
          );
          for (const other of cells) {
            assert.ok(
              right <= other.left ||
                other.right <= left ||
                bottom <= other.top ||
                other.bottom <= top,
              `${name} cells do not overlap`,
            );
          }
          cells.push({ left, top, right, bottom });
        }
      }
    }
    assert.deepEqual(
      placed.sort((a, b) => a - b),
      items.map(({ value }) => value),
      `${name} places every item once`,
    );
  }
});

test("page build propagates synchronous and asynchronous codec failures by identity", async () => {
  const failure = new Error("codec failure");
  const image = blankImage(1, 1);
  for (const encode of [
    () => {
      throw failure;
    },
    async () => {
      throw failure;
    },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      buildAtlasPages(
        {
          read: async () => image.data,
          decode: () => image,
          encode,
          extrude: 0,
        },
        [{ width: 1, height: 1, blits: [], metadata: null }],
      ),
      (error) => error === failure,
    );
  }
});

// The check container runs with an open-file limit of 256, so reading every source at once fails.
test("page build reads 2000 distinct files within a low open-file limit, in order", async () => {
  const count = 2000;
  const directory = await mkdtemp(join(tmpdir(), "atlas-sources-"));
  try {
    const options = { deflateLevel: 9, deflateStrategy: 3, filterType: -1 };
    const paths = [];
    for (let i = 0; i < count; i++) {
      const pixel = blankImage(1, 1);
      pixel.data.set([i & 0xff, i >> 8, 7, 255]);
      paths.push(join(directory, `${i}.png`));
      // eslint-disable-next-line no-await-in-loop
      await writeFile(paths[i], encodeRgbaPng(options, pixel));
    }
    const page = {
      blits: paths.map((source, x) => ({
        at: { x, y: 0 },
        from: { height: 1, width: 1, x: 0, y: 0 },
        source,
      })),
      height: 1,
      metadata: "page",
      width: count,
    };
    const [result] = await buildAtlasPages(
      { decode: decodePng, encode: (image) => image.data, extrude: 0, read: readFile },
      [page],
    );
    assert.equal(result.metadata, "page");
    for (let i = 0; i < count; i++) {
      assert.deepEqual(
        [...result.image.data.subarray(i * 4, i * 4 + 4)],
        [i & 0xff, i >> 8, 7, 255],
      );
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
