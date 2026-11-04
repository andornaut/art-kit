import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { encodeGif } from "@andornaut/art-kit/gif";
import { encodeIco } from "@andornaut/art-kit/ico";
import { decodePng } from "@andornaut/art-kit/png";

const fixtures = process.env.ART_KIT_TEST_FONTS;
assert.ok(fixtures, "Required ART_KIT_TEST_FONTS fixture directory");
// Inputs and Pillow 13.0.0 decodes, written by fixtures/pillow/pillow_reference.py.
const reference = JSON.parse(readFileSync(`${fixtures}/pillow/gif-ico.json`, "utf8"));
const image = ({ width, height, rgba }) => ({
  width,
  height,
  data: new Uint8Array(inflateSync(Buffer.from(rgba, "base64"))),
});

function lzwDecode(minCodeSize, data) {
  const clear = 1 << minCodeSize;
  const out = [];
  let table, codeSize, previous;
  const reset = () => {
    table = Array.from({ length: clear + 2 }, (_, i) => [i]);
    codeSize = minCodeSize + 1;
    previous = undefined;
  };
  reset();
  let bit = 0;
  while (bit + codeSize <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === clear + 1) return out;
    const entry = table[code] ?? [...table[previous], table[previous][0]];
    out.push(...entry);
    if (previous !== undefined && table.length < 4096) table.push([...table[previous], entry[0]]);
    if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    previous = code;
  }
  throw new Error("LZW data has no end code");
}

// Each frame's own pixels as RGBA (transparent index alpha 0), without compositing.
function parseGif(bytes) {
  let at = 0;
  const u8 = () => bytes[at++];
  const u16 = () => bytes[at++] | (bytes[at++] << 8);
  const table = (flags) => {
    const colours = [];
    for (let i = 0; i < 2 << (flags & 7); i++) colours.push([u8(), u8(), u8()]);
    return colours;
  };
  const blocks = () => {
    const parts = [];
    for (let size = u8(); size; size = u8()) parts.push(...bytes.subarray(at, (at += size)));
    return Uint8Array.from(parts);
  };
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), "GIF89a");
  at = 6;
  const gif = { width: u16(), height: u16(), loop: undefined, frames: [] };
  const flags = u8();
  at += 2;
  const global = flags & 0x80 ? table(flags) : undefined;
  let control;
  for (;;) {
    const kind = u8();
    if (kind === 0x3b) return { ...gif, trailing: bytes.length - at };
    if (kind === 0x21) {
      const label = u8();
      const data = blocks();
      if (label === 0xf9) {
        control = { disposal: (data[0] >> 2) & 7, duration: (data[1] | (data[2] << 8)) * 10, transparency: data[0] & 1 ? data[3] : undefined };
      } else if (label === 0xff) {
        assert.equal(new TextDecoder().decode(data.subarray(0, 11)), "NETSCAPE2.0");
        gif.loop = data[12] | (data[13] << 8);
      }
      continue;
    }
    assert.equal(kind, 0x2c);
    const [x, y, width, height] = [u16(), u16(), u16(), u16()];
    assert.deepEqual([x, y, width, height], [0, 0, gif.width, gif.height]);
    const local = u8();
    const colours = local & 0x80 ? table(local) : global;
    const indices = lzwDecode(u8(), blocks());
    assert.equal(indices.length, width * height);
    const data = new Uint8Array(width * height * 4);
    indices.forEach((index, i) => data.set([...colours[index], index === control?.transparency ? 0 : 255], i * 4));
    gif.frames.push({ control, local: Boolean(local & 0x80), image: { width, height, data } });
    control = undefined;
  }
}

function merged(durations, frames) {
  const kept = [];
  frames.forEach((frame, i) => {
    const last = kept.at(-1);
    if (last && Buffer.from(last.image.data).equals(Buffer.from(frame.data))) last.duration += durations[i];
    else kept.push({ image: frame, duration: durations[i] });
  });
  return kept;
}

