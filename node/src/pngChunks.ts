// PNG file structure shared by the encoders: the signature and length-type-data-CRC chunks.
// Internal: no package subpath exports it.
import { crc32 } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

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
  for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
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
  for (const [type, pieces] of chunks) at = writeChunk(at, type, pieces, out);
  return out;
}
