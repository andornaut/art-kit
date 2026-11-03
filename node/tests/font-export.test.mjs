import assert from "node:assert/strict";
import { copyFile, link, mkdir, mkdtemp, readFile, writeFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import { exportBitmapFont } from "@andornaut/art-kit/generate";

const fixtures = process.env.ART_KIT_TEST_FONTS;
assert.ok(fixtures, "Required native font fixtures");
const font = { path: join(fixtures, "LiberationSans-Regular.ttf"), size: 16,
  characters: " jAV", atlasWidth: 64 };

// Parse the quoted page attribute, including XML's character references.
function pageFile(xml) {
  const match = xml.match(/<page\s+id="0"\s+file="([^"]*)"\s*\/>/);
  assert.ok(match, "One page with a quoted file attribute");
  return match[1].replace(/&(#\d+|amp|quot|lt|gt);/g, (_, ref) =>
    ref.startsWith("#") ? String.fromCodePoint(Number(ref.slice(1))) :
      ({amp: "&", quot: '"', lt: "<", gt: ">"})[ref]);
}

test("export writes a native PNG and FNT with a resolvable relative page", async () => {
  const root = await mkdtemp(join(tmpdir(), "font-export-"));
  const output = { png: join(root, "images", 'body & atlas.png'),
    fnt: join(root, "metadata", "body.fnt") };
  const result = await exportBitmapFont({ font, output });
  const bytes = await readFile(output.png);
  assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  const image = PNG.sync.read(bytes);
  assert.equal(image.width, result.image.width);
  assert.equal(image.height, result.image.height);
  assert.ok(image.data.some((v, i) => i % 4 === 3 && v > 0));
  const xml = await readFile(output.fnt, "utf8");
  assert.equal(xml, result.xml);
  assert.equal(resolve(dirname(output.fnt), pageFile(xml)), output.png);
  assert.equal(result.metadata.glyphs.get("j").xoffset, -1);
  assert.deepEqual(result.paths, output);
});

test("invalid paths and invalid fonts leave outputs untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "font-export-invalid-"));
  const png = join(root, "new", "body.png");
  const fnt = join(root, "new", "body.fnt");
  for (const output of [{png, fnt: png}, {png: png + ".jpg", fnt}, {png: png + ".PNG", fnt},
    {png, fnt: font.path}]) {
    await assert.rejects(exportBitmapFont({font, output}), RangeError);
  }
  const alias = join(root, "source.png");
  await symlink(font.path, alias);
  await assert.rejects(exportBitmapFont({font, output: {png: alias, fnt}}), /font source/);
  await assert.rejects(exportBitmapFont({font: {...font, atlasWidth: 1}, output: {png, fnt}}), /atlas width/);
  assert.deepEqual(await readdir(root), ["source.png"]);
});

test("filesystem errors propagate and preserve pre-existing outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "font-export-error-"));
  const png = join(root, "body.png");
  const blocked = join(root, "blocked");
  await writeFile(png, "existing PNG");
  await writeFile(blocked, "existing file");
  await assert.rejects(exportBitmapFont({font, output: {png, fnt: join(blocked, "body.fnt")}}));
  assert.equal(await readFile(png, "utf8"), "existing PNG");
  assert.equal(await readFile(blocked, "utf8"), "existing file");
});


test("existing output symlink aliases are rejected before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "font-export-alias-"));
  const png = join(root, "body.png");
  const fnt = join(root, "body.fnt");
  await writeFile(png, "preserved");
  await symlink(png, fnt);
  await assert.rejects(exportBitmapFont({font, output: {png, fnt}}), /distinct/);
  assert.equal(await readFile(png, "utf8"), "preserved");
});


test("hard links and missing destinations under directory aliases are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "font-export-links-"));
  const source = join(root, "source.ttf");
  await copyFile(font.path, source);
  const png = join(root, "source.png");
  await link(source, png);
  await assert.rejects(exportBitmapFont({font: {...font, path: source},
    output: {png, fnt: join(root, "out.fnt")}}), /font source/);
  assert.deepEqual(await readFile(source), await readFile(font.path));
  const first = join(root, "first.png");
  const second = join(root, "second.fnt");
  await writeFile(first, "existing");
  await link(first, second);
  await assert.rejects(exportBitmapFont({font, output: {png: first, fnt: second}}), /distinct/);
  assert.equal(await readFile(first, "utf8"), "existing");
  const dir = join(root, "real");
  await mkdir(dir);
  const alias = join(root, "alias");
  await symlink(dir, alias);
  await assert.rejects(exportBitmapFont({font, output: {
    png: join(dir, "new", "body.png"), fnt: join(alias, "new", "body.png")}}), /distinct/);
  assert.deepEqual(await readdir(dir), []);
});


test("dangling output links are rejected before creating their targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "font-export-dangling-"));
  const png = join(root, "body.png");
  const fnt = join(root, "body.fnt");
  await symlink(png, fnt);
  await assert.rejects(exportBitmapFont({ font, output: { png, fnt } }), /dangling symbolic link/);
  await assert.rejects(readFile(png), { code: "ENOENT" });
});
