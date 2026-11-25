// Resampling: nearest-pixel scaling and rotation with Pillow 13.0.0 parity, and Lanczos-3 with
// its documented Float32 contract. Every function returns a new image.
import { checkImage, checkPositive, checkSize } from "./checks.js";
import { clone } from "./pixels.js";
import type { RgbaImage } from "./rgbaImage.js";

// Geometry.c ImagingScaleAffine with fill: source x starts at x offset + 0.5 * x scale and
// accumulates the scale in double precision, truncated toward zero (negative is outside). Columns
// between the first and last valid ones keep source column 0 when invalid, as Pillow's table does.
function scaleAffine(
  [xScale, xOffset, yScale, yOffset]: readonly [number, number, number, number],
  width: number,
  height: number,
  source: RgbaImage,
): RgbaImage {
  const out = { data: new Uint8Array(width * height * 4), height, width };
  const columns = new Int32Array(width);
  let xmin = width,
    xmax = 0,
    xo = xOffset + xScale * 0.5,
    yo = yOffset + yScale * 0.5;
  for (let x = 0; x < width; x++, xo += xScale) {
    const xin = xo < 0 ? -1 : Math.trunc(xo);
    if (xin >= 0 && xin < source.width) {
      xmax = x + 1;
      xmin = Math.min(xmin, x);
      columns[x] = xin;
    }
  }
  for (let y = 0; y < height; y++, yo += yScale) {
    const yin = yo < 0 ? -1 : Math.trunc(yo);
    if (yin < 0 || yin >= source.height) {
      continue;
    }
    for (let x = xmin; x < xmax; x++) {
      const read = (yin * source.width + columns[x]) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * width + x) * 4);
    }
  }
  return out;
}

/**
 * image resampled to width x height by nearest pixel centre, copying RGBA exactly (including RGB
 * under clear alpha). An integer multiple of the source size replicates each pixel. Sampling
 * accumulates in/out in double precision from half a step, as the parity reference does.
 */
export function resizeNearest(width: number, height: number, source: RgbaImage): RgbaImage {
  checkSize(width, "Width");
  checkSize(height, "Height");
  checkImage(source);
  return scaleAffine([source.width / width, 0, source.height / height, 0], width, height, source);
}

/** Encoded RGB premultiplied Lanczos-3, clipped normalized support, Float32 passes. */
export function resizeLanczos3(width: number, height: number, source: RgbaImage): RgbaImage {
  checkPositive(width, "Width");
  checkPositive(height, "Height");
  checkImage(source);
  checkPositive(source.width, "Image width");
  checkPositive(source.height, "Image height");
  const premultiplied = new Float32Array(source.width * source.height * 4);
  for (let i = 0; i < source.width * source.height; i++) {
    const a = source.data[i * 4 + 3] / 255;
    premultiplied[i * 4] = source.data[i * 4] * a;
    premultiplied[i * 4 + 1] = source.data[i * 4 + 1] * a;
    premultiplied[i * 4 + 2] = source.data[i * 4 + 2] * a;
    premultiplied[i * 4 + 3] = source.data[i * 4 + 3];
  }
  const across = lanczosPass(source.width, source.height, width, true, premultiplied);
  const down = lanczosPass(width, source.height, height, false, across);
  const out = { data: new Uint8Array(width * height * 4), height, width };
  for (let i = 0; i < width * height; i++) {
    const a = Math.min(255, Math.max(0, down[i * 4 + 3]));
    const k = a > 0 ? 255 / a : 0;
    for (let c = 0; c < 3; c++) {
      out.data[i * 4 + c] = Math.min(255, Math.max(0, Math.round(down[i * 4 + c] * k)));
    }
    out.data[i * 4 + 3] = Math.round(a);
  }
  return out;
}

function lanczos(x: number): number {
  if (x === 0) {
    return 1;
  }
  if (x <= -3 || x >= 3) {
    return 0;
  }
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

function lanczosPass(
  width: number,
  height: number,
  size: number,
  horizontal: boolean,
  data: Float32Array,
): Float32Array {
  const length = horizontal ? width : height;
  const other = horizontal ? height : width;
  const scale = length / size;
  const support = 3 * Math.max(1, scale);
  const out = new Float32Array((horizontal ? size * height : width * size) * 4);
  for (let i = 0; i < size; i++) {
    const centre = (i + 0.5) * scale;
    const from = Math.max(0, Math.floor(centre - support));
    const to = Math.min(length, Math.ceil(centre + support));
    const weights: number[] = [];
    let total = 0;
    for (let j = from; j < to; j++) {
      const w = lanczos((j - centre + 0.5) / Math.max(1, scale));
      weights.push(w);
      total += w;
    }
    for (let o = 0; o < other; o++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = from; j < to; j++) {
        const w = weights[j - from] / total;
        const s = (horizontal ? o * width + j : j * width + o) * 4;
        r += data[s] * w;
        g += data[s + 1] * w;
        b += data[s + 2] * w;
        a += data[s + 3] * w;
      }
      const t = (horizontal ? o * size + i : i * width + o) * 4;
      out[t] = r;
      out[t + 1] = g;
      out[t + 2] = b;
      out[t + 3] = a;
    }
  }
  return out;
}

