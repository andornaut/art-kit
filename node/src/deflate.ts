// zlib streams with the bytes Aseprite 1.2.30 writes into its PNG files.
//
// Aseprite 1.2.30 links libpng 1.6.38 against the zlib 1.2.11 that Skia m81 builds from Chromium's
// fork. On x86-64 CPUs with SSE4.2 and PCLMUL that fork hashes each three-byte string with the
// CRC-32C instruction into a 15-bit table, independent of memLevel; plain zlib and node:zlib produce
// different bytes. This module ports the parts of that deflate which libpng's default settings reach:
// level 6 (lazy matching, deflate_slow), the filtered strategy, memLevel 8, one input call per row,
// then Z_FINISH. Altered from the original C; the original notice follows.
//
// zlib 1.2.11, Copyright (C) 1995-2017 Jean-loup Gailly and Mark Adler. This software is provided
// 'as-is', without any express or implied warranty. In no event will the authors be held liable for
// any damages arising from the use of this software. Permission is granted to anyone to use this
// software for any purpose, including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions: 1. The origin of this software must not be
// misrepresented; you must not claim that you wrote the original software. If you use this software
// in a product, an acknowledgment in the product documentation would be appreciated but is not
// required. 2. Altered source versions must be plainly marked as such, and must not be
// misrepresented as being the original software. 3. This notice may not be removed or altered from
// any source distribution.

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
const WIN_INIT = MAX_MATCH;
// Level 6: good_length, max_lazy, nice_length and max_chain.
const GOOD_LENGTH = 8;
const MAX_LAZY = 16;
const NICE_LENGTH = 128;
const MAX_CHAIN = 128;
// The SIMD hash table size and the default memLevel's symbol buffer.
const HASH_SIZE = 1 << 15;
const LIT_BUFSIZE = 1 << (8 + 6);

const LENGTH_CODES = 29;
const LITERALS = 256;
const L_CODES = LITERALS + 1 + LENGTH_CODES;
const D_CODES = 30;
const BL_CODES = 19;
const HEAP_SIZE = 2 * L_CODES + 1;
const MAX_BITS = 15;
const MAX_BL_BITS = 7;
const END_BLOCK = 256;
const REP_3_6 = 16;
const REPZ_3_10 = 17;
const REPZ_11_138 = 18;
const STORED_BLOCK = 0;
const STATIC_TREES = 1;
const DYN_TREES = 2;

const EXTRA_LBITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const EXTRA_DBITS = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const EXTRA_BLBITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7];
const BL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function reverseBits(value: number, length: number): number {
  let code = value;
  let result = 0;
  for (let i = 0; i < length; i++) {
    result = (result << 1) | (code & 1);
    code >>>= 1;
  }
  return result;
}

// A Huffman tree's leaves and internal nodes. Len and Dad share storage in zlib; the only read that
// observes it is scan_tree's guard, which is kept as a Len write.
class Tree {
  readonly freq: Int32Array;
  readonly code: Uint16Array;
  readonly len: Uint16Array;
  readonly dad: Uint16Array;
  maxCode = 0;

  constructor(size: number) {
    this.freq = new Int32Array(size);
    this.code = new Uint16Array(size);
    this.len = new Uint16Array(size);
    this.dad = new Uint16Array(size);
  }
}

interface StaticDescription {
  readonly codes: Uint16Array | undefined;
  readonly lens: Uint16Array | undefined;
  readonly extraBits: readonly number[];
  readonly extraBase: number;
  readonly elements: number;
  readonly maxLength: number;
}

function generateCodes(
  lens: Uint16Array,
  codes: Uint16Array,
  maxCode: number,
  counts: Uint16Array,
): void {
  const next = new Uint16Array(MAX_BITS + 1);
  let code = 0;
  for (let bits = 1; bits <= MAX_BITS; bits++) {
    code = (code + counts[bits - 1]) << 1;
    next[bits] = code;
  }
  for (let n = 0; n <= maxCode; n++) {
    const len = lens[n];
    if (len !== 0) {
      codes[n] = reverseBits(next[len]++, len);
    }
  }
}

