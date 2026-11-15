# API entry points

Use explicit `@andornaut/art-kit/build/<name>` imports for development tools,
asset generation and diagnostics. For example:

```ts
import { decodePng } from "@andornaut/art-kit/build/png";
import { compareRgba } from "@andornaut/art-kit/build/compareRgba";
```

Names describe supported use, rather than incidental portability. Pure helpers remain
build APIs when their supported callers are development tools. There are no runtime or
test entry points, empty category APIs or mixed root barrel. A future runtime or reusable
test contract requires explicit ownership and scope. Runtime modules must not transitively
import Node, build or test modules; build may reuse runtime, and test may use either.

## Migration map

Paths below are relative to `@andornaut/art-kit`. Every legacy flat path is a deprecated
compatibility alias of its canonical build path, with the same JavaScript module and
TypeScript declarations. The basename is preserved, including `build/build`.

| Deprecated alias | Canonical path        | Implementation dependencies |
| ---------------- | --------------------- | --------------------------- |
| `./atlasLayout`  | `./build/atlasLayout` | Portable import graph       |
| `./atlasBuild`   | `./build/atlasBuild`  | Portable import graph       |
| `./rgbaImage`    | `./build/rgbaImage`   | Portable import graph       |
| `./indexedPng`   | `./build/indexedPng`  | Node dependencies           |
| `./png`          | `./build/png`         | Node dependencies           |
| `./webp`         | `./build/webp`        | Node dependencies           |
| `./woff2`        | `./build/woff2`       | Node dependencies           |
| `./gif`          | `./build/gif`         | Portable import graph       |
| `./ico`          | `./build/ico`         | Node dependencies           |
| `./spriteSheet`  | `./build/spriteSheet` | Node dependencies           |
| `./draw`         | `./build/draw`        | Portable import graph       |
| `./colour`       | `./build/colour`      | Portable import graph       |
| `./fonts`        | `./build/fonts`       | Node dependencies           |
| `./bitmapFont`   | `./build/bitmapFont`  | Portable import graph       |
| `./grid`         | `./build/grid`        | Portable import graph       |
| `./raster`       | `./build/raster`      | Portable import graph       |
| `./glyphAtlas`   | `./build/glyphAtlas`  | Portable import graph       |
| `./build`        | `./build/build`       | Node dependencies           |

`./build/compareRgba` is already canonical and has no flat alias. It is a portable
development diagnostic, not a test-only or game runtime API.

The ten portable import graphs have no Node or external codec value imports. In
particular, `atlasBuild` takes read/decode/encode callbacks; `bitmapFont` imports
`raster` and `colour` at runtime, with glyph-atlas definitions imported only as types.
This is a static portability distinction, not a browser qualification claim.

The other eight modules require Node directly or transitively. `fonts` statically loads
optional Skia; `woff2` loads its optional codec only on encoding. `spriteSheet` includes
filesystem writing and reaches Node zlib through its PNG CRC helper. Separating its writer
alone would not make its encoder portable. The PNG, WebP and WOFF2 APIs retain their current
Node codec contracts. Namespace paths do not change package-wide engine or peer requirements.

## Compatibility and publication

Existing immutable package pins and flat imports continue to work. Consumer owners choose
when to adopt a new pin and canonical imports. New callers and maintained examples use the
canonical paths. Compatibility aliases remain until adoption is confirmed; there is no implicit deadline.

<!-- CLEANUP (added 2026-11-15): Legacy flat aliases may be removed once all known consumer owners confirm immutable-pin/import adoption, with coordinated incompatible versioning and migration notes; there is no implicit deadline. -->

Adding these paths is compatible. Removing flat aliases later is an incompatible API
change requiring a coordinated release and migration notes under the package version policy.

Fixtures, source fonts, test decoders, semantics assertions and local build/test harnesses
remain unpublished. Private production helpers may ship in `dist` for internal imports;
they are not public entry points. Export maps enumerate supported leaf paths explicitly.