for (const [name, { options, frames, pillow }] of Object.entries(reference.gif)) {
  test(`GIF ${name} holds every distinct frame whole with Pillow's timing and loop`, () => {
    const { duration, loop, disposal = 0 } = options;
    const inputs = frames.map(image);
    const gif = parseGif(encodeGif({ durations: duration, loop, disposal }, inputs));
    assert.equal(gif.trailing, 0);
    assert.deepEqual([gif.width, gif.height], pillow.size);
    assert.equal(gif.loop ?? null, pillow.loop);
    const durations = typeof duration === "number" ? inputs.map(() => duration) : duration;
    const kept = merged(durations, inputs);
    assert.equal(gif.frames.length, pillow.frames.length);
    gif.frames.forEach((frame, i) => {
      assert.deepEqual(frame.image, kept[i].image);
      assert.equal(frame.control?.duration ?? null, pillow.frames[i].duration);
      assert.equal(frame.control?.disposal ?? 0, disposal);
    });
  });
}

test("GIF frames beyond 256 colours together use local colour tables", () => {
  const { options, frames } = reference.gif.noise;
  const gif = parseGif(encodeGif({ durations: options.duration }, frames.map(image)));
  assert.deepEqual(gif.frames.map((frame) => frame.local), [true, true]);
  const small = parseGif(encodeGif({ durations: 10 }, reference.gif.pigeon.frames.map(image)));
  assert.ok(small.frames.every((frame) => !frame.local));
});

test("GIF rejects input it cannot encode exactly", () => {
  const pixel = (...rgba) => ({ width: 1, height: 1, data: Uint8Array.from(rgba) });
  const two = (a, b) => ({ width: 2, height: 1, data: Uint8Array.from([...a, ...b]) });
  const cases = [
    [{ durations: 10 }, [pixel(1, 2, 3, 128)], /partial alpha/],
    [{ durations: 10 }, [two([0, 0, 0, 0], [1, 1, 1, 0])], /more than one fully transparent/],
    [{ durations: 10 }, [image(reference.gif.noise.frames[0]), pixel(1, 1, 1, 255)], /is 1x1/],
    [{ durations: [10] }, [pixel(1, 1, 1, 255), pixel(2, 2, 2, 255)], /Expected 2 durations/],
    [{ durations: 10, disposal: 3 }, [pixel(1, 1, 1, 255)], /disposal/],
    [{ durations: 10, disposal: 2 }, [pixel(1, 1, 1, 255), pixel(0, 0, 0, 0)], /transparent after an opaque frame/],
    [{ durations: 10 }, [], /at least one frame/],
  ];
  for (const [options, frames, message] of cases) {
    assert.throws(() => encodeGif(options, frames), (error) => error instanceof RangeError && message.test(error.message));
  }
  const many = { width: 257, height: 1, data: new Uint8Array(257 * 4) };
  for (let i = 0; i < 257; i++) many.data.set([i & 0xff, i >> 8, 0, 255], i * 4);
  assert.throws(() => encodeGif({ durations: 10 }, [many]), RangeError);
});

for (const [name, { images, pillow }] of Object.entries(reference.ico)) {
  test(`ICO ${name} holds each supplied size as an exact PNG entry`, () => {
    const inputs = images.map(image);
    const bytes = encodeIco(inputs);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.deepEqual([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)], [0, 1, inputs.length]);
    const entries = pillow.map((_, i) => {
      const at = 6 + 16 * i;
      const size = view.getUint32(at + 8, true);
      const offset = view.getUint32(at + 12, true);
      return {
        header: [bytes[at] || 256, bytes[at + 1] || 256, view.getUint16(at + 4, true), view.getUint16(at + 6, true)],
        image: decodePng(bytes.subarray(offset, offset + size)),
      };
    });
    entries.forEach((entry, i) => {
      assert.deepEqual(entry.header, [...pillow[i].size, 1, 32]);
      assert.deepEqual(entry.image, image(pillow[i].image));
    });
  });
}

test("ICO rejects duplicate and oversized entries", () => {
  const blank = (side) => ({ width: side, height: side, data: new Uint8Array(side * side * 4) });
  assert.throws(() => encodeIco([blank(16), blank(16)]), /Duplicate/);
  assert.throws(() => encodeIco([blank(257)]), /Invalid ICO entry size/);
  assert.throws(() => encodeIco([]), RangeError);
});
