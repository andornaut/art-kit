# Consumer API recommendations

Status: consultation only, based on Ada the Navigator, Archie and Chibi Art-owner findings. The three raster/colour functions already approved for implementation remain independent. No additional implementation, deletion, consumer migration or publication is approved here.

## Ranked recommendations

1. **Use existing mechanisms before adding interfaces.** Ada and Archie retain small adapters where legacy numeric domains or alpha rules differ. Chibi has already replaced its local hex parser with `colour.rgb(hex)`, with exact colour/material comparisons and unchanged served assets. Keep strict shared validation, one image representation and context before the subject. Document domains, alpha semantics and output shapes rather than adding permissive modes or parser aliases.
2. **Finish the approved numerical additions.** `resizeLanczos3(width, height, image)` and `gaussianBlur({ sigma }, image)` serve demonstrated Ada needs; `oklabToSrgb({ gamut, rounding }, colour)` also serves Archie. Preserve Float32 intermediates, hidden RGB and explicit rounding/gamut policies. Keep nearest sampling and existing OKLCH gamut mapping unchanged. These are the only additions currently being implemented.
3. **Evaluate a small bitmap-font reader and compositor next.** Chibi duplicates BMFont XML parsing, kerning, measurement and tinted glyph composition in `previewText.ts` and `fonts.ts`. First specify the supported BMFont dialect, page/image inputs, signed bearings, advances, line height, kerning, ink bounds, tint and alpha composition. A reader independent of runtime manifests would also support build-only fonts. This is the strongest new capability candidate, but no second consumer requirement or implementation approval is established.
4. **Consider horizontal alpha runs as a separate small primitive.** Chibi's `contactSilhouettes.ts` extracts binary-alpha row runs. A shared function could return `{ y, x, width }[]`, with explicit alpha threshold and coordinates relative to the supplied image. Freeze the actual endpoint, row-order and origin contract before selecting the signature. These masks affect physics; contacts, grouping and world placement remain local. Its small size makes retaining a local helper reasonable until reuse is demonstrated.
5. **Defer CLI and utility consolidation.** Chibi's deferred build/preview dispatch may belong with the existing build CLI if another caller has the same needs. Preserve deferred imports, help and exit codes. Floor modulo, stable JSON and rounding do not justify a utility subpath without distinct shared consumers. No generic backend, preview or 3D framework is needed.

## Example caller shapes

Existing interfaces and the approved additions:

```ts
const rgb = colour.rgb("8c9fb5");
const region = raster.crop({ x, y, width, height }, image);
const opaque = raster.opaque(region);
const resized = raster.resizeLanczos3(96, 64, image);
const blurred = raster.gaussianBlur({ sigma: 1.25 }, image);
const picker = colour.oklabToSrgb({ gamut: "reject", rounding: "half-up" }, lab);
```

Potential font interface for a separate design review, not an implemented contract:

```ts
const font = fonts.readBitmapFont(xml, pages);
const metrics = fonts.measureBitmapText({ font, spacing: 0 }, text);
fonts.drawBitmapText({ font, at, colour: tint, spacing: 0 }, text, target);
```

Keep parsing/building pure and I/O explicit. Archie already uses `buildBitmapFontFromGlyphs`; that supported path needs no replacement. File exporters must preserve the caller's encoder settings rather than force different PNG bytes. Font/sample selection, colours, spacing policy and output names remain game-owned.

## Migration and parity requirements

| Mechanism                            | Required comparison                                                       | Caller-owned difference                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Filled images, crops and RGB parsing | Valid-domain RGBA and dimensions, including RGB under alpha zero          | Ada's fractional truncation, byte wrapping and permissive hex remain named local adapters                      |
| Grayscale                            | Exact luma plane and shape                                                | A four-line opaque-RGBA adapter alone does not justify another public operation                                |
| Paste and contact sheets             | Partial-alpha rejection where required, frame order, cell bounds and feet | Archie's masked paste validates binary alpha; row-first-frame and largest-frame policies both have active uses |
| Lanczos and Gaussian                 | Every RGBA byte, Float32 operation order, edge handling, nonmutation      | Ada keeps expanded-ROI raw replacement; positive-sigma calls must be established before migration              |
| Inverse Oklab                        | Exact byte ties, clipping/rejection and quantized-header/body sequence    | Archie keeps LCh conversion and picker values; Ada selects clip/half-even                                      |
| Bitmap fonts                         | Signed bearings, kerning, advances, pitch, ink bounds and tinted RGBA     | Consumers retain font assets, samples and licences                                                             |
| Alpha runs                           | Threshold, endpoints, row ordering and frame origin                       | Chibi retains physics/contact interpretation                                                                   |

Encoded PNG equality is separate from decoded pixel equality and requires matching encoder settings and dependency pins. SVG and metadata text are separate comparisons. Art owners review affected actual outputs; Tech owners schedule approved consumer changes against published canonical artifacts. Consultation does not establish migration parity or adoption.

## Removal and ownership boundary

No Art owner supplied evidence supporting removal of a currently used shared API. Do not infer retirement consent from duplicate local helpers. Keep palettes, ramps, materials, scene geometry, topology, camera/headings, BSP tolerances, manifests and asset admission in the games. Any later removal requires an actual caller inventory and an explicit decision.

Source references: Ada Art basic-helper migration `9e977` and reviewed numerical baseline `e0673c7eb3c0dddf64eeca081fd9d982bd333a91`; Archie Art consultation `c7141cd819` against main `54c911ea80627f95c9c568f68ec25f5c227334a4`; Chibi Art consultation `b0cd76` using art-kit 0.22.0. Short references identify owner-supplied receipts, not independently resolved full commit pins. No new consumer checks or asset generation were run for this consultation.
