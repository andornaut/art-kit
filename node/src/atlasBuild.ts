import type { Point, Rect } from "./geometry.js";
import { blankImage, blitExtruded, type RgbaImage } from "./rgbaImage.js";

export interface AtlasBlit {
  source: string;
  from: Rect;
  at: Point;
  bounds?: Rect;
}

export interface AtlasBuildPage<M> {
  width: number;
  height: number;
  blits: readonly AtlasBlit[];
  metadata: M;
}

export interface AtlasBuildDependencies {
  read: (source: string) => Promise<Uint8Array>;
  decode: (bytes: Uint8Array) => RgbaImage | Promise<RgbaImage>;
  encode: (image: RgbaImage) => Uint8Array | Promise<Uint8Array>;
  decoded?: ReadonlyMap<string, RgbaImage>;
  extrude: number;
}

export function drawAtlasPage(
  extrude: number,
  images: ReadonlyMap<string, RgbaImage>,
  { blits, height, width }: AtlasBuildPage<unknown>,
): RgbaImage {
  const page = blankImage(width, height);
  for (const { at, bounds, from, source } of blits) {
    const image = images.get(source);
    if (image === undefined) {
      throw new Error(`No atlas source for ${source}`);
    }
    blitExtruded({ at, bounds, extrude, from }, image, page);
  }
  return page;
}

// At most this many reads, decodes or encodes are pending at once, so a build with many sources
// stays under a low open-file limit.
const CONCURRENCY = 16;

// fn over items with at most CONCURRENCY calls pending, results in item order. The first failure
// rejects and starts no further calls.
async function mapBounded<T, R>(
  fn: (item: T) => R | Promise<R>,
  items: readonly T[],
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await fn(items[index]);
    }
  };
  const stopOnFailure = (error: unknown) => {
    next = items.length;
    throw error;
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, () =>
      worker().catch(stopOnFailure),
    ),
  );
  return results;
}

// Each distinct source is read and decoded once and shared across pages; page and blit order
// remain caller supplied.
export async function buildAtlasPages<M>(
  dependencies: AtlasBuildDependencies,
  pages: readonly AtlasBuildPage<M>[],
): Promise<{ image: RgbaImage; bytes: Uint8Array; metadata: M }[]> {
  const { decode, decoded, encode, extrude, read } = dependencies;
  const sources = [...new Set(pages.flatMap(({ blits }) => blits.map(({ source }) => source)))];
  const loaded = await mapBounded(
    async (source) => decoded?.get(source) ?? decode(await read(source)),
    sources,
  );
  const images = new Map(sources.map((source, index) => [source, loaded[index]]));
  return mapBounded(async (page) => {
    const image = drawAtlasPage(extrude, images, page);
    return { bytes: await encode(image), image, metadata: page.metadata };
  }, pages);
}
