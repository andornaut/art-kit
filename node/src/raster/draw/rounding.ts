// roundf and lround: half away from zero.
export function roundAway(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}
