// Straight (non-premultiplied) RGBA raster operations; the smooth filters use their documented
// Float32 contracts, and other operations use Pillow 13.0.0 parity rounding.
// An opaque (RGB) image is an RgbaImage whose alpha is 255. fill, paste and
// composite mutate their target; every other function returns a new image or plane.
export { channel, type ChannelIndex, gaussianBlur, grayscale, opaque } from "./filters.js";
export {
  type ColourContext,
  composeContactSheet,
  composeSheet,
  type ContactSheetOptions,
  frameToRgba,
  type SheetOptions,
  type Sprite,
  type Tag,
} from "./frames.js";
export {
  composite,
  crop,
  fill,
  filledImage,
  type FillOptions,
  paste,
  type PasteOptions,
} from "./pixels.js";
export { resizeLanczos3, resizeNearest, rotateNearest } from "./resample.js";
export type { Plane, Rgb, Rgba } from "./types.js";
