# Package reference

## Runtime and peers

Node 24.22.2 or newer with the exact peers `pngjs@7.0.0` and `@jsquash/webp@1.5.0`, plus the optional `skia-canvas@4.0.0` for `fonts`, `wawoff2@2.0.1` for `woff2` and `harfbuzzjs@1.6.4` for `subsetWoff2`. Source fonts and their licences stay in the client repositories.

## Version and licence

The package version is the `version` in [node/package.json](../../node/package.json). Compatible fixes increment the patch version and additive features the minor version. An incompatible public API change needs a coordinated bump and release notes before consumers migrate: the minor version before 1.0.0, the major version after. The exact Git revision identifies each payload. Helper code here is MIT licensed; test fonts keep their SIL OFL licence and are excluded from release artifacts. Generated assets, fonts and client code keep their own licences.

## Release asset

The release asset is `https://github.com/andornaut/art-kit/releases/download/v<version>/art-kit-<version>.tgz`. Consumers pin that URL with the tarball's SHA-256 from `SHA256SUMS`, plus the exact peers, through their own dependency integration. The tarball holds compiled ESM, `.d.ts` files, the published `package.json`, `LICENSE` and `SOURCE_COMMIT`; no source, fonts, game assets or tooling.
