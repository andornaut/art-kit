import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  arc,
  ellipse,
  line,
  point,
  polygon,
  rectangle,
  roundedRectangle,
} from "@andornaut/art-kit/draw";

const fixtures = process.env.ART_KIT_TEST_FIXTURES;
assert.ok(fixtures, "Required ART_KIT_TEST_FIXTURES fixture directory");
const fixture = JSON.parse(readFileSync(join(fixtures, "draw.json"), "utf8"));

function background(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(
        [
          (x * 29 + y * 7) & 255,
          (x * 11 + y * 31) & 255,
          (x * 5 + y * 13 + 90) & 255,
          (x * 3 + y * 17 + 20) & 255,
        ],
        (y * width + x) * 4,
      );
    }
  }
  return { data, height, width };
}

// Fixtures record Pillow's argument shapes: [x, y] points and [x0, y0, x1, y1] boxes.
function draw({ op, args }, image) {
  const { start, end, joint, ...rest } = args;
  delete rest.box;
  delete rest.points;
  const points = args.points?.map(([x, y]) => ({ x, y }));
  const box = args.box && { x0: args.box[0], y0: args.box[1], x1: args.box[2], y1: args.box[3] };
  const style = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key,
      key === "fill" || key === "outline" ? fixture.colours[value] : value,
    ]),
  );
  if (joint) style.joint = joint;
  switch (op) {
    case "point":
      return point(style.fill, points, image);
    case "line":
      return line(style, points, image);
    case "polygon":
      return polygon(style, points, image);
    case "ellipse":
      return ellipse(style, box, image);
    case "rectangle":
      return rectangle(style, box, image);
    case "arc":
      return arc(style, box, start, end, image);
    case "roundedRectangle":
      return roundedRectangle(style, box, image);
    default:
      throw new Error(`Unknown op ${op}`);
  }
}

test("draw fixtures come from Pillow 13.0.0 and cover every operation", () => {
  assert.equal(fixture.pillow, "13.0.0");
  const ops = new Set(fixture.cases.map((c) => c.op));
  assert.deepEqual([...ops].sort(), [
    "arc",
    "ellipse",
    "line",
    "point",
    "polygon",
    "rectangle",
    "roundedRectangle",
  ]);
  assert.ok(fixture.cases.some((c) => c.error));
  assert.ok(fixture.cases.some((c) => c.rgba));
});

test("mode 1 and L targets cover the same pixels as RGBA in every fixture case", () => {
  const { L, 1: bilevel, mismatches } = fixture.equivalence;
  assert.ok(L.cases > 0 && bilevel.cases > 0);
  assert.equal(L.matched, L.cases);
  assert.equal(bilevel.matched, bilevel.cases);
  assert.deepEqual(mismatches, []);
});

for (const op of new Set(fixture.cases.map((c) => c.op))) {
  test(`${op} matches Pillow RGBA bytes exactly`, () => {
    const failures = [];
    for (const [index, c] of fixture.cases.entries()) {
      if (c.op !== op) continue;
      const image = background(...c.size);
      let threw = false;
      try {
        draw(c, image);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        threw = true;
      }
      const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
      if (threw !== Boolean(c.error) || hash !== c.sha256) failures.push(index);
      if (c.rgba)
        assert.deepEqual(Buffer.from(image.data), Buffer.from(c.rgba, "base64"), `case ${index}`);
    }
    assert.deepEqual(failures, []);
  });
}

test("drawing writes ink directly, including alpha, without blending", () => {
  const image = { data: new Uint8Array(4 * 4 * 4).fill(200), height: 4, width: 4 };
  rectangle({ fill: [10, 20, 30, 0] }, { x0: 1, y0: 1, x1: 2, y1: 2 }, image);
  assert.deepEqual([...image.data.subarray(20, 24)], [10, 20, 30, 0]);
  assert.deepEqual([...image.data.subarray(0, 4)], [200, 200, 200, 200]);
});

test("colours must be four bytes", () => {
  const image = { data: new Uint8Array(4), height: 1, width: 1 };
  assert.throws(() => point([255, 255, 255], [{ x: 0, y: 0 }], image), RangeError);
  assert.throws(() => point([256, 0, 0, 255], [{ x: 0, y: 0 }], image), RangeError);
});
