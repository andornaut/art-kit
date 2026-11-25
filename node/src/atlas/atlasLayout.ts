import type { Point } from "../raster/types.js";

export interface AtlasItem<T> {
  rectangles: readonly { width: number; height: number }[];
  value: T;
}

export interface AtlasPlacement<T> {
  at: readonly Point[];
  item: AtlasItem<T>;
}

export interface AtlasPage<T> {
  height: number;
  width: number;
  placed: readonly AtlasPlacement<T>[];
}

export interface AtlasCandidate<T> {
  pages: readonly AtlasPage<T>[];
  width: number;
}

export interface AtlasPolicy<T> {
  compare: (left: AtlasItem<T>, right: AtlasItem<T>) => number;
  extrude: number;
  maxSize: number;
  /** Transparent pixels between neighbouring cells on a shelf and between shelves; default 0. */
  padding?: number;
  widths: readonly number[];
}

function packShelves<T>(
  { extrude, maxSize, padding = 0 }: AtlasPolicy<T>,
  width: number,
  items: readonly AtlasItem<T>[],
): AtlasCandidate<T> | undefined {
  const pages: AtlasPage<T>[] = [];
  let placed: AtlasPlacement<T>[] = [];
  let [x, y, height, pageHeight] = [0, 0, 0, 0];
  const place = (item: AtlasItem<T>) => {
    let [nextX, nextY, nextHeight] = [x, y, height];
    const at: Point[] = [];
    for (const rectangle of item.rectangles) {
      const cellWidth = rectangle.width + 2 * extrude;
      const cellHeight = rectangle.height + 2 * extrude;
      if (nextX + (nextX ? padding : 0) + cellWidth > width) {
        nextY += nextHeight + padding;
        nextX = 0;
        nextHeight = 0;
      }
      const gap = nextX ? padding : 0;
      if (nextX + gap + cellWidth > width || nextY + cellHeight > maxSize) {
        return undefined;
      }
      at.push({ x: nextX + gap + extrude, y: nextY + extrude });
      nextX += gap + cellWidth;
      nextHeight = Math.max(nextHeight, cellHeight);
    }
    return { at, height: nextHeight, x: nextX, y: nextY };
  };
  for (const item of items) {
    let result = place(item);
    if (result === undefined && placed.length > 0) {
      pages.push({ height: pageHeight, placed, width });
      placed = [];
      [x, y, height, pageHeight] = [0, 0, 0, 0];
      result = place(item);
    }
    if (result === undefined) {
      return undefined;
    }
    ({ height, x, y } = result);
    placed.push({ at: result.at, item });
    pageHeight = Math.max(pageHeight, y + height);
  }
  if (placed.length > 0) {
    pages.push({ height: pageHeight, placed, width });
  }
  return { pages, width };
}

// Each item stays on one page; failed attempts leave the shelf unchanged. Padding separates
// neighbouring cells and shelves, never page edges.
export function packAtlas<T>(
  policy: AtlasPolicy<T>,
  items: readonly AtlasItem<T>[],
): AtlasCandidate<T> | undefined {
  const padding = policy.padding ?? 0;
  if (!Number.isSafeInteger(padding) || padding < 0) {
    throw new RangeError("Atlas padding must be a non-negative safe integer");
  }
  const sorted = [...items].sort(policy.compare);
  let best: AtlasCandidate<T> | undefined;
  const area = (candidate: AtlasCandidate<T>) =>
    candidate.pages.reduce((sum, page) => sum + page.width * page.height, 0);
  for (const width of policy.widths) {
    const candidate = packShelves(policy, width, sorted);
    if (
      candidate !== undefined &&
      (best === undefined ||
        candidate.pages.length < best.pages.length ||
        (candidate.pages.length === best.pages.length && area(candidate) < area(best)))
    ) {
      best = candidate;
    }
  }
  return best;
}