// The nearest 15-decimal value, ties to even. toFixed rounds an exact
// tie up, so a tie (the exact expansion ends in 5 at the 16th decimal) is resolved separately.
function round15(value: number): number {
  const exact = Math.abs(value).toFixed(100);
  const point = exact.indexOf(".");
  if (/^50*$/.test(exact.slice(point + 16))) {
    const down = exact.slice(0, point + 16);
    const last = Number(down.at(-1));
    const rounded = last % 2 === 0 ? Number(down) : Number(Math.abs(value).toFixed(15));
    return Math.sign(value) * rounded || value * 0;
  }
  return Number(value.toFixed(15)) || value * 0;
}

function rotate180(source: RgbaImage): RgbaImage {
  const out = clone(source);
  const count = source.width * source.height;
  for (let i = 0; i < count; i++) {
    out.data.set(source.data.subarray(i * 4, i * 4 + 4), (count - 1 - i) * 4);
  }
  return out;
}

// Square transposes: ROTATE_90 is counter-clockwise, ROTATE_270 clockwise.
function rotateSquare(clockwise: boolean, source: RgbaImage): RgbaImage {
  const n = source.width;
  const out = clone(source);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [sx, sy] = clockwise ? [y, n - 1 - x] : [n - 1 - y, x];
      const read = (sy * n + sx) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * n + x) * 4);
    }
  }
  return out;
}

/**
 * image rotated counter-clockwise by angle degrees about its centre by nearest pixel, keeping its
 * size; uncovered pixels are (0,0,0,0). Multiples of 90 degrees that keep the shape are exact
 * transposes. Other angles reproduce Pillow's rotation matrix (cos and sin rounded to 15
 * decimals) and its nearest affine sampling: 16.16 fixed point when every corner maps inside
 * +-32768, double precision otherwise.
 */
export function rotateNearest(angle: number, source: RgbaImage): RgbaImage {
  if (!Number.isFinite(angle)) {
    throw new RangeError("Angle must be finite");
  }
  checkImage(source);
  // Floored modulo into 0..360; -0 compares equal to 0 below.
  let degrees = angle % 360;
  if (degrees < 0) {
    degrees += 360;
  }
  if (degrees === 0) {
    return clone(source);
  }
  if (degrees === 180) {
    return rotate180(source);
  }
  if ((degrees === 90 || degrees === 270) && source.width === source.height) {
    return rotateSquare(degrees === 270, source);
  }
  const { height: h, width: w } = source;
  const [cx, cy] = [w / 2, h / 2];
  const radians = -(degrees * (Math.PI / 180));
  const a = [
    round15(Math.cos(radians)),
    round15(Math.sin(radians)),
    0,
    round15(-Math.sin(radians)),
    round15(Math.cos(radians)),
    0,
  ];
  const [tx, ty] = [-cx, -cy];
  [a[2], a[5]] = [a[0] * tx + a[1] * ty + a[2], a[3] * tx + a[4] * ty + a[5]];
  a[2] += cx;
  a[5] += cy;
  if (a[1] === 0 && a[3] === 0) {
    return scaleAffine([a[0], a[2], a[4], a[5]], w, h, source);
  }
  const out = { data: new Uint8Array(w * h * 4), height: h, width: w };
  const write = (x: number, y: number, xin: number, yin: number): void => {
    if (xin >= 0 && xin < w && yin >= 0 && yin < h) {
      const read = (yin * w + xin) * 4;
      out.data.set(source.data.subarray(read, read + 4), (y * w + x) * 4);
    }
  };
  const fixed = (x: number, y: number): boolean =>
    Math.abs(x * a[0] + y * a[1] + a[2]) < 32768 && Math.abs(x * a[3] + y * a[4] + a[5]) < 32768;
  if (fixed(0, 0) && fixed(w, h) && fixed(0, h) && fixed(w, 0)) {
    const fix = (v: number): number => Math.floor(v * 65536 + 0.5) | 0;
    const [a0, a1, a3, a4] = [fix(a[0]), fix(a[1]), fix(a[3]), fix(a[4])];
    let a2 = fix(a[2] + a[0] * 0.5 + a[1] * 0.5),
      a5 = fix(a[5] + a[3] * 0.5 + a[4] * 0.5);
    for (let y = 0; y < h; y++, a2 = (a2 + a1) | 0, a5 = (a5 + a4) | 0) {
      let xx = a2,
        yy = a5;
      for (let x = 0; x < w; x++, xx = (xx + a0) | 0, yy = (yy + a3) | 0) {
        write(x, y, xx >> 16, yy >> 16);
      }
    }
    return out;
  }
  const coord = (v: number): number => (v < 0 ? -1 : Math.trunc(v));
  let xo = a[2] + a[1] * 0.5 + a[0] * 0.5,
    yo = a[5] + a[4] * 0.5 + a[3] * 0.5;
  for (let y = 0; y < h; y++, xo += a[1], yo += a[4]) {
    let xx = xo,
      yy = yo;
    for (let x = 0; x < w; x++, xx += a[0], yy += a[3]) {
      write(x, y, coord(xx), coord(yy));
    }
  }
  return out;
}
