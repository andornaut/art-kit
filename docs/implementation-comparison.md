# Python and TypeScript implementations

Both implementations remain supported side by side. Python is the recommended default for existing production art generators. Existing Node atlas and codec consumers remain appropriate Node clients.

| Area | Python source lines | TypeScript source lines |
| --- | ---: | ---: |
| Colour, including colour-space conversions | 109 | 123 |
| Grid | 113 | 185 |
| Frames and composition | 71 | 182 |
| Fonts | 109 | 166 |
| Aseprite | 105 | 109 |
| Total | 507 | 765 |

Physical source lines include types, whitespace, comments and a 31-line third-party notice in TypeScript frames. Tests, existing Node atlas/codecs and tooling are excluded. Formatting differs; these figures describe source volume, not a precise complexity metric. The additional TypeScript implementation work includes image indexing, compositing, canvas bounds/readback and font registration.

## Behaviour and dependencies

- Grid and Aseprite are close algorithmic ports. Aseprite uses asynchronous Node processes with explicit paths and arguments; its tests exercise a fake executable rather than regenerate consumer assets.
- Frames return structural RGBA buffers. Python contact sheets are RGB images; Node sheets have opaque alpha. Tile composition retains explicit Pillow-derived integer arithmetic to avoid Canvas premultiplication loss. This is additional maintained code and carries the notice in LICENSE.
- Fonts use optional canvas 3.2.3 with Cairo/Pango. The comparison fixture covers eleven glyphs in Liberation Sans Regular/Bold at size 16, in both rendering modes. Advances and ascent/descent match that fixture; grayscale ink coverage differs for every tested ink glyph, and bold period bounds differ. Binary coverage and some widths differ as well. This does not establish parity for other fonts or sizes.
- Font registration uses an explicit file identity, but Pango may select system fallback for missing characters. The public Canvas API does not enforce file-only coverage. Adoption therefore requires explicit review of authored font outputs and coverage policy.
- Both implementations retain ordered packing, signed metadata and caller-provided kerning. Node XML preserves attribute whitespace; font batches prepare their context once. These are separate implementations, not shared engines.
- Existing codec-only imports work without canvas. Node font clients need the native optional peer. Licensed test fonts are excluded from both release payloads.

## Validation and recommendation

The assembled isolated gate passes 19 Python tests and 34 Node tests, with no skipped Node tests, plus lint, declarations, installed-package imports and package builds. Required native font tests run with licensed fixtures. Large-frame extent regression, XML whitespace and batch context reuse cover the independent review findings. These gates validate mechanisms, not every consumer asset or every cross-runtime pixel.

Prefer Python/Pillow for existing art generation: it has less adapter/image code, preserves existing font output and already provides the required facilities. Prefer the existing Node atlas/codecs for build integration. The side-by-side TypeScript generator APIs remain available for an explicitly approved Node-native generator whose integration benefit justifies the extra code and different rendering. No Python retirement or consumer migration follows from this comparison.
