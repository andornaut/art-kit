import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { buildBitmapFont, type BitmapFontOptions } from "./fonts.js";

export interface BitmapFontExportOptions {
  font: Omit<BitmapFontOptions, "key">;
  output: { png: string; fnt: string };
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonical(dirname(path)), basename(path));
  }
}

/** Build and encode before writing. The two output files are not an atomic pair. */
export async function exportBitmapFont({ font, output }: BitmapFontExportOptions) {
  const png = resolve(output.png);
  const fnt = resolve(output.fnt);
  if (png === fnt) throw new RangeError("PNG and FNT paths must be distinct");
  if (extname(png) !== ".png") throw new RangeError("PNG output must end in .png");
  const source = await stat(font.path);
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
    if (existing && existing.dev === source.dev && existing.ino === source.ino)
      throw new RangeError("Output must not overwrite the font source");
  }
  const [a, b] = identities;
  if (targets[0] === targets[1] || (a && b && a.dev === b.dev && a.ino === b.ino))
    throw new RangeError("PNG and FNT paths must be distinct");
  const key = relative(dirname(fnt), png).split(sep).join("/").slice(0, -4);
  const built = buildBitmapFont({ ...font, key });
  const bytes = await built.image.toBuffer("png");
  await mkdir(dirname(png), { recursive: true });
  await mkdir(dirname(fnt), { recursive: true });
  await writeFile(png, bytes);
  await writeFile(fnt, built.xml, "utf8");
  return { ...built, paths: { png, fnt } };
}
