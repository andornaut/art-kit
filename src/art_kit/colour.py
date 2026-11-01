"""Hexadecimal colour conversion and WCAG contrast."""


def rgb(colour: str) -> tuple[int, int, int]:
    return tuple(int(colour[i : i + 2], 16) for i in (0, 2, 4))


def contrast(a: str, b: str) -> float:
    def luminance(colour):
        values = [v / 255 for v in rgb(colour)]
        values = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]

    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
