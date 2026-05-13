import csv
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np

from spectrum_signal_app.analyzer import (
    AnalysisRequest,
    PlateauParams,
    PreprocessParams,
    SpectrumAnalyzer,
)


class SpectrumAnalyzerTests(unittest.TestCase):
    def test_plateau_statistics_counts_plateau_centered_at_zero(self):
        analyzer = SpectrumAnalyzer()
        analyzer.processed_signal = np.array([1.0, 0.0, 0.0])

        analyzer.detect_plateaus(0.5, 1.5, min_length=1, max_length=1)

        stats = analyzer.calculate_plateau_statistics()
        self.assertEqual(1, stats["plateau_count"])
        self.assertAlmostEqual(1.0, stats["mean_height"])

    def test_load_data_drops_rows_with_non_numeric_signal_values(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "sample.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["time", "signal"])
                writer.writerow([0, "1.0"])
                writer.writerow([1, "bad"])
                writer.writerow([2, "3.0"])

            analyzer = SpectrumAnalyzer()
            success, message = analyzer.load_data(str(path), "signal", "time")

        self.assertTrue(success, message)
        np.testing.assert_array_equal(np.array([1.0, 3.0]), analyzer.original_signal)
        np.testing.assert_array_equal(np.array([0.0, 2.0]), analyzer.time_data)
        self.assertTrue(analyzer.has_real_time)

    def test_parameter_normalization_keeps_filters_and_ranges_valid(self):
        preprocess = SpectrumAnalyzer.normalize_preprocess_params(
            PreprocessParams(median_window=2, smooth_window=4, smooth_order=9)
        )
        plateau = SpectrumAnalyzer.normalize_plateau_params(
            PlateauParams(threshold_low=5.0, threshold_high=1.0, min_length=10, max_length=2)
        )

        self.assertGreaterEqual(preprocess.median_window, 3)
        self.assertEqual(1, preprocess.median_window % 2)
        self.assertGreaterEqual(preprocess.smooth_window, 3)
        self.assertEqual(1, preprocess.smooth_window % 2)
        self.assertLess(preprocess.smooth_order, preprocess.smooth_window)
        self.assertLessEqual(plateau.threshold_low, plateau.threshold_high)
        self.assertLessEqual(plateau.min_length, plateau.max_length)

    def test_suggest_plateau_parameters_returns_valid_range(self):
        signal = np.r_[
            np.zeros(50),
            np.full(30, 0.35),
            np.zeros(50),
            np.full(25, 0.38),
            np.zeros(50),
        ]
        analyzer = SpectrumAnalyzer()

        suggestion = analyzer.suggest_plateau_parameters(signal)

        self.assertTrue(suggestion.ok, suggestion.message)
        self.assertLessEqual(suggestion.plateau.threshold_low, suggestion.plateau.threshold_high)
        self.assertLessEqual(suggestion.plateau.min_length, suggestion.plateau.max_length)

    def test_analyze_reuses_preprocess_when_only_detection_params_change(self):
        signal = np.r_[np.zeros(20), np.full(10, 0.5), np.zeros(20)]
        analyzer = SpectrumAnalyzer()
        analyzer.original_signal = signal

        request = AnalysisRequest(
            mode="plateau",
            preprocess=PreprocessParams(filter_mode="clip_smooth", smooth_window=5),
            plateau=PlateauParams(threshold_low=0.2, threshold_high=0.7, min_length=3, max_length=20),
        )
        first = analyzer.analyze(request)
        second = analyzer.analyze(replace(request, plateau=replace(request.plateau, threshold_low=0.3)))

        self.assertIs(first.processed_signal, second.processed_signal)
        self.assertTrue(second.used_cached_preprocess)


if __name__ == "__main__":
    unittest.main()
