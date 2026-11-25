import type { RgbaImage } from "./rgbaImage.js";
import type { Rgb } from "./types.js";

interface Dimensions {
  width: number;
  height: number;
}

export interface CompositeRgbError {
  /** Opaque encoded RGB bytes, copied from the caller in input order. */
  background: Rgb;
  /** Root mean squared error over all three RGB samples of every pixel, in byte levels. */
  rmse: number;
  maxAbsoluteError: number;
}

export type RgbaComparison =
  | {
      kind: "dimension-mismatch";
      expected: Dimensions;
      actual: Dimensions;
    }
  | {
      kind: "compared";
      width: number;
      height: number;
      raw: {
        /** Exact RGBA byte equality, including RGB under zero alpha. */
        equal: boolean;
        differingPixels: number;
        differingChannels: number;
        maxAbsoluteError: number;
        alpha: { differingPixels: number; maxAbsoluteError: number };
      };
      composites: CompositeRgbError[];
    };

function validate(image: RgbaImage): void {
  if (
    !image ||
    ![image.width, image.height].every((v) => Number.isSafeInteger(v) && v > 0) ||
    !Number.isSafeInteger(image.width * image.height * 4) ||
    !(image.data instanceof Uint8Array) ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new RangeError("Image must have positive dimensions and width * height * 4 bytes");
  }
}

/**
 * Development comparison of normalized straight RGBA8, without profile inference or acceptance
 * thresholds. Raw errors include hidden RGB. Backgrounds are required; [] selects raw metrics only.
 * For each opaque background channel B, composite C=(RGB*alpha+B*(255-alpha))/255 in encoded byte
 * levels using unrounded doubles. Compare those RGB samples with RMSE=sqrt(sum(error²)/(3*pixels))
 * and maximum absolute error. These are neither linear-light nor perceptual colour metrics.
 * Unequal dimensions return only their dimensions. No input is mutated and no I/O occurs.
 */
export function compareRgba(
  options: { backgrounds: readonly Rgb[] },
  expected: RgbaImage,
  actual: RgbaImage,
): RgbaComparison {
  if (!Array.isArray(options?.backgrounds)) {
    throw new RangeError("Backgrounds must be an array");
  }
  const backgrounds: Rgb[] = [];
  for (const background of options.backgrounds) {
    if (
      !Array.isArray(background) ||
      background.length !== 3 ||
      !Array.from(background).every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    ) {
      throw new RangeError("Background must be three integers in 0..255");
    }
    backgrounds.push([background[0], background[1], background[2]]);
  }
  validate(expected);
  validate(actual);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      actual: { height: actual.height, width: actual.width },
      expected: { height: expected.height, width: expected.width },
      kind: "dimension-mismatch",
    };
  }
  const raw = {
    alpha: { differingPixels: 0, maxAbsoluteError: 0 },
    differingChannels: 0,
    differingPixels: 0,
    equal: true,
    maxAbsoluteError: 0,
  };
  for (let at = 0; at < expected.data.length; at += 4) {
    let differs = false;
    for (let channel = 0; channel < 4; channel++) {
      const error = Math.abs(expected.data[at + channel] - actual.data[at + channel]);
      if (error !== 0) {
        differs = true;
        raw.differingChannels++;
        raw.maxAbsoluteError = Math.max(raw.maxAbsoluteError, error);
        if (channel === 3) {
          raw.alpha.differingPixels++;
          raw.alpha.maxAbsoluteError = Math.max(raw.alpha.maxAbsoluteError, error);
        }
      }
    }
    if (differs) {
      raw.differingPixels++;
    }
  }
  raw.equal = raw.differingPixels === 0;
  const composites = backgrounds.map((background) => {
    let squaredError = 0,
      maxAbsoluteError = 0;
    for (let at = 0; at < expected.data.length; at += 4) {
      const ea = expected.data[at + 3],
        aa = actual.data[at + 3];
      for (let channel = 0; channel < 3; channel++) {
        const ec = (expected.data[at + channel] * ea + background[channel] * (255 - ea)) / 255;
        const ac = (actual.data[at + channel] * aa + background[channel] * (255 - aa)) / 255;
        const error = ec - ac;
        squaredError += error * error;
        maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(error));
      }
    }
    return {
      background,
      maxAbsoluteError,
      rmse: Math.sqrt(squaredError / (expected.width * expected.height * 3)),
    };
  });
  return { composites, height: expected.height, kind: "compared", raw, width: expected.width };
}
