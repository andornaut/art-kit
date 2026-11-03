/** Hexadecimal RGB and WCAG contrast, retaining the Python transfer threshold. */
export function rgb(colour: string): [number, number, number] {
  return [0, 2, 4].map((i) => {
    const part = colour.slice(i, i + 2);
    if (!/^[0-9a-f]{1,2}$/i.test(part)) throw new RangeError("Invalid hexadecimal colour");
    return Number.parseInt(part, 16);
  }) as [number, number, number];
}

export function contrast(a: string, b: string): number {
  const luminance = (colour: string): number => {
    const v = rgb(colour).map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
