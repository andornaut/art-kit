# Shared raster and colour API proposal

Status: the reviewed three-function initial scope was explicitly approved for implementation. Original design request: `call_a78f829d3d7e440890dcb3d9fc99f779`, item 6. Package publication, consumer migration and generated game outputs remain separate decisions.

## Recommendation

Add three small mechanisms to the existing `raster` and `colour` subpaths: Lanczos-3 resizing, Gaussian blur and inverse Oklab with explicit gamut and rounding policies. Keep existing nearest sampling and OKLCH gamut mapping unchanged. Consider pixel-centre contour filling separately. Do not extract a 3D renderer, BSP scene engine or game authoring model.

These additions need no new dependency or game-kit import. Geometry and image types remain structural; palettes, materials, camera conventions and output naming remain caller-owned.

## Reviewed inputs and consumer needs

| Input | Exact revision or evidence | Present requirement |
| --- | --- | --- |
| Art-kit source | `16dc4af17c2920a2ad5a6c49b6a70540f4b43394` | Existing raster, drawing and colour contracts remain unchanged |
| Published package | v0.22.0, source `30ccd1fa13f677d09190a2fd2582c3baf2fa1309` | Relevant production modules match current source |
| Ada the Navigator | Art-confirmed baseline `e0673c7eb3c0dddf64eeca081fd9d982bd333a91` | Lanczos and blur byte semantics; inverse Oklab clips and rounds half-even |
| Archie | Art-confirmed `54c911ea80627f95c9c568f68ec25f5c227334a4`, `art/tools/pixel.ts` | Inverse Oklab rejects out-of-gamut channels and rounds half-up |
| Chibi | Art-owner needs reply | No current Lanczos, Gaussian, 3D or inverse-Oklab demand; current OKLCH path covers tonal ramps |

Ada's relevant files are `art/tools/paint.ts`, `oklab.ts`, `projection.ts`, `ship-raster.ts`, `ship-surface.ts` and `ship-paths.ts`. Read the frozen baseline, not concurrent basic-helper migration edits. Its current ship path is BSP/vector occlusion followed by material-region contours and nonzero-winding rasterization. No depth-buffer API is justified by that path.

## Proposed initial public surface

```ts
// Existing @andornaut/art-kit/raster
resizeLanczos3(width: number, height: number, source: RgbaImage): RgbaImage;
gaussianBlur(options: { sigma: number }, source: RgbaImage): RgbaImage;

// Existing @andornaut/art-kit/colour
oklabToSrgb(
  options: {
    gamut: "clip" | "reject";
    rounding: "half-even" | "half-up";
  },
  colour: readonly [number, number, number],
): [number, number, number];
```

Policy and dimensions precede the subject. Both raster operations return new images without mutating their inputs, matching the existing transform convention. No aliases or general filter/backend framework are needed.

### Lanczos-3 contract

- External pixels are encoded, straight RGBA bytes. Premultiply encoded RGB by alpha/255 into Float32; do not linearize sRGB.
- Filter horizontally, then vertically. Accumulate in JavaScript numbers and store intermediate results in Float32, preserving the baseline's operation order.
- Input/output scale determines support `3 * max(1, scale)`. Output and input samples use pixel centres. The kernel is `3 * sin(pi*x) * sin(pi*x/3) / (pi*x)^2`, one at zero and zero outside the open interval (-3, 3).
- Clip support at image edges and renormalize surviving weights. Do not replace this with repeated edge pixels or transparent padding.
- Clamp filtered alpha to [0, 255], unpremultiply RGB using that unrounded alpha, then round and clamp RGB bytes. Round alpha separately. A small positive alpha can round to zero while retaining nonzero RGB; preserve those bytes.
- Do not add an identity-size fast path that copies hidden RGB. Nearest resizing remains a different operation, including for binary-alpha masks and Chibi world sprites.

### Gaussian contract and Ada adapter

- Require finite `sigma > 0`; use support `ceil(3*sigma)` and normalized discrete weights `exp(-i*i/(2*sigma*sigma))`.
- Filter straight R, G, B and A independently, horizontally then vertically, with Float32 source/intermediate storage and final `Math.round` byte assignment.
- Repeat the image's edge samples. Do not substitute premultiplied convolution, transparent edges or a box-blur approximation.
- The shared function blurs its complete input. Ada keeps its bounds adapter: expand the requested bounds by support, floor/ceil and clip to the original image, crop that integer region, blur it, then replace that region using raw byte copying without an alpha mask or source-over compositing. Zero-alpha RGB must overwrite the previous bytes. Leave pixels outside it unchanged. This preserves the current expanded-ROI edge behavior without adding a game-specific bounds policy to the shared API.
- Ada's current zero-sigma call produces NaNs and then zero bytes in the selected region. The proposed strict positive-sigma API intentionally does not reproduce that invalid-domain behavior. Before migration, the Art owner must establish that affected calls are positive; a zero-sigma caller remains local until its intended behavior is explicitly decided. Do not silently turn it into identity.

