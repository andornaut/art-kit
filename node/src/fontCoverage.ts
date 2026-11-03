import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** File coverage preflight only: Skia's internal fallback cannot be disabled. */
export function requireFontCoverage(
  path: string,
  characters: readonly string[],
): void {
  // Load the optional parser only for strict coverage, preserving system mode.
  const parser: unknown = require("fontkit");
  if (
    typeof parser !== "object" || parser === null ||
    !("openSync" in parser) || typeof parser.openSync !== "function"
  ) throw new TypeError("fontkit must expose openSync");
  const font: unknown = parser.openSync(path);
  if (typeof font !== "object" || font === null)
    throw new TypeError("fontkit returned no font");
  // Collections cannot be bound to the same Skia face through this API.
  if ("fonts" in font)
    throw new RangeError(
      "Strict coverage does not support font collections; supply a single-face font file",
    );
  if (
    !("hasGlyphForCodePoint" in font) ||
    typeof font.hasGlyphForCodePoint !== "function"
  ) throw new TypeError("fontkit font must expose hasGlyphForCodePoint");
  const hasGlyph = font.hasGlyphForCodePoint.bind(font);
  const missing = characters.filter(char => {
    const present: unknown = hasGlyph(char.codePointAt(0)!);
    if (typeof present !== "boolean")
      throw new TypeError("fontkit coverage result must be boolean");
    return !present;
  });
  if (missing.length) {
    const labels = missing.map(char => {
      const code = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      return `${JSON.stringify(char)} (U+${code})`;
    });
    throw new RangeError(`Font file is missing characters: ${labels.join(", ")}`);
  }
}