// zlib's tr_static_init tables.
const BASE_LENGTH = new Int32Array(LENGTH_CODES);
const LENGTH_CODE = new Uint8Array(MAX_MATCH - MIN_MATCH + 1);
const BASE_DIST = new Int32Array(D_CODES);
const DIST_CODE = new Uint8Array(512);
const STATIC_LTREE_LENS = new Uint16Array(L_CODES + 2);
const STATIC_LTREE_CODES = new Uint16Array(L_CODES + 2);
const STATIC_DTREE_LENS = new Uint16Array(D_CODES).fill(5);
const STATIC_DTREE_CODES = new Uint16Array(D_CODES);
{
  let length = 0;
  let code = 0;
  for (; code < LENGTH_CODES - 1; code++) {
    BASE_LENGTH[code] = length;
    for (let n = 0; n < 1 << EXTRA_LBITS[code]; n++) {
      LENGTH_CODE[length++] = code;
    }
  }
  LENGTH_CODE[length - 1] = code;
  let dist = 0;
  for (code = 0; code < 16; code++) {
    BASE_DIST[code] = dist;
    for (let n = 0; n < 1 << EXTRA_DBITS[code]; n++) {
      DIST_CODE[dist++] = code;
    }
  }
  dist >>= 7;
  for (; code < D_CODES; code++) {
    BASE_DIST[code] = dist << 7;
    for (let n = 0; n < 1 << (EXTRA_DBITS[code] - 7); n++) {
      DIST_CODE[256 + dist++] = code;
    }
  }
  const counts = new Uint16Array(MAX_BITS + 1);
  for (let n = 0; n <= 287; n++) {
    const bits = n <= 143 ? 8 : n <= 255 ? 9 : n <= 279 ? 7 : 8;
    STATIC_LTREE_LENS[n] = bits;
    counts[bits]++;
  }
  generateCodes(STATIC_LTREE_LENS, STATIC_LTREE_CODES, L_CODES + 1, counts);
  for (let n = 0; n < D_CODES; n++) {
    STATIC_DTREE_CODES[n] = reverseBits(n, 5);
  }
}

const STATIC_L_DESC: StaticDescription = {
  codes: STATIC_LTREE_CODES,
  elements: L_CODES,
  extraBase: LITERALS + 1,
  extraBits: EXTRA_LBITS,
  lens: STATIC_LTREE_LENS,
  maxLength: MAX_BITS,
};
const STATIC_D_DESC: StaticDescription = {
  codes: STATIC_DTREE_CODES,
  elements: D_CODES,
  extraBase: 0,
  extraBits: EXTRA_DBITS,
  lens: STATIC_DTREE_LENS,
  maxLength: MAX_BITS,
};
const STATIC_BL_DESC: StaticDescription = {
  codes: undefined,
  elements: BL_CODES,
  extraBase: 0,
  extraBits: EXTRA_BLBITS,
  lens: undefined,
  maxLength: MAX_BL_BITS,
};

function distCode(dist: number): number {
  return dist < 256 ? DIST_CODE[dist] : DIST_CODE[256 + (dist >>> 7)];
}

// CRC-32C without pre- or post-inversion, as the x86 crc32 instruction computes it.
const CRC32C = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
  }
  CRC32C[i] = c >>> 0;
}

