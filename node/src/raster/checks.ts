// Argument checks shared across the package; each throws RangeError naming the argument.
import type { RgbaImage } from "./rgbaImage.js";
import type { Plane, Point, Rect } from "./types.js";

function checkInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

export function checkSize(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

export function checkPositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

export function checkPoint({ x, y }: Point): void {
  checkInteger(x, "x");
  checkInteger(y, "y");
}

export function checkRect(rect: Rect): void {
  checkPoint(rect);
  checkSize(rect.width, "Width");
  checkSize(rect.height, "Height");
}

export function checkImage(image: RgbaImage): void {
  checkSize(image.width, "Image width");
  checkSize(image.height, "Image height");
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError("Image data must hold width * height * 4 bytes");
  }
}

export function checkPlane(plane: Plane): void {
  checkSize(plane.width, "Plane width");
  checkSize(plane.height, "Plane height");
  if (plane.data.length !== plane.width * plane.height) {
    throw new RangeError("Plane data must hold width * height bytes");
  }
}

// A colour of length channels, each a byte.
export function checkColour(length: number, value: readonly number[]): void {
  if (value.length !== length) {
    throw new RangeError(`Colour must have ${length} channels`);
  }
  for (const channel of value) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError("Colour channel must be an integer in 0..255");
    }
  }
}

// The constraint an integer check names: a safe integer when unbounded, else its inclusive range.
export function integerRange(min: number, max: number): string {
  return min === Number.MIN_SAFE_INTEGER && max === Number.MAX_SAFE_INTEGER
    ? "a safe integer"
    : `an integer in ${min}..${max}`;
}
