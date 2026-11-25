// PNG file structure and filter arithmetic shared by the encoders.
// Internal: no package subpath exports it.
import { crc32 } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export function predict(
  type: number,
  bpp: number,
  previous: Uint8Array,
  row: Uint8Array,
  x: number,
): number {
  switch (type) {
    case 1:
      return x >= bpp ? row[x - bpp] : 0;
    case 2:
      return previous[x];
    case 3:
      return ((x >= bpp ? row[x - bpp] : 0) + previous[x]) >> 1;
    case 4: {
      const left = x >= bpp ? row[x - bpp] : 0;
      const above = previous[x];
      const upLeft = x >= bpp ? previous[x - bpp] : 0;
      const paeth = left + above - upLeft;
      const pLeft = Math.abs(paeth - left);
      const pAbove = Math.abs(paeth - above);
      const pUpLeft = Math.abs(paeth - upLeft);
      if (pLeft <= pAbove && pLeft <= pUpLeft) {
        return left;
      }
      return pAbove <= pUpLeft ? above : upLeft;
    }
    default:
      return 0;
  }
}

// The bytes a chunk holding pieces occupies: length, type, data and CRC.
function chunkLength(pieces: readonly Uint8Array[]): number {
  return 12 + pieces.reduce((total, piece) => total + piece.length, 0);
}

// Writes the chunk of type holding pieces in order at out[at] and returns the offset after it.
function writeChunk(
  at: number,
  type: string,
  pieces: readonly Uint8Array[],
  out: Uint8Array,
): number {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let end = at + 8;
  for (const piece of pieces) {
    out.set(piece, end);
    end += piece.length;
  }
  view.setUint32(at, end - at - 8);
  for (let i = 0; i < 4; i++) {
    out[at + 4 + i] = type.charCodeAt(i);
  }
  view.setUint32(end, crc32(out.subarray(at + 4, end)));
  return end + 4;
}

// The signature followed by each [type, pieces] chunk in order.
export function pngFile(
  chunks: readonly (readonly [type: string, pieces: readonly Uint8Array[]])[],
): Uint8Array {
  const out = new Uint8Array(
    chunks.reduce((total, [, pieces]) => total + chunkLength(pieces), PNG_SIGNATURE.length),
  );
  out.set(PNG_SIGNATURE, 0);
  let at = PNG_SIGNATURE.length;
  for (const [type, pieces] of chunks) {
    at = writeChunk(at, type, pieces, out);
  }
  return out;
}
