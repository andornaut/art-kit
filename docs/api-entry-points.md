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

Paths below are relative to `@andornaut/art-kit`. Version 0.28 removes all 18 flat
compatibility paths. Replace each removed import with its canonical build path before
adopting v0.28. JavaScript modules and TypeScript declarations are unchanged; the basename
is preserved, including `build/build`.

| Removed in v0.28 | Canonical path        | Implementation dependencies |
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

The ten portable import graphs in the migration map have no Node or external codec value imports. In
particular, `atlasBuild` takes read/decode/encode callbacks; `bitmapFont` imports
`raster` and `colour` at runtime, with glyph-atlas definitions imported only as types.
This is a static portability distinction, not a browser qualification claim.

The other eight modules require Node directly or transitively. `fonts` statically loads
optional Skia; `woff2` loads its optional codec only on encoding. `spriteSheet` includes
filesystem writing and reaches Node zlib through its PNG CRC helper. Separating its writer
alone would not make its encoder portable. The PNG, WebP and WOFF2 APIs retain their current
Node codec contracts. Namespace paths do not change package-wide engine or peer requirements.

## Compatibility and publication

Version 0.28 is an incompatible minor release: every removed flat import rejects with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. It adds no root, wildcard, runtime or test entry points.
The 19 canonical build paths, implementations, peer dependencies and output contracts remain
unchanged. `build/build` names the build orchestrator; `build/compareRgba` has no removed alias.

Immutable v0.27 release artifacts and pins remain unchanged and usable, including their flat
compatibility paths. Consumers can migrate imports while staying on v0.27, then adopt a
verified v0.28 immutable pin without another import change.

Keep the published v0.27 compatibility aliases until every known consumer owner confirms
canonical imports on a verified immutable pin and supplies an actual publication/integration
receipt, including normal gates, push, CI and deployment where applicable. Source counts,
branch READY and checked local main alone are insufficient.

The v0.28 removal stays isolated preparation until all those owner receipts are collected.
Only then integrate and publish the coordinated incompatible release with migration notes;
consumer owners retain responsibility for their own adoption and checks.

Fixtures, source fonts, test decoders, semantics assertions and local build/test harnesses
remain unpublished. Private production helpers may ship in `dist` for internal imports;
they are not public entry points. Export maps enumerate supported leaf paths explicitly.
