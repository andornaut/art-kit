"""Hexadecimal colour conversion and WCAG contrast."""

import math


def rgb(colour: str) -> tuple[int, int, int]:
    return tuple(int(colour[i : i + 2], 16) for i in (0, 2, 4))


def contrast(a: str, b: str) -> float:
    def luminance(colour):
        values = [v / 255 for v in rgb(colour)]
        values = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]

    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


# Public-domain Oklab matrices: https://bottosson.github.io/posts/oklab/
# sRGB transfer: https://www.w3.org/TR/css-color-4/#color-conversion-code


def _triple(values):
    if len(values) != 3 or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values
    ):
        raise ValueError("Expected three finite numbers")
    return values


def _linear_lab(values):
    lightness, a, b = values
    cone_l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * cone_l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * cone_l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * cone_l - 0.7034186147 * m + 1.7076147010 * s,
    )


def _bytes(values):
    def encode(v):
        v = max(0, min(1, v))
        v = 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        return math.floor(v * 255 + 0.5)

    return tuple(encode(v) for v in values)


def srgb_to_oklab(colour: tuple[int, int, int]) -> tuple[float, float, float]:
    """Convert sRGB bytes to D65 Oklab (lightness, a, b)."""
    values = _triple(colour)
    if any(v < 0 or v > 255 or int(v) != v for v in values):
        raise ValueError("Expected RGB bytes in 0..255")
    r, g, b = (v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in (c / 255 for c in values))
    cone_l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
        0.2104542553 * cone_l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * cone_l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * cone_l + 0.7827717662 * m - 0.8086757660 * s,
    )


def oklab_to_srgb(colour: tuple[float, float, float]) -> tuple[int, int, int]:
    """Convert Oklab to sRGB bytes, clamping each linear RGB channel."""
    return _bytes(_linear_lab(_triple(colour)))


def srgb_to_oklch(colour: tuple[int, int, int]) -> tuple[float, float, float]:
    """Convert sRGB bytes to (lightness, chroma, hue degrees); neutral hue is zero."""
    lightness, a, b = srgb_to_oklab(colour)
    if colour[0] == colour[1] == colour[2]:
        return lightness, 0.0, 0.0
    return lightness, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


def oklch_to_srgb(colour: tuple[float, float, float]) -> tuple[int, int, int]:
    """Clamp lightness/chroma, wrap hue; reduce out-of-gamut chroma at fixed lightness/h (24 steps).

    Byte quantization follows gamut mapping and uses nearest, ties upward.
    """
    lightness, chroma, h = _triple(colour)
    lightness, chroma, h = max(0, min(1, lightness)), max(0, min(1, chroma)), math.radians(h % 360)
    if lightness in {0, 1}:
        return (0, 0, 0) if lightness == 0 else (255, 255, 255)

    def linear(chroma):
        return _linear_lab((lightness, chroma * math.cos(h), chroma * math.sin(h)))

    def in_gamut(values):
        return all(math.isfinite(v) and 0 <= v <= 1 for v in values)

    values = linear(chroma)
    if not in_gamut(values):
        # Any sRGB Oklab chroma is below one; bound the search for huge inputs.
        low, high = 0.0, min(chroma, 1.0)
        for _ in range(24):
            mid = (low + high) / 2
            if in_gamut(linear(mid)):
                low = mid
            else:
                high = mid
        values = linear(low)
    return _bytes(values)
