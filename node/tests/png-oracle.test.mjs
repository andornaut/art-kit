// The PNG encoders must write exactly the bytes pngjs 7.0.0 PNG.sync.write writes, which this
// suite calls as the oracle.
import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { encodeRgbPng, encodeRgbaPng } from "@andornaut/art-kit/png";

const ENCODERS = [
  { name: "RGBA", encode: encodeRgbaPng, pngjsOptions: { colorType: 6 } },
  { name: "RGB", encode: encodeRgbPng, pngjsOptions: { colorType: 2, inputHasAlpha: true } },
];

function pngjsBytes(pngjsOptions, options, { data, height, width }) {
  const png = new PNG({ height, width });
  png.data = Buffer.from(data);
  return PNG.sync.write(png, { ...pngjsOptions, ...options });
}

// Bytes or the thrown error's name and message, so failures compare like results.
function outcome(encode) {
  try {
    return Buffer.from(encode()).toString("hex");
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}

function assertMatchesPngjs(options, image, label) {
  for (const { name, encode, pngjsOptions } of ENCODERS) {
    const source =
      name === "RGB"
        ? { ...image, data: image.data.map((value, i) => (i % 4 === 3 ? 255 : value)) }
        : image;
    assert.equal(
      outcome(() => encode(options, source)),
      outcome(() => pngjsBytes(pngjsOptions, options, source)),
      `${name} ${label} ${JSON.stringify(options)}`,
    );
  }
}

let seed = 1;
const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
const CONTENT = {
  random: () => random(),
  flat: (x, y, channel) => [77, 120, 3, 255][channel],
  gradient: (x, y, channel) => (x * 3 + y * 5 + channel * 40) & 255,
  sparse: (x, y, channel) => (random() < 24 ? random() : (x >> 3) * 16 + channel),
};

function image(content, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        data[(y * width + x) * 4 + channel] = CONTENT[content](x, y, channel);
      }
    }
  }
  return { data, height, width };
}

const FILTER_TYPES = [-1, 0, 1, 2, 3, 4];

test("small images match pngjs for every level, strategy and filter type", () => {
  const sizes = [[0, 0], [0, 3], [3, 0], [1, 1], [1, 17], [17, 1], [7, 5], [33, 9]];
  for (const [width, height] of sizes) {
    for (const content of Object.keys(CONTENT)) {
      const pixels = image(content, width, height);
      for (const deflateLevel of [-1, 0, 1, 6, 9]) {
        for (const deflateStrategy of [0, 1, 2, 3, 4]) {
          for (const filterType of FILTER_TYPES) {
            assertMatchesPngjs({ deflateLevel, deflateStrategy, filterType }, pixels, `${content} ${width}x${height}`);
          }
        }
      }
    }
  }
});

// Larger than one zlib call's batch and the 32 KiB window, and rows longer than a batch, so
// the stream spans many calls and window slides.
test("multi-batch images match pngjs", () => {
  const cases = [
    ["sparse", 300, 200],
    ["random", 257, 63],
    ["gradient", 16400, 2],
    ["sparse", 5, 20000],
  ];
  for (const [content, width, height] of cases) {
    const pixels = image(content, width, height);
    for (const [deflateLevel, deflateStrategy] of [[0, 0], [1, 0], [6, 0], [9, 1], [9, 2], [9, 3], [4, 4]]) {
      for (const filterType of [-1, 0, 4]) {
        assertMatchesPngjs({ deflateLevel, deflateStrategy, filterType }, pixels, `${content} ${width}x${height}`);
      }
    }
  }
});

test("options and images pngjs treats specially match pngjs, including its errors", () => {
  const pixels = image("random", 9, 4);
  const valid = { deflateLevel: 9, deflateStrategy: 0, filterType: -1 };
  for (const [options, source] of [
    [{ deflateLevel: 9, deflateStrategy: 0 }, pixels],
    [{ deflateLevel: undefined, deflateStrategy: null, filterType: 2 }, pixels],
    [{ deflateLevel: 9, deflateStrategy: 0, filterType: 7 }, pixels],
    [{ deflateLevel: 9, deflateStrategy: 0, filterType: undefined }, pixels],
    [{ ...valid, bitDepth: 16 }, pixels],
    [{ ...valid, colorType: 0 }, pixels],
    [{ ...valid, deflateLevel: 12 }, pixels],
    [{ ...valid, deflateStrategy: 9 }, pixels],
    [valid, { ...pixels, data: pixels.data.subarray(0, 100) }],
    [valid, { ...pixels, height: 2 }],
    [valid, { ...pixels, width: 8.5 }],
  ]) {
    assertMatchesPngjs(options, source, `${source.width}x${source.height}/${source.data.length}`);
  }
});
