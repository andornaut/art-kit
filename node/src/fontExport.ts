import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { buildBitmapFont, type BitmapFontOptions } from "./fonts.js";

export interface BitmapFontExportOptions {
  font: Omit<BitmapFontOptions, "key">;
  output: { png: string; fnt: string };
}

/** Build and encode before writing. The two output files are not an atomic pair. */
export async function exportBitmapFont({ font, output }: BitmapFontExportOptions) {
  const png = resolve(output.png);
  const fnt = resolve(output.fnt);
  if (png === fnt) throw new RangeError("PNG and FNT paths must be distinct");
  if (extname(png) !== ".png") throw new RangeError("PNG output must end in .png");
  const source = await realpath(font.path);
  for (const path of [png, fnt]) {
    const existing = await realpath(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return path;
    });
    if (existing === source) throw new RangeError("Output must not overwrite the font source");
  }
  const key = relative(dirname(fnt), png).split(sep).join("/").slice(0, -4);
  const built = buildBitmapFont({ ...font, key });
  const bytes = await built.image.toBuffer("png");
  await mkdir(dirname(png), { recursive: true });
  await mkdir(dirname(fnt), { recursive: true });
  await writeFile(png, bytes);
  await writeFile(fnt, built.xml, "utf8");
  return { ...built, paths: { png, fnt } };
}