The current blur comment describing clear pixels outside the rectangle is not the behavior contract. The actual implementation repeats the expanded region's boundary pixels.

### Inverse Oklab contract

- Reuse the existing inverse matrices and sRGB transfer cutoff 0.0031308, preserving evaluation order. Reject nonfinite triples or nonfinite conversion results with `RangeError`.
- `gamut: "clip"` clamps each linear RGB channel to [0, 1] before encoding. `"reject"` throws for an out-of-range channel, without epsilon relaxation or chroma reduction.
- `rounding: "half-even"` implements exact byte half-ties to even. `"half-up"` uses `floor(encoded*255 + 0.5)`. Do not introduce a fuzzy tie tolerance.
- Both options are required because current consumers have different contracts: Ada uses clip/half-even; Archie uses reject/half-up.
- Archie keeps LCh-to-Oklab conversion and picker policy local. Its body colour must decode the already quantized header bytes before linear-light scaling; combining those steps through unrounded channels is not equivalent.
- Existing `oklchToSrgb` keeps its chroma-reduction gamut mapping and current rounding. Chibi has no migration requirement for this proposal.

## 3D boundary and optional contour primitive

The only concrete shared raster candidate in the current 3D export path is filling already resolved contours:

```ts
// Optional later addition to @andornaut/art-kit/draw
fillContours(
  style: { fill: Rgba },
  contours: readonly (readonly Point[])[],
  target: RgbaImage,
): void;
```

Its fixed rule is nonzero winding. Preserve fractional coordinates; sample rows at `y+0.5`, include lower and exclude upper edge endpoints, stable-sort crossings by x, and fill centres in `[left,right)` using `ceil(edge-0.5)`. Clip to the target and replace RGBA bytes directly, with no antialiasing or source-over blending. Contour orientation controls holes. This differs from the existing Pillow-style polygon coordinate truncation; do not change `draw.polygon`.

Keep the following in Ada: camera and projection formulas, yaw/headings, pivots and anchor precision, topology, facing thresholds, BSP tolerances and coplanar order, visible-material union, hole ownership, facet shading and SVG serialization. The current occlusion path is not mean-depth sorting. Generic matrix projection also cannot promise byte identity merely because it is algebraically equivalent: changed floating-point evaluation can move a boundary pixel.

A shared 3D occlusion engine would need a separate contract and approval covering those actual geometric requirements. No second consumer currently requests it. This proposal recommends no public 3D renderer or projection-policy API now.

Ada's bytewise blend is another optional, separate mechanism: every channel, including alpha, is `clamp(trunc(a+t*(b-a)),0,255)`, with extrapolation permitted. It is not source-over or linear-light interpolation. Retain it locally in the initial scope; no blend API is needed to deliver the three recommended additions.

## Proof required before migration claims

Byte preservation means equal dimensions and every decoded RGBA byte, including RGB under zero alpha. Encoded PNG equality additionally requires unchanged encoder settings, colour type and dependency/runtime pins. SVG and metadata text equality are separate criteria. Focused implementation checks compare synthetic frozen reference bytes. Actual consumer output equivalence remains unverified until the owning Art role performs its scoped migration review.

Use palette-independent frozen probes from the baseline for Lanczos identity/up/down/anisotropic sampling, boundaries and alpha 0/1/254/255; Gaussian fractional sigma, repeated edges and expanded Ada regions; and inverse colour thresholds, clipping/rejection and exact half-ties. Include Archie's quantized-header/body sequence. If contour filling is later approved, cover holes, shared vertices, coincident crossings, reversed winding, half-pixel edges and clipping.

Consumer Art owns scoped before/after checks of affected approved outputs. Ada references include `public/art/aboard.png`, `public/art/app-icon/icon-512.png`, `public/art/ship-26.svg` and `public/art/paint/iris/ship-26.svg`. Compare actual artifacts and rendered pixels at consistent scales before a production-ready claim, preserving earlier approved details. Keep consumer assets and their licences outside the helper-code release.

## Approval and delivery boundary

Ada Art reviewed the design boundary and current numerical semantics. Archie Art independently checked the inverse matrices, cutoff and reject/half-up contract against its valid callers; future migration must compare the exact seven picker colours, their order and header/body sequence. Chibi Art confirmed no current demand for these additions. These are design reviews, not implementation, adoption or byte-parity approvals.

The design request is satisfied by this proposal and source/consumer review. The user approved implementation of the three-function initial scope, including strict positive sigma and explicit colour policies. Contour filling, blend and any 3D engine remain separate proposals.

Delivery uses focused worker checks, prompt reviewed integration into local main, one combined exact-main gate, then exact-main CI. The additive source candidate is version 0.23.0; package publication remains a separate decision. Publish a checked canonical artifact before any owner-approved consumer adoption. Existing game delivery continues independently; design completion is not a delivery pause.
