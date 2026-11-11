# Container tooling

- `check-stock ACTION` runs `check`, `lint`, `test` or `build` for Make and CI.
- `stock` is the shared container library, copied verbatim; do not edit it here.
- `images` pins the stock Node and ShellCheck images.
- `load` waits until the one-minute load is below 20 before each container start.
- `node ACTION` installs the dependencies and runs the native checks in one container.
- `markdown` installs this directory's locked Markdown tools and lints.

WORKAROUND: Scoped npm overrides keep Markdown lint dependencies patched for
[re2js](https://github.com/advisories/GHSA-gg6h-894w-4m9c) and
[KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7).
Remove the overrides when the upstream CLI dependency graph resolves patched
versions without them.
