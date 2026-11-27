# Installation and releases

## Try a released build

Use Node 24.22.2 or newer. Choose a version from [GitHub Releases](https://github.com/andornaut/art-kit/releases)
and download its tarball, `SOURCE_COMMIT` and `SHA256SUMS` into a scratch directory. Run the following
there, replacing the example version with the one you downloaded.

```sh
version=0.34.0
sha256sum -c SHA256SUMS &&
  npm install "./art-kit-$version.tgz" pngjs@7.0.0 @jsquash/webp@1.5.0 &&
  node --input-type=module -e 'import { Grid } from "@andornaut/art-kit/build/grid"; console.log(typeof Grid)'
```

The smoke check prints `function`. In a consumer project, [pin the public release URL](#released-dependency)
and commit its lockfile. Install the [optional peers](../reference/package.md#runtime-and-peers) only for the APIs you use.

## Released dependency

### Upgrading to 0.34

- Validation errors read `<subject> must <constraint>` across every subpath. Error types, check
  order and `buildCommand` exit statuses are unchanged; update any test or caller that matches
  message text.
- `build/glyphAtlas` exports `GlyphAtlas`, the return type of `buildBitmapFontFromGlyphs`, and
  `build/rgbaImage` exports the `Point` and `Rect` types used in public options.
- Sprite sheets render through the shared raster frame code with identical PNG, RGBA and JSON
  output. Import paths are unchanged after the internal source reorganization.

Use the [release asset URL and checksum](../reference/package.md#release-asset) to pin the version
and its exact peers in the consumer project.

Tag `v<version>` only after every required CI workflow has passed on the exact release commit on `main`. Use that commit's CI-built tarball, `SHA256SUMS` and `SOURCE_COMMIT` to run the [checksum and fresh-install commands](#try-a-released-build) before publishing the three files as release assets.
