// Structural geometry, colour and plane types shared across the package. Internal: public
// modules re-export the ones in their contracts.

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

/** One 8-bit channel, one byte per pixel, row by row from the top-left. */
export interface Plane {
  data: Uint8Array;
  height: number;
  width: number;
}
