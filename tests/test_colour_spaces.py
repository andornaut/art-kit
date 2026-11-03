# Ruff PT rules target pytest; these contracts run under stdlib unittest.
# ruff: noqa: PT009, PT027
"""Perceptual conversion and gamut-mapping contracts."""

import math
import unittest

from art_kit.colour import (
    oklab_to_srgb,
    oklch_to_srgb,
    srgb_to_oklab,
    srgb_to_oklch,
)


class ColourSpacesTest(unittest.TestCase):
    def test_reference_vectors_and_roundtrips(self):
        for rgb, expected in [
            ((0, 0, 0), (0, 0, 0)),
            ((255, 255, 255), (1, 0, 0)),
            ((255, 0, 0), (0.62795536, 0.22486306, 0.12584630)),
        ]:
            for actual, reference in zip(srgb_to_oklab(rgb), expected, strict=True):
                self.assertAlmostEqual(actual, reference, places=6)
        for rgb in [(0, 0, 0), (255, 255, 255), (255, 0, 0), (12, 90, 184), (128, 128, 128)]:
            self.assertEqual(oklab_to_srgb(srgb_to_oklab(rgb)), rgb)
            self.assertEqual(oklch_to_srgb(srgb_to_oklch(rgb)), rgb)
        self.assertEqual(srgb_to_oklch((128, 128, 128))[1:], (0, 0))

    def test_gamut_mapping_preserves_lightness_and_hue(self):
        lightness, chroma, h = srgb_to_oklch(oklch_to_srgb((0.6, 0.9, 40)))
        self.assertAlmostEqual(lightness, 0.6, delta=0.003)
        self.assertLess(chroma, 0.9)
        self.assertGreater(chroma, 0.1)
        self.assertAlmostEqual(h, 40, delta=1)
        self.assertEqual(oklch_to_srgb((0.6, 0.9, -320)), oklch_to_srgb((0.6, 0.9, 40)))
        self.assertEqual(oklch_to_srgb((-1, 1, 40)), (0, 0, 0))
        self.assertEqual(oklch_to_srgb((2, 1, 40)), (255, 255, 255))
        self.assertEqual(oklch_to_srgb((0.6, -1, 40)), oklch_to_srgb((0.6, 0, 0)))
        self.assertEqual(oklab_to_srgb((1, 0, 0)), (255, 255, 255))

    def test_invalid_inputs(self):
        for fn in (srgb_to_oklab, srgb_to_oklch, oklab_to_srgb, oklch_to_srgb):
            for value in [(math.nan, 0, 0), (0, math.inf, 0), (0, 0), (True, 0, 0)]:
                with self.assertRaises(ValueError):
                    fn(value)
        for value in [(-1, 0, 0), (256, 0, 0), (0.5, 0, 0)]:
            with self.assertRaises(ValueError):
                srgb_to_oklab(value)
