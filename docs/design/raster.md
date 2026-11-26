# Raster

`grid` draws pixel frames and `raster` resolves and processes straight RGBA images without a
canvas. Frozen Pillow 13.0.0 fixtures cover raster and drawing parity. Separate synthetic
references cover the Float32 smooth filters and inverse Oklab, which takes explicit gamut and
rounding policies. `build/compareRgba` reports raw and composite differences between decoded
images for callers to evaluate.

Reference: [Pixel frames and images](../../README.md#pixel-frames-and-images), [Development image
comparison](../../README.md#development-image-comparison), [implementation
notes](../implementation-comparison.md), [shared raster and colour
proposal](../shared-raster-colour-proposal.md), [consumer API
recommendations](../consumer-api-recommendations.md).

## Work items

| ID      | Title                                                         | Link                             |
| ------- | ------------------------------------------------------------- | -------------------------------- |
| ak-0003 | Add the raster subpath for straight-alpha RGBA operations     | [ak-0003.md](../work/ak-0003.md) |
| ak-0004 | Add the draw subpath reproducing Pillow 13.0.0 ImageDraw      | [ak-0004.md](../work/ak-0004.md) |
| ak-0006 | Add deterministic median-cut palette reduction                | [ak-0006.md](../work/ak-0006.md) |
| ak-0015 | Rework frames, grid and raster and remove the Canvas subpaths | [ak-0015.md](../work/ak-0015.md) |
| ak-0028 | Add Lanczos-3 resizing, Gaussian blur and inverse Oklab       | [ak-0028.md](../work/ak-0028.md) |
| ak-0033 | Add build RGBA comparison with explicit backgrounds           | [ak-0033.md](../work/ak-0033.md) |
| ak-0043 | Export pixel frames as SVG                                    | [ak-0043.md](../work/ak-0043.md) |
| ak-0058 | Define how drawing handles nonfinite input                    | [ak-0058.md](../work/ak-0058.md) |
