// Hexadecimal RGB and WCAG 2.0 contrast with its 0.03928 transfer threshold.
/** The bytes of a six-digit hexadecimal colour without "#"; any other string throws RangeError. */
export function rgb(colour: string): [
    number,
    number,
    number
] {
    if (!/^[0-9a-f]{6}$/i.test(colour))
        throw new RangeError(`Invalid hexadecimal colour ${JSON.stringify(colour)}`);
    return [0, 2, 4].map((i) => Number.parseInt(colour.slice(i, i + 2), 16)) as [
        number,
        number,
        number
    ];
}
export function contrast(a: string, b: string): number {
    const luminance = (colour: string): number => {
        const v = rgb(colour).map((channel) => {
            const value = channel / 255;
            return value <= 0.03928
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Public-domain matrices: https://bottosson.github.io/posts/oklab/
// sRGB transfer: https://www.w3.org/TR/css-color-4/#color-conversion-code
type Triple = readonly [
    number,
    number,
    number
];
function triple(values: Triple): Triple {
    if (values.length !== 3 || !values.every(v => typeof v === 'number' && Number.isFinite(v)))
        throw new RangeError('Expected three finite numbers');
    return values;
}
function linearLab([L, a, b]: Triple): [
    number,
    number,
    number
] {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
function bytes(values: Triple): [
    number,
    number,
    number
] {
    return values.map(v => { v = Math.max(0, Math.min(1, v)); return Math.floor(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) + 0.5); }) as [
        number,
        number,
        number
    ];
}
/** Convert sRGB bytes to D65 Oklab (L, a, b). */
export function srgbToOklab(colour: Triple): [
    number,
    number,
    number
] {
    triple(colour);
    if (!colour.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
        throw new RangeError('Expected RGB bytes in 0..255');
    const [r, g, b] = colour.map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
/** Convert bytes to (L, C, hue degrees); neutral hue is zero. */
export function srgbToOklch(colour: Triple): [
    number,
    number,
    number
] {
    const [L, a, b] = srgbToOklab(colour);
    return colour[0] === colour[1] && colour[1] === colour[2] ? [L, 0, 0] : [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}
/** Clamp L/C and wrap hue; map gamut by reducing C at fixed L/h in 24 steps.
 * Quantize bytes nearest, ties upward, after mapping.
 */
export function oklchToSrgb(colour: Triple): [
    number,
    number,
    number
] {
    let [L, C, h] = triple(colour);
    L = Math.max(0, Math.min(1, L));
    C = Math.max(0, Math.min(1, C));
    h = ((h % 360 + 360) % 360) * Math.PI / 180;
    if (L === 0 || L === 1)
        return L === 0 ? [0, 0, 0] : [255, 255, 255];
    const linear = (chroma: number) => linearLab([L, chroma * Math.cos(h), chroma * Math.sin(h)]);
    const inGamut = (v: Triple) => v.every(c => Number.isFinite(c) && c >= 0 && c <= 1);
    let values = linear(C);
    if (!inGamut(values)) {
        let low = 0, high = Math.min(C, 1);
        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2;
            if (inGamut(linear(mid)))
                low = mid;
            else
                high = mid;
        }
        values = linear(low);
    }
    return bytes(values);
}
