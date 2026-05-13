import os
import unittest

import numpy as np
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from spectrum_signal_app.analyzer import AnalysisResult, ParameterSuggestion, PlateauParams
from spectrum_signal_app.main_window import MainWindow


class MainWindowPlotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_export_plot_uses_analysis_result_processed_signal(self):
        window = MainWindow()
        window.analyzer.original_signal = np.array([0.0, 1.0, 0.0])
        window.analyzer.time_data = np.arange(3)
        window.analyzer.processed_signal = np.array([0.0, 0.5, 0.0])
        result = AnalysisResult(
            mode="plateau",
            x_data=window.analyzer.time_data,
            original_signal=window.analyzer.original_signal,
            processed_signal=window.analyzer.processed_signal,
            plateaus=np.array([], dtype=int),
            plateau_properties={},
            peaks=np.array([], dtype=int),
            peak_properties={},
            statistics={},
        )

        try:
            window.apply_analysis_result(result)
            window.render_export_plot()
        except AttributeError as exc:
            self.fail(f"plotting should read analysis result processed_signal: {exc}")

        _, labels = window.canvas.axes.get_legend_handles_labels()
        self.assertIn("Processed Signal", labels)

    def test_mode_combo_uses_item_data_not_display_text(self):
        window = MainWindow()
        window.mode_combo.setItemText(0, "Renamed display text")

        window.mode_combo.setCurrentIndex(1)
        window.mode_combo.setCurrentIndex(0)
        window.on_analysis_mode_changed()

        self.assertEqual("plateau", window.analyzer.analysis_mode)
        self.assertFalse(window.plateau_group.isHidden())

    def test_suggest_parameters_batches_updates_into_one_analysis_request(self):
        window = MainWindow()
        window.analyzer.original_signal = np.r_[np.zeros(50), np.full(30, 0.35), np.zeros(50)]
        calls = []
        window.schedule_analysis = lambda immediate=False: calls.append(immediate)
        window.analyzer.suggest_plateau_parameters = lambda *args, **kwargs: ParameterSuggestion(
            ok=True,
            message="ok",
            plateau=PlateauParams(threshold_low=0.2, threshold_high=0.4, min_length=5, max_length=50),
        )

        window.suggest_parameters()

        self.assertEqual([True], calls)

    def test_large_data_disables_auto_refresh_until_manual_run(self):
        window = MainWindow()
        window.analyzer.original_signal = np.zeros(window.LARGE_DATA_THRESHOLD + 1)

        window.configure_auto_refresh_for_data_size()

        self.assertFalse(window.auto_refresh_checkbox.isChecked())
        self.assertTrue(window.run_analysis_btn.isEnabled())

    def test_pyqtgraph_preview_reads_analysis_result(self):
        window = MainWindow()
        result = AnalysisResult(
            mode="plateau",
            x_data=np.arange(3),
            original_signal=np.array([0.0, 1.0, 0.0]),
            processed_signal=np.array([0.0, 0.5, 0.0]),
            plateaus=np.array([], dtype=int),
            plateau_properties={},
            peaks=np.array([], dtype=int),
            peak_properties={},
            statistics={},
        )

        window.apply_analysis_result(result)

        self.assertGreaterEqual(len(window.preview_plot.listDataItems()), 2)


if __name__ == "__main__":
    unittest.main()
