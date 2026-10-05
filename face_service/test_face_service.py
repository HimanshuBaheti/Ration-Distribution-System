import unittest

from server import GRID_SIZE, HISTOGRAM_BINS, FaceInputError, compare_histograms


def template_with_bin(bin_index):
    values = [0.0] * (GRID_SIZE * GRID_SIZE * HISTOGRAM_BINS)
    for cell in range(GRID_SIZE * GRID_SIZE):
        values[cell * HISTOGRAM_BINS + bin_index] = 1.0
    return values


class FaceComparisonTests(unittest.TestCase):
    def test_identical_templates_have_zero_distance(self):
        template = template_with_bin(12)
        self.assertEqual(compare_histograms(template, template), 0.0)

    def test_different_templates_have_bounded_distance(self):
        distance = compare_histograms(template_with_bin(12), template_with_bin(13))
        self.assertGreater(distance, 0.0)
        self.assertLessEqual(distance, 1.0)

    def test_invalid_template_shape_is_rejected(self):
        with self.assertRaises(FaceInputError):
            compare_histograms([], template_with_bin(12))

    def test_non_finite_template_is_rejected(self):
        template = template_with_bin(12)
        template[0] = float("nan")
        with self.assertRaises(FaceInputError):
            compare_histograms(template, template_with_bin(12))


if __name__ == "__main__":
    unittest.main()
