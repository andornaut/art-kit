import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { buildBitmapFont, type BitmapFontOptions } from "./fonts.js";
import { buildBitmapFontFromGlyphs, type GlyphAtlasOptions, type SuppliedGlyph as SuppliedBitmapGlyph } from "./glyphAtlas.js";
import { encodeRgbaPng } from "./png.js";

export interface BitmapFontExportOptions {
  font: Omit<BitmapFontOptions, "key">;
  output: { png: string; fnt: string };
}

export interface BitmapFontFromGlyphsExportOptions {
  font: Omit<GlyphAtlasOptions, "key">;
  glyphs: ReadonlyMap<string, SuppliedBitmapGlyph>;
  output: { png: string; fnt: string };
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), basename(path));
  }
}

async function outputPaths(output: { png: string; fnt: string }, sourcePath?: string) {
  const png = resolve(output.png);
  const fnt = resolve(output.fnt);
  if (png === fnt) throw new RangeError("PNG and FNT paths must be distinct");
  if (extname(png) !== ".png") throw new RangeError("PNG output must end in .png");
  const source = sourcePath === undefined ? undefined : await stat(sourcePath);
  const identities = [];
  const targets: string[] = [];
  for (const path of [png, fnt]) {
    targets.push(await canonical(path));
    const existing = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!existing && (await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    }))?.isSymbolicLink()) throw new RangeError("Output must not be a dangling symbolic link");
    identities.push(existing);
    if (source && existing && existing.dev === source.dev && existing.ino === source.ino)
      throw new RangeError("Output must not overwrite the font source");
  }
  const [a, b] = identities;
  if (targets[0] === targets[1] || (a && b && a.dev === b.dev && a.ino === b.ino))
    throw new RangeError("PNG and FNT paths must be distinct");
  const key = relative(dirname(fnt), png).split(sep).join("/").slice(0, -4);
  return { png, fnt, key };
}

async function writeOutputs(paths: { png: string; fnt: string }, bytes: Uint8Array, xml: string) {
  const { png, fnt } = paths;
  await mkdir(dirname(png), { recursive: true });
  await mkdir(dirname(fnt), { recursive: true });
  await writeFile(png, bytes);
  await writeFile(fnt, xml, "utf8");
}

/** Build and encode before writing. The two output files are not an atomic pair. */
export async function exportBitmapFont({ font, output }: BitmapFontExportOptions) {
  const { png, fnt, key } = await outputPaths(output, font.path);
  const built = buildBitmapFont({ ...font, key });
  const bytes = await built.image.toBuffer("png");
  await writeOutputs({ png, fnt }, bytes, built.xml);
  return { ...built, paths: { png, fnt } };
}

/** Export supplied straight-alpha pixels without a renderer round trip. */
export async function exportBitmapFontFromGlyphs({ font, glyphs, output }: BitmapFontFromGlyphsExportOptions) {
  const { png, fnt, key } = await outputPaths(output);
  const built = buildBitmapFontFromGlyphs({ ...font, key }, glyphs);
  const bytes = encodeRgbaPng({ deflateLevel: 9, deflateStrategy: 3, filterType: -1 }, built.image);
  await writeOutputs({ png, fnt }, bytes, built.xml);
  return { ...built, paths: { png, fnt } };
}