class Output {
  private bytes = new Uint8Array(1024);
  length = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  private reserve(count: number): void {
    if (this.length + count > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + count));
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
  }

  byte(value: number): void {
    this.reserve(1);
    this.bytes[this.length++] = value & 0xff;
  }

  // Bits least significant first, as zlib's send_bits writes them.
  bits(value: number, length: number): void {
    this.bitBuffer |= value << this.bitCount;
    this.bitCount += length;
    while (this.bitCount >= 8) {
      this.byte(this.bitBuffer);
      this.bitBuffer >>>= 8;
      this.bitCount -= 8;
    }
  }

  // Pads to a byte boundary (bi_windup).
  align(): void {
    if (this.bitCount > 0) {
      this.byte(this.bitBuffer);
    }
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  copy(source: Uint8Array, start: number, count: number): void {
    this.reserve(count);
    this.bytes.set(source.subarray(start, start + count), this.length);
    this.length += count;
  }

  result(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

class Deflater {
  private readonly wSize: number;
  private readonly wMask: number;
  private readonly windowSize: number;
  private readonly window: Uint8Array;
  private readonly prev: Uint16Array;
  private readonly head = new Uint16Array(HASH_SIZE);
  private readonly out = new Output();
  private input: Uint8Array = new Uint8Array(0);
  private inputAt = 0;
  private strstart = 0;
  private blockStart = 0;
  private lookahead = 0;
  private matchLength = MIN_MATCH - 1;
  private prevLength = MIN_MATCH - 1;
  private matchAvailable = false;
  private matchStart = 0;
  private prevMatch = 0;
  private highWater = 0;

  private readonly dynLtree = new Tree(HEAP_SIZE);
  private readonly dynDtree = new Tree(2 * D_CODES + 1);
  private readonly blTree = new Tree(2 * BL_CODES + 1);
  private readonly blCount = new Uint16Array(MAX_BITS + 1);
  private readonly heap = new Int32Array(2 * L_CODES + 1);
  private heapLen = 0;
  private heapMax = 0;
  private readonly depth = new Uint8Array(2 * L_CODES + 1);
  private readonly symDist = new Uint16Array(LIT_BUFSIZE);
  private readonly symLc = new Uint8Array(LIT_BUFSIZE);
  private symNext = 0;
  private optLen = 0;
  private staticLen = 0;

  constructor(windowBits: number) {
    this.wSize = 1 << windowBits;
    this.wMask = this.wSize - 1;
    this.windowSize = 2 * this.wSize;
    // Chromium pads the window by eight bytes for its four-byte hash loads.
    this.window = new Uint8Array(this.windowSize + 8);
    this.prev = new Uint16Array(this.wSize);
    this.initBlock();
    // The zlib header for level 6: CINFO from the window, FLEVEL 2 and the check bits.
    let header = ((8 + ((windowBits - 8) << 4)) << 8) | (2 << 6);
    header += 31 - (header % 31);
    this.out.byte(header >>> 8);
    this.out.byte(header);
  }

  write(input: Uint8Array): void {
    this.input = input;
    this.inputAt = 0;
    this.deflateSlow(false);
  }

  finish(adler: number): Uint8Array {
    this.input = new Uint8Array(0);
    this.inputAt = 0;
    this.deflateSlow(true);
    this.out.byte(adler >>> 24);
    this.out.byte(adler >>> 16);
    this.out.byte(adler >>> 8);
    this.out.byte(adler);
    return this.out.result();
  }

  private get availIn(): number {
    return this.input.length - this.inputAt;
  }

  private maxDist(): number {
    return this.wSize - MIN_LOOKAHEAD;
  }

  // Chromium's insert_string_sse at level 6 or above: CRC-32C of the three bytes at str and a zero.
  private insertString(str: number): number {
    const w = this.window;
    let h = CRC32C[w[str] & 0xff];
    h = CRC32C[(h ^ w[str + 1]) & 0xff] ^ (h >>> 8);
    h = CRC32C[(h ^ w[str + 2]) & 0xff] ^ (h >>> 8);
    h = CRC32C[h & 0xff] ^ (h >>> 8);
    const index = h & (HASH_SIZE - 1);
    const ret = this.head[index];
    this.head[index] = str;
    this.prev[str & this.wMask] = ret;
    return ret;
  }

  // fill_window_sse: slide, read and zero WIN_INIT bytes past the data once.
  private fillWindow(): void {
    const wSize = this.wSize;
    do {
      let more = this.windowSize - this.lookahead - this.strstart;
      if (this.strstart >= wSize + this.maxDist()) {
        this.window.copyWithin(0, wSize, 2 * wSize);
        this.matchStart -= wSize;
        this.strstart -= wSize;
        this.blockStart -= wSize;
        for (let n = 0; n < HASH_SIZE; n++) {
          const m = this.head[n];
          this.head[n] = m >= wSize ? m - wSize : 0;
        }
        for (let n = 0; n < wSize; n++) {
          const m = this.prev[n];
          this.prev[n] = m >= wSize ? m - wSize : 0;
        }
        more += wSize;
      }
      if (this.availIn === 0) {
        break;
      }
      const count = Math.min(this.availIn, more);
      this.window.set(
        this.input.subarray(this.inputAt, this.inputAt + count),
        this.strstart + this.lookahead,
      );
      this.inputAt += count;
      this.lookahead += count;
    } while (this.lookahead < MIN_LOOKAHEAD && this.availIn !== 0);
    if (this.highWater < this.windowSize) {
      const current = this.strstart + this.lookahead;
      if (this.highWater < current) {
        const init = Math.min(this.windowSize - current, WIN_INIT);
        this.window.fill(0, current, current + init);
        this.highWater = current + init;
      } else if (this.highWater < current + WIN_INIT) {
        const init = Math.min(
          current + WIN_INIT - this.highWater,
          this.windowSize - this.highWater,
        );
        this.window.fill(0, this.highWater, this.highWater + init);
        this.highWater += init;
      }
    }
  }

  private longestMatch(curMatchStart: number): number {
    let curMatch = curMatchStart;
    let chainLength = MAX_CHAIN;
    const w = this.window;
    const scanStart = this.strstart;
    let bestLen = this.prevLength;
    let niceMatch = NICE_LENGTH;
    const limit = this.strstart > this.maxDist() ? this.strstart - this.maxDist() : 0;
    const strend = this.strstart + MAX_MATCH;
    let scanEnd1 = w[scanStart + bestLen - 1];
    let scanEnd = w[scanStart + bestLen];
    if (this.prevLength >= GOOD_LENGTH) {
      chainLength >>= 2;
    }
    if (niceMatch > this.lookahead) {
      niceMatch = this.lookahead;
    }
    do {
      let match = curMatch;
      if (
        w[match + bestLen] !== scanEnd ||
        w[match + bestLen - 1] !== scanEnd1 ||
        w[match] !== w[scanStart] ||
        w[++match] !== w[scanStart + 1]
      ) {
        continue;
      }
      // The hash guarantees scan[2] equals match[2].
      let scan = scanStart + 2;
      match++;
      while (
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        w[++scan] === w[++match] &&
        scan < strend
      ) {
        // Compare eight bytes per pass, as zlib does.
      }
      const len = MAX_MATCH - (strend - scan);
      if (len > bestLen) {
        this.matchStart = curMatch;
        bestLen = len;
        if (len >= niceMatch) {
          break;
        }
        scanEnd1 = w[scanStart + bestLen - 1];
        scanEnd = w[scanStart + bestLen];
      }
    } while ((curMatch = this.prev[curMatch & this.wMask]) > limit && --chainLength !== 0);
    return bestLen <= this.lookahead ? bestLen : this.lookahead;
  }

  private tally(dist: number, lc: number): boolean {
    this.symDist[this.symNext] = dist;
    this.symLc[this.symNext] = lc;
    this.symNext++;
    if (dist === 0) {
      this.dynLtree.freq[lc]++;
    } else {
      this.dynLtree.freq[LENGTH_CODE[lc] + LITERALS + 1]++;
      this.dynDtree.freq[distCode(dist - 1)]++;
    }
    return this.symNext === LIT_BUFSIZE - 1;
  }

  private flushBlock(last: boolean): void {
    this.trFlushBlock(this.blockStart >= 0, this.strstart - this.blockStart, last);
    this.blockStart = this.strstart;
  }

  // Compresses the buffered input; finish ends the stream, otherwise it stops when the input runs out.
  private deflateSlow(finish: boolean): void {
    for (;;) {
      if (this.lookahead < MIN_LOOKAHEAD) {
        this.fillWindow();
        if (this.lookahead < MIN_LOOKAHEAD && !finish) {
          return;
        }
        if (this.lookahead === 0) {
          break;
        }
      }
      let hashHead = 0;
      if (this.lookahead >= MIN_MATCH) {
        hashHead = this.insertString(this.strstart);
      }
      this.prevLength = this.matchLength;
      this.prevMatch = this.matchStart;
      this.matchLength = MIN_MATCH - 1;
      if (
        hashHead !== 0 &&
        this.prevLength < MAX_LAZY &&
        this.strstart - hashHead <= this.maxDist()
      ) {
        this.matchLength = this.longestMatch(hashHead);
        // The filtered strategy drops every match of five bytes or fewer.
        if (this.matchLength <= 5) {
          this.matchLength = MIN_MATCH - 1;
        }
      }
      if (this.prevLength >= MIN_MATCH && this.matchLength <= this.prevLength) {
        const maxInsert = this.strstart + this.lookahead - MIN_MATCH;
        const flushNow = this.tally(
          this.strstart - 1 - this.prevMatch,
          this.prevLength - MIN_MATCH,
        );
        this.lookahead -= this.prevLength - 1;
        this.prevLength -= 2;
        do {
          if (++this.strstart <= maxInsert) {
            this.insertString(this.strstart);
          }
        } while (--this.prevLength !== 0);
        this.matchAvailable = false;
        this.matchLength = MIN_MATCH - 1;
        this.strstart++;
        if (flushNow) {
          this.flushBlock(false);
        }
      } else if (this.matchAvailable) {
        if (this.tally(0, this.window[this.strstart - 1])) {
          this.flushBlock(false);
        }
        this.strstart++;
        this.lookahead--;
      } else {
        this.matchAvailable = true;
        this.strstart++;
        this.lookahead--;
      }
    }
    if (this.matchAvailable) {
      this.tally(0, this.window[this.strstart - 1]);
      this.matchAvailable = false;
    }
    this.flushBlock(true);
  }

  // ---------- trees.c ----------

  private initBlock(): void {
    this.dynLtree.freq.fill(0, 0, L_CODES);
    this.dynDtree.freq.fill(0, 0, D_CODES);
    this.blTree.freq.fill(0, 0, BL_CODES);
    this.dynLtree.freq[END_BLOCK] = 1;
    this.optLen = 0;
    this.staticLen = 0;
    this.symNext = 0;
  }

  private smaller(tree: Tree, n: number, m: number): boolean {
    const { freq } = tree;
    return freq[n] < freq[m] || (freq[n] === freq[m] && this.depth[n] <= this.depth[m]);
  }

  private downHeap(tree: Tree, start: number): void {
    const { heap } = this;
    let k = start;
    const v = heap[k];
    let j = k << 1;
    while (j <= this.heapLen) {
      if (j < this.heapLen && this.smaller(tree, heap[j + 1], heap[j])) {
        j++;
      }
      if (this.smaller(tree, v, heap[j])) {
        break;
      }
      heap[k] = heap[j];
      k = j;
      j <<= 1;
    }
    heap[k] = v;
  }

  private generateBitLengths(tree: Tree, desc: StaticDescription): void {
    const { blCount, heap } = this;
    const { maxCode } = tree;
    const { extraBase, extraBits, lens: staticLens, maxLength } = desc;
    let overflow = 0;
    blCount.fill(0);
    tree.len[heap[this.heapMax]] = 0;
    let h: number;
    for (h = this.heapMax + 1; h < HEAP_SIZE; h++) {
      const n = heap[h];
      let bits = tree.len[tree.dad[n]] + 1;
      if (bits > maxLength) {
        bits = maxLength;
        overflow++;
      }
      tree.len[n] = bits;
      if (n > maxCode) {
        continue;
      }
      blCount[bits]++;
      const xbits = n >= extraBase ? extraBits[n - extraBase] : 0;
      const f = tree.freq[n];
      this.optLen += f * (bits + xbits);
      if (staticLens) {
        this.staticLen += f * (staticLens[n] + xbits);
      }
    }
    if (overflow === 0) {
      return;
    }
    do {
      let bits = maxLength - 1;
      while (blCount[bits] === 0) {
        bits--;
      }
      blCount[bits]--;
      blCount[bits + 1] += 2;
      blCount[maxLength]--;
      overflow -= 2;
    } while (overflow > 0);
    for (let bits = maxLength; bits !== 0; bits--) {
      let n = blCount[bits];
      while (n !== 0) {
        const m = heap[--h];
        if (m > maxCode) {
          continue;
        }
        if (tree.len[m] !== bits) {
          this.optLen += (bits - tree.len[m]) * tree.freq[m];
          tree.len[m] = bits;
        }
        n--;
      }
    }
  }

  private buildTree(tree: Tree, desc: StaticDescription): void {
    const { depth, heap } = this;
    const { elements, lens: staticLens } = desc;
    let maxCode = -1;
    this.heapLen = 0;
    this.heapMax = HEAP_SIZE;
    for (let n = 0; n < elements; n++) {
      if (tree.freq[n] !== 0) {
        heap[++this.heapLen] = maxCode = n;
        depth[n] = 0;
      } else {
        tree.len[n] = 0;
      }
    }
    while (this.heapLen < 2) {
      const node = (heap[++this.heapLen] = maxCode < 2 ? ++maxCode : 0);
      tree.freq[node] = 1;
      depth[node] = 0;
      this.optLen--;
      if (staticLens) {
        this.staticLen -= staticLens[node];
      }
    }
    tree.maxCode = maxCode;
    for (let n = this.heapLen >> 1; n >= 1; n--) {
      this.downHeap(tree, n);
    }
    let node = elements;
    do {
      const n = heap[1];
      heap[1] = heap[this.heapLen--];
      this.downHeap(tree, 1);
      const m = heap[1];
      heap[--this.heapMax] = n;
      heap[--this.heapMax] = m;
      tree.freq[node] = tree.freq[n] + tree.freq[m];
      depth[node] = (depth[n] >= depth[m] ? depth[n] : depth[m]) + 1;
      tree.dad[n] = tree.dad[m] = node;
      heap[1] = node++;
      this.downHeap(tree, 1);
    } while (this.heapLen >= 2);
    heap[--this.heapMax] = heap[1];
    this.generateBitLengths(tree, desc);
    generateCodes(tree.len, tree.code, maxCode, this.blCount);
  }

  private scanTree(tree: Tree): void {
    const { maxCode } = tree;
    let prevLen = -1;
    let nextLen = tree.len[0];
    let count = 0;
    let maxCount = 7;
    let minCount = 4;
    if (nextLen === 0) {
      maxCount = 138;
      minCount = 3;
    }
    tree.len[maxCode + 1] = 0xffff;
    const bl = this.blTree.freq;
    for (let n = 0; n <= maxCode; n++) {
      const curLen = nextLen;
      nextLen = tree.len[n + 1];
      if (++count < maxCount && curLen === nextLen) {
        continue;
      } else if (count < minCount) {
        bl[curLen] += count;
      } else if (curLen !== 0) {
        if (curLen !== prevLen) {
          bl[curLen]++;
        }
        bl[REP_3_6]++;
      } else if (count <= 10) {
        bl[REPZ_3_10]++;
      } else {
        bl[REPZ_11_138]++;
      }
      count = 0;
      prevLen = curLen;
      if (nextLen === 0) {
        maxCount = 138;
        minCount = 3;
      } else if (curLen === nextLen) {
        maxCount = 6;
        minCount = 3;
      } else {
        maxCount = 7;
        minCount = 4;
      }
    }
  }

  private sendCode(code: number, tree: { code: Uint16Array; len: Uint16Array }): void {
    this.out.bits(tree.code[code], tree.len[code]);
  }

  private sendTree(tree: Tree): void {
    const { maxCode } = tree;
    let prevLen = -1;
    let nextLen = tree.len[0];
    let count = 0;
    let maxCount = 7;
    let minCount = 4;
    if (nextLen === 0) {
      maxCount = 138;
      minCount = 3;
    }
    for (let n = 0; n <= maxCode; n++) {
      const curLen = nextLen;
      nextLen = tree.len[n + 1];
      if (++count < maxCount && curLen === nextLen) {
        continue;
      } else if (count < minCount) {
        do {
          this.sendCode(curLen, this.blTree);
        } while (--count !== 0);
      } else if (curLen !== 0) {
        if (curLen !== prevLen) {
          this.sendCode(curLen, this.blTree);
          count--;
        }
        this.sendCode(REP_3_6, this.blTree);
        this.out.bits(count - 3, 2);
      } else if (count <= 10) {
        this.sendCode(REPZ_3_10, this.blTree);
        this.out.bits(count - 3, 3);
      } else {
        this.sendCode(REPZ_11_138, this.blTree);
        this.out.bits(count - 11, 7);
      }
      count = 0;
      prevLen = curLen;
      if (nextLen === 0) {
        maxCount = 138;
        minCount = 3;
      } else if (curLen === nextLen) {
        maxCount = 6;
        minCount = 3;
      } else {
        maxCount = 7;
        minCount = 4;
      }
    }
  }

  private buildBlTree(): number {
    this.scanTree(this.dynLtree);
    this.scanTree(this.dynDtree);
    this.buildTree(this.blTree, STATIC_BL_DESC);
    let maxBlIndex: number;
    for (maxBlIndex = BL_CODES - 1; maxBlIndex >= 3; maxBlIndex--) {
      if (this.blTree.len[BL_ORDER[maxBlIndex]] !== 0) {
        break;
      }
    }
    this.optLen += 3 * (maxBlIndex + 1) + 5 + 5 + 4;
    return maxBlIndex;
  }

  private sendAllTrees(lcodes: number, dcodes: number, blcodes: number): void {
    this.out.bits(lcodes - 257, 5);
    this.out.bits(dcodes - 1, 5);
    this.out.bits(blcodes - 4, 4);
    for (let rank = 0; rank < blcodes; rank++) {
      this.out.bits(this.blTree.len[BL_ORDER[rank]], 3);
    }
    this.sendTree(this.dynLtree);
    this.sendTree(this.dynDtree);
  }

  private compressBlock(
    ltree: { code: Uint16Array; len: Uint16Array },
    dtree: { code: Uint16Array; len: Uint16Array },
  ): void {
    for (let sx = 0; sx < this.symNext; sx++) {
      let dist = this.symDist[sx];
      let lc = this.symLc[sx];
      if (dist === 0) {
        this.sendCode(lc, ltree);
      } else {
        let code = LENGTH_CODE[lc];
        this.sendCode(code + LITERALS + 1, ltree);
        let extra = EXTRA_LBITS[code];
        if (extra !== 0) {
          lc -= BASE_LENGTH[code];
          this.out.bits(lc, extra);
        }
        dist--;
        code = distCode(dist);
        this.sendCode(code, dtree);
        extra = EXTRA_DBITS[code];
        if (extra !== 0) {
          dist -= BASE_DIST[code];
          this.out.bits(dist, extra);
        }
      }
    }
    this.sendCode(END_BLOCK, ltree);
  }

  private trFlushBlock(stored: boolean, storedLen: number, last: boolean): void {
    this.buildTree(this.dynLtree, STATIC_L_DESC);
    this.buildTree(this.dynDtree, STATIC_D_DESC);
    const maxBlIndex = this.buildBlTree();
    let optLenb = (this.optLen + 3 + 7) >>> 3;
    const staticLenb = (this.staticLen + 3 + 7) >>> 3;
    if (staticLenb <= optLenb) {
      optLenb = staticLenb;
    }
    const lastBit = last ? 1 : 0;
    if (storedLen + 4 <= optLenb && stored) {
      this.out.bits((STORED_BLOCK << 1) + lastBit, 3);
      this.out.align();
      this.out.byte(storedLen);
      this.out.byte(storedLen >>> 8);
      this.out.byte(~storedLen);
      this.out.byte(~storedLen >>> 8);
      this.out.copy(this.window, this.blockStart, storedLen);
    } else if (staticLenb === optLenb) {
      this.out.bits((STATIC_TREES << 1) + lastBit, 3);
      this.compressBlock(
        { code: STATIC_LTREE_CODES, len: STATIC_LTREE_LENS },
        { code: STATIC_DTREE_CODES, len: STATIC_DTREE_LENS },
      );
    } else {
      this.out.bits((DYN_TREES << 1) + lastBit, 3);
      this.sendAllTrees(this.dynLtree.maxCode + 1, this.dynDtree.maxCode + 1, maxBlIndex + 1);
      this.compressBlock(this.dynLtree, this.dynDtree);
    }
    this.initBlock();
    if (last) {
      this.out.align();
    }
  }
}

function adler32(chunks: readonly Uint8Array[]): number {
  let a = 1;
  let b = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length;) {
      const end = Math.min(chunk.length, i + 3800);
      for (; i < end; i++) {
        a += chunk[i];
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
  }
  return ((b << 16) | a) >>> 0;
}

// The zlib stream for chunks, written one deflate call per chunk and then finished.
export function deflateChunks(windowBits: number, chunks: readonly Uint8Array[]): Uint8Array {
  if (!Number.isInteger(windowBits) || windowBits < 9 || windowBits > 15) {
    throw new RangeError("windowBits must be an integer from 9 to 15");
  }
  const deflater = new Deflater(windowBits);
  for (const chunk of chunks) {
    deflater.write(chunk);
  }
  return deflater.finish(adler32(chunks));
}
