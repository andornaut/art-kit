// Writes <case>.gif and <case>.ico from the fixture inputs for tests/gif_ico_reference.py crosscheck.
// Usage: node encode.mjs <compiled-dist-directory> <pillow.json> <output-directory>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const [dist, fixturePath, out] = process.argv.slice(2);
if (!out) throw new Error("Usage: encode.mjs <dist> <pillow.json> <output-directory>");
const { encodeGif } = await import(pathToFileURL(resolve(dist, "gif.js")).href);
const { encodeIco } = await import(pathToFileURL(resolve(dist, "ico.js")).href);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const image = ({ width, height, rgba }) => ({ width, height, data: new Uint8Array(inflateSync(Buffer.from(rgba, "base64"))) });
mkdirSync(out, { recursive: true });
for (const [name, { options, frames }] of Object.entries(fixture.gif)) {
  const { duration, ...rest } = options;
  writeFileSync(join(out, `${name}.gif`), encodeGif({ durations: duration, ...rest }, frames.map(image)));
}
for (const [name, { images }] of Object.entries(fixture.ico)) {
  writeFileSync(join(out, `${name}.ico`), encodeIco(images.map(image)));
}
