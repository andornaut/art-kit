import assert from "node:assert/strict";

// Test-only SFNT slices and glyf semantics; not a public parser or a font rewrite mechanism.
export function tables(bytes) {
  const b = Buffer.from(bytes);
  const result = new Map();
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const at = 12 + 16 * i;
    const offset = b.readUInt32BE(at + 8),
      length = b.readUInt32BE(at + 12);
    result.set(b.toString("ascii", at, at + 4), b.subarray(offset, offset + length));
  }
  return result;
}

function glyph(t, index) {
  const loca = t.get("loca"),
    glyf = t.get("glyf");
  const short = t.get("head").readInt16BE(50) === 0;
  const offset = (i) => (short ? loca.readUInt16BE(i * 2) * 2 : loca.readUInt32BE(i * 4));
  const b = glyf.subarray(offset(index), offset(index + 1));
  if (!b.length) {
    return { empty: true };
  }
  let at = 0;
  const u16 = () => {
    const v = b.readUInt16BE(at);
    at += 2;
    return v;
  };
  const i16 = () => {
    const v = b.readInt16BE(at);
    at += 2;
    return v;
  };
  const contours = i16();
  const box = [i16(), i16(), i16(), i16()];
  if (contours >= 0) {
    const ends = Array.from({ length: contours }, u16);
    const instructions = b.subarray(at + 2, at + 2 + b.readUInt16BE(at));
    at += 2 + instructions.length;
    const flags = [];
    const count = contours ? ends.at(-1) + 1 : 0;
    while (flags.length < count) {
      const flag = b[at++];
      const repeats = flag & 8 ? b[at++] : 0;
      for (let i = 0; i <= repeats; i++) {
        flags.push(flag);
      }
    }
    const coordinate = (shortBit, sameBit) => {
      let position = 0;
      return flags.map((flag) => {
        const delta =
          flag & shortBit ? (flag & sameBit ? 1 : -1) * b[at++] : flag & sameBit ? 0 : i16();
        position += delta;
        return position;
      });
    };
    const x = coordinate(2, 16),
      y = coordinate(4, 32);
    return { box, ends, instructions, points: flags.map((flag, i) => [x[i], y[i], flag & 0x41]) };
  }
  assert.equal(contours, -1, "Composite contour marker");
  const components = [];
  let flag,
    instructionsPresent = false;
  do {
    flag = u16();
    const id = u16();
    const argument = () => {
      if (flag & 1) {
        return flag & 2 ? i16() : u16();
      }
      const value = flag & 2 ? b.readInt8(at) : b[at];
      at++;
      return value;
    };
    const args = [argument(), argument()];
    const transform = Array.from(
      { length: flag & 8 ? 1 : flag & 64 ? 2 : flag & 128 ? 4 : 0 },
      i16,
    );
    components.push({ id, args, transform, flags: flag & ~0x121 });
    instructionsPresent ||= Boolean(flag & 256);
  } while (flag & 32);
  const instructions = instructionsPresent
    ? b.subarray(at + 2, at + 2 + b.readUInt16BE(at))
    : Buffer.alloc(0);
  return { box, components, instructions };
}

/** Check all glyphs by original glyph ID and all other tables, with only defined normalization. */
export function assertFontSemantics(original, decoded) {
  const a = tables(original),
    b = tables(decoded);
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort());
  const head = (bytes) => {
    const out = Buffer.from(bytes);
    out.fill(0, 8, 12); // checkSumAdjustment follows the reconstructed SFNT serialization.
    out.writeUInt16BE(out.readUInt16BE(16) & ~0x800, 16); // Lossless-transform flag only.
    assert.ok([0, 1].includes(out.readInt16BE(50)));
    out.fill(0, 50, 52); // loca may choose a different offset representation.
    return out;
  };
  assert.deepEqual(head(a.get("head")), head(b.get("head")), "head outside allowed normalization");
  for (const [tag, bytes] of a) {
    if (!["head", "glyf", "loca"].includes(tag)) {
      assert.deepEqual(b.get(tag), bytes, `${tag}: complete table bytes`);
    }
  }
  const count = a.get("maxp").readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    assert.deepEqual(
      glyph(b, i),
      glyph(a, i),
      `Glyph ${i}: outlines, order, components and instructions`,
    );
  }
  return count;
}
