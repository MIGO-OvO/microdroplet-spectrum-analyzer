import os

import numpy as np
import pandas as pd
import pyqtgraph as pg
from matplotlib.backends.backend_qtagg import NavigationToolbar2QT as NavigationToolbar
from PySide6.QtCore import QAbstractTableModel, QModelIndex, QObject, QRunnable, QSignalBlocker, Qt, QThreadPool, QTimer, Signal, Slot
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDoubleSpinBox, QFileDialog, QGroupBox, QHBoxLayout,
                               QHeaderView, QLabel, QMainWindow, QMessageBox, QPushButton, QTableView,
                               QTabWidget, QTextEdit, QVBoxLayout, QWidget)

from .analyzer import AnalysisRequest, AnalysisResult, PeakParams, PlateauParams, PreprocessParams, SpectrumAnalyzer
from .canvas import MplCanvas
from .dialogs import ColumnSelectDialog


class AnalysisTableModel(QAbstractTableModel):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.headers = []
        self.rows = []

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.headers)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or role != Qt.DisplayRole:
            return None
        return self.rows[index.row()][index.column()]

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if role != Qt.DisplayRole:
            return None
        if orientation == Qt.Horizontal and 0 <= section < len(self.headers):
            return self.headers[section]
        if orientation == Qt.Vertical:
            return str(section + 1)
        return None

    def set_result(self, result):
        self.beginResetModel()
        if result is None:
            self.headers = []
            self.rows = []
        elif result.mode == "plateau":
            self.headers, self.rows = self._plateau_rows(result)
        else:
            self.headers, self.rows = self._peak_rows(result)
        self.endResetModel()

    @staticmethod
    def _plateau_rows(result):
        props = result.plateau_properties or {}
        plateaus = result.plateaus if result.plateaus is not None else np.array([], dtype=int)
        if len(plateaus) == 0:
            return ["平台 #", "中心位置", "起始点", "结束点", "高度(精炼)", "长度"], []

        centers_idx = np.asarray(props.get("plateau_centers", []), dtype=int)
        starts_idx = np.asarray(props.get("plateau_starts", []), dtype=int)
        ends_idx = np.asarray(props.get("plateau_ends", []), dtype=int)
        centers = result.x_data[centers_idx]
        starts = result.x_data[starts_idx]
        ends = result.x_data[ends_idx]
        heights = props.get("plateau_heights", [])
        lengths = props.get("plateau_lengths", [])
        rows = []
        for i in range(len(plateaus)):
            rows.append([
                str(i + 1),
                f"{centers[i]:.4f}",
                f"{starts[i]:.4f}",
                f"{ends[i]:.4f}",
                f"{heights[i]:.6f}",
                f"{lengths[i]}",
            ])
        return ["平台 #", "中心位置", "起始点", "结束点", "高度(精炼)", "长度"], rows

    @staticmethod
    def _peak_rows(result):
        peaks = result.peaks if result.peaks is not None else np.array([], dtype=int)
        if len(peaks) == 0:
            return ["峰 #", "位置", "高度", "峰突性"], []

        props = result.peak_properties or {}
        positions = result.x_data[peaks]
        heights = props.get("peak_heights", [])
        prominences = props.get("prominences", [])
        rows = []
        for i, pos in enumerate(positions):
            rows.append([
                str(i + 1),
                f"{pos:.4f}",
                f"{heights[i]:.4f}",
                f"{prominences[i]:.4f}",
            ])
        return ["峰 #", "位置", "高度", "峰突性"], rows


class AnalysisWorkerSignals(QObject):
    finished = Signal(int, object)
    failed = Signal(int, str)


class AnalysisWorker(QRunnable):
    def __init__(self, request_id, signal, time_data, has_real_time, request):
        super().__init__()
        self.request_id = request_id
        self.signal = signal
        self.time_data = time_data
        self.has_real_time = has_real_time
        self.request = request
        self.signals = AnalysisWorkerSignals()

    @Slot()
    def run(self):
        try:
            analyzer = SpectrumAnalyzer()
            analyzer.original_signal = self.signal
            analyzer.time_data = self.time_data
            analyzer.has_real_time = self.has_real_time
            result = analyzer.analyze(self.request)
            self.signals.finished.emit(self.request_id, result)
        except Exception as exc:
            self.signals.failed.emit(self.request_id, str(exc))


class MainWindow(QMainWindow):
    LARGE_DATA_THRESHOLD = 1_000_000
    ANALYSIS_DEBOUNCE_MS = 200
    MAX_PREVIEW_LABELS = 200

    def __init__(self):
        super().__init__()
        self.analyzer = SpectrumAnalyzer()
        self.thread_pool = QThreadPool.globalInstance()
        self.analysis_timer = QTimer(self)
        self.analysis_timer.setSingleShot(True)
        self.analysis_timer.timeout.connect(self.run_analysis)
        self._analysis_request_id = 0
        self._workers = {}
        self._export_plot_dirty = True
        self.init_ui()

    def init_ui(self):
        self.setWindowTitle("液滴微流控光谱分析系统")
        self.setGeometry(100, 100, 1600, 900)
        self.statusBar().showMessage("未加载数据")
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)
        control_panel = self.create_control_panel()
        main_layout.addWidget(control_panel, 1)
        display_area = self.create_display_area()
        main_layout.addWidget(display_area, 3)

    def create_control_panel(self):
        panel = QGroupBox("控制面板")
        layout = QVBoxLayout(panel)
        file_group = QGroupBox("文件操作")
        file_layout = QVBoxLayout(file_group)
        self.load_btn = QPushButton("加载数据文件")
        self.load_btn.clicked.connect(self.load_file)
        self.file_label = QLabel("未加载文件")
        file_layout.addWidget(self.load_btn)
        file_layout.addWidget(self.file_label)
        layout.addWidget(file_group)

        mode_group = QGroupBox("分析模式")
        mode_layout = QVBoxLayout(mode_group)
        self.mode_combo = QComboBox()
        self.mode_combo.addItem("平台检测 (区间法)", "plateau")
        self.mode_combo.addItem("传统寻峰模式", "peak")
        self.mode_combo.currentIndexChanged.connect(self.on_analysis_mode_changed)
        mode_layout.addWidget(self.mode_combo)
        layout.addWidget(mode_group)

        process_group = QGroupBox("通用预处理参数")
        process_layout = QVBoxLayout(process_group)
        filter_mode_layout = QHBoxLayout()
        filter_mode_label = QLabel("平滑过滤方式:")
        filter_mode_label.setToolTip(
            "选择信号的平滑算法。\n'削峰+平滑'能有效去除边缘尖峰，推荐用于矩形波信号。\n'中值+平滑'是传统滤波方式。")
        filter_mode_layout.addWidget(filter_mode_label)
        self.filter_mode_combo = QComboBox()
        self.filter_mode_combo.addItem("削峰+平滑 (推荐)", "clip_smooth")
        self.filter_mode_combo.addItem("中值+平滑 (旧版)", "median_smooth")
        self.filter_mode_combo.currentIndexChanged.connect(lambda _: self.schedule_analysis())
        filter_mode_layout.addWidget(self.filter_mode_combo)
        process_layout.addLayout(filter_mode_layout)
        self.clipping_spin = self.create_spin_box(process_layout, "削峰分位数(%):",
                                                  "仅在'削峰+平滑'模式下生效。\n设定一个百分位数(例如98%)，信号中高于此分位数的极端峰值将被'削平'，以消除干扰。",
                                                  (90, 100), 98.0, 0.1, 1)
        self.median_spin = self.create_spin_box(process_layout, "中值滤波窗口:",
                                                "用于去除椒盐噪声（孤立的突变点）。\n窗口值越大，效果越强，但可能影响信号边缘。应为奇数。",
                                                (3, 21), 5, 2, 0)
        self.smooth_spin = self.create_spin_box(process_layout, "平滑窗口:",
                                                "使用Savitzky-Golay滤波器平滑信号曲线。\n窗口值越大，曲线越平滑，但可能丢失细节。应为奇数。",
                                                (3, 51), 11, 2, 0)
        self.baseline_spin = self.create_spin_box(process_layout, "手动基线:",
                                                  "从整个信号中减去此数值。\n用于将信号的基线手动对齐到0的位置，方便后续处理。",
                                                  (-1000, 1000), 0, 0.001, 4)
        layout.addWidget(process_group)

        self.plateau_group = QGroupBox("平台检测参数")
        plateau_layout = QVBoxLayout(self.plateau_group)
        self.low_thresh_spin = self.create_spin_box(plateau_layout, "幅度下限:",
                                                    "定义了有效平台的最低高度。\n信号值低于此线的点不会被计入平台。",
                                                    (-1000, 1000), 0.1, 0.001, 4)
        self.high_thresh_spin = self.create_spin_box(plateau_layout, "幅度上限:",
                                                     "定义了有效平台的最高高度。\n信号值高于此线的点不会被计入平台（例如，可以排除尖峰干扰）。",
                                                     (-1000, 1000), 0.5, 0.001, 4)
        self.min_len_spin = self.create_spin_box(plateau_layout, "最小长度:",
                                                 "平台所包含的连续数据点的最小数量。\n用于过滤掉过短的噪声波动。",
                                                 (0, 1000), 5, 1, 0)
        self.max_len_spin = self.create_spin_box(plateau_layout, "最大长度:",
                                                 "平台所包含的连续数据点的最大数量。\n用于排除异常的、过长的信号段。",
                                                 (0, 5000), 1000, 1, 0)
        self.deviation_spin = self.create_spin_box(plateau_layout, "边缘偏离阈值(%):",
                                                   "在找到平台后，用于精确计算其高度。\n程序会剔除掉比平台初始均值高出此百分比的边缘点，再计算最终的精确高度。",
                                                   (0, 100), 20, 1, 1)
        layout.addWidget(self.plateau_group)

        self.peak_group = QGroupBox("传统寻峰参数")
        peak_layout = QVBoxLayout(self.peak_group)
        self.height_spin = self.create_spin_box(peak_layout, "最小峰高:", "一个峰顶端相对于其基线的最小垂直高度。",
                                                (0.01, 100), 0.1, 0.001, 4)
        self.distance_spin = self.create_spin_box(peak_layout, "最小间距:",
                                                  "两个相邻峰之间的最小水平距离（单位：数据点）。", (1, 200), 10, 1, 0)
        self.prominence_spin = self.create_spin_box(peak_layout, "峰突性:",
                                                    "衡量一个峰相对于周围地形（其他山峰和山谷）的显著程度。\n值越高，找到的峰越重要和突出。",
                                                    (0.01, 2.0), 0.05, 0.001, 4)
        self.peak_group.setVisible(False)
        layout.addWidget(self.peak_group)

        options_group = QGroupBox("选项与导出")
        options_layout = QVBoxLayout(options_group)
        self.suggest_params_btn = QPushButton("自动建议参数")
        self.suggest_params_btn.setToolTip("根据当前数据特征，为“平台检测”模式自动填充建议的参数。")
        self.suggest_params_btn.clicked.connect(lambda _=False: self.suggest_parameters())
        options_layout.addWidget(self.suggest_params_btn)
        self.auto_refresh_checkbox = QCheckBox("自动刷新分析")
        self.auto_refresh_checkbox.setChecked(True)
        options_layout.addWidget(self.auto_refresh_checkbox)
        self.run_analysis_btn = QPushButton("运行分析")
        self.run_analysis_btn.setEnabled(False)
        self.run_analysis_btn.clicked.connect(lambda _=False: self.schedule_analysis(immediate=True))
        options_layout.addWidget(self.run_analysis_btn)
        self.show_labels_checkbox = QCheckBox("在图上显示数值标签")
        self.show_labels_checkbox.setChecked(True)
        self.show_labels_checkbox.stateChanged.connect(lambda _: self.update_preview_plot())
        options_layout.addWidget(self.show_labels_checkbox)
        self.render_export_btn = QPushButton("刷新导出图")
        self.render_export_btn.clicked.connect(lambda _=False: self.render_export_plot())
        options_layout.addWidget(self.render_export_btn)
        export_data_btn = QPushButton("导出数据 (Excel)")
        export_data_btn.clicked.connect(lambda _=False: self.export_data())
        options_layout.addWidget(export_data_btn)
        export_chart_btn = QPushButton("导出图表 (PNG/SVG)")
        export_chart_btn.clicked.connect(lambda _=False: self.export_chart())
        options_layout.addWidget(export_chart_btn)
        layout.addWidget(options_group)

        stats_group = QGroupBox("统计分析结果")
        self.stats_text = QTextEdit()
        self.stats_text.setReadOnly(True)
        stats_group.setLayout(QVBoxLayout())
        stats_group.layout().addWidget(self.stats_text)
        layout.addWidget(stats_group)
        layout.addStretch()
        return panel

    def create_spin_box(self, parent_layout, label_text, tooltip_text, range_tuple, default_val, step=1.0, decimals=2):
        layout = QHBoxLayout()
        label = QLabel(label_text)
        label.setToolTip(tooltip_text)
        layout.addWidget(label)
        spin_box = QDoubleSpinBox()
        spin_box.setRange(*range_tuple)
        spin_box.setValue(default_val)
        spin_box.setSingleStep(step)
        spin_box.setDecimals(decimals)
        spin_box.valueChanged.connect(lambda _: self.schedule_analysis())
        layout.addWidget(spin_box)
        parent_layout.addLayout(layout)
        return spin_box

    def create_display_area(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        self.tabs = QTabWidget()

        self.preview_tab = QWidget()
        preview_layout = QVBoxLayout(self.preview_tab)
        self.preview_plot = pg.PlotWidget()
        self.preview_plot.setBackground("w")
        self.preview_plot.showGrid(x=True, y=True, alpha=0.3)
        plot_item = self.preview_plot.getPlotItem()
        plot_item.setDownsampling(auto=True, mode="peak")
        plot_item.setClipToView(True)
        plot_item.setLabel("bottom", "Data Point")
        plot_item.setLabel("left", "Signal Intensity")
        preview_layout.addWidget(self.preview_plot)
        self.tabs.addTab(self.preview_tab, "快速预览")

        self.export_plot_tab = QWidget()
        export_plot_layout = QVBoxLayout(self.export_plot_tab)
        self.canvas = MplCanvas(self)
        self.toolbar = NavigationToolbar(self.canvas, self)
        export_plot_layout.addWidget(self.toolbar)
        export_plot_layout.addWidget(self.canvas)
        self.tabs.addTab(self.export_plot_tab, "导出图")

        self.table_tab = QWidget()
        table_layout = QVBoxLayout(self.table_tab)
        self.results_model = AnalysisTableModel(self)
        self.data_table = QTableView()
        self.data_table.setModel(self.results_model)
        self.data_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        table_layout.addWidget(self.data_table)
        self.tabs.addTab(self.table_tab, "分析数据表")

        layout.addWidget(self.tabs)
        return widget

    def on_analysis_mode_changed(self, *_):
        mode = self.mode_combo.currentData() or "plateau"
        is_plateau_mode = mode == "plateau"
        self.analyzer.set_analysis_mode(mode)
        self.plateau_group.setVisible(is_plateau_mode)
        self.peak_group.setVisible(not is_plateau_mode)
        self.suggest_params_btn.setEnabled(is_plateau_mode)
        self.schedule_analysis()

    def load_file(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "选择数据文件", "", "数据文件 (*.xlsx *.xls *.csv)")
        if not file_path:
            return
        try:
            df = pd.read_excel(file_path) if file_path.endswith((".xlsx", ".xls")) else pd.read_csv(file_path)
            dialog = ColumnSelectDialog(df.columns, self)
            if dialog.exec() == QDialog.Accepted:
                success, msg = self.analyzer.load_data(file_path, dialog.selected_data, dialog.selected_time)
                if success:
                    self.file_label.setText(f"已加载: {os.path.basename(file_path)}")
                    self.configure_auto_refresh_for_data_size()
                    self.statusBar().showMessage(msg)
                    self.run_analysis_btn.setEnabled(True)
                    self.suggest_parameters()
                else:
                    self.statusBar().showMessage(msg)
                    QMessageBox.warning(self, "错误", msg)
        except Exception as e:
            QMessageBox.critical(self, "文件读取错误", str(e))

    def configure_auto_refresh_for_data_size(self):
        if self.analyzer.original_signal is None:
            self.auto_refresh_checkbox.setChecked(True)
            self.run_analysis_btn.setEnabled(False)
            return
        is_large = len(self.analyzer.original_signal) > self.LARGE_DATA_THRESHOLD
        self.auto_refresh_checkbox.setChecked(not is_large)
        self.run_analysis_btn.setEnabled(True)
        if is_large:
            self.statusBar().showMessage("数据量较大，已关闭自动刷新；调整参数后点击“运行分析”。")

    def build_analysis_request(self):
        return SpectrumAnalyzer.normalize_analysis_request(
            AnalysisRequest(
                mode=self.mode_combo.currentData() or "plateau",
                preprocess=PreprocessParams(
                    filter_mode=self.filter_mode_combo.currentData() or "clip_smooth",
                    median_window=int(self.median_spin.value()),
                    smooth_window=int(self.smooth_spin.value()),
                    clipping_percentile=self.clipping_spin.value(),
                    manual_baseline=self.baseline_spin.value(),
                ),
                plateau=PlateauParams(
                    threshold_low=self.low_thresh_spin.value(),
                    threshold_high=self.high_thresh_spin.value(),
                    min_length=int(self.min_len_spin.value()),
                    max_length=int(self.max_len_spin.value()),
                    deviation_threshold=self.deviation_spin.value(),
                ),
                peak=PeakParams(
                    min_height=self.height_spin.value(),
                    min_distance=int(self.distance_spin.value()),
                    prominence=self.prominence_spin.value(),
                ),
            )
        )

    def schedule_analysis(self, immediate=False):
        if self.analyzer.original_signal is None:
            return
        self.run_analysis_btn.setEnabled(True)
        if not immediate and not self.auto_refresh_checkbox.isChecked():
            self.statusBar().showMessage("参数已更改，点击“运行分析”更新结果。")
            return
        if immediate:
            self.analysis_timer.stop()
            self.run_analysis()
        else:
            self.statusBar().showMessage("参数已更改，正在等待刷新...")
            self.analysis_timer.start(self.ANALYSIS_DEBOUNCE_MS)

    def update_analysis(self):
        if self.analyzer.original_signal is None:
            return
        result = self.analyzer.analyze(self.build_analysis_request())
        self.apply_analysis_result(result)

    def run_analysis(self):
        if self.analyzer.original_signal is None:
            return
        self._analysis_request_id += 1
        request_id = self._analysis_request_id
        request = self.build_analysis_request()
        self.run_analysis_btn.setEnabled(False)
        self.statusBar().showMessage("正在分析...")
        worker = AnalysisWorker(
            request_id,
            self.analyzer.original_signal,
            self.analyzer.time_data,
            self.analyzer.has_real_time,
            request,
        )
        worker.signals.finished.connect(self.on_analysis_finished)
        worker.signals.failed.connect(self.on_analysis_failed)
        self._workers[request_id] = worker
        self.thread_pool.start(worker)

    def on_analysis_finished(self, request_id, result):
        self._workers.pop(request_id, None)
        if request_id != self._analysis_request_id:
            self.statusBar().showMessage("已忽略过期分析结果。")
            return
        self.run_analysis_btn.setEnabled(True)
        self.apply_analysis_result(result)
        self.statusBar().showMessage("分析完成")

    def on_analysis_failed(self, request_id, message):
        self._workers.pop(request_id, None)
        if request_id != self._analysis_request_id:
            return
        self.run_analysis_btn.setEnabled(True)
        self.statusBar().showMessage(f"分析失败: {message}")
        QMessageBox.warning(self, "分析失败", message)

    def suggest_parameters(self):
        if self.analyzer.original_signal is None:
            self.statusBar().showMessage("请先加载数据文件。")
            return
        suggestion = self.analyzer.suggest_plateau_parameters(
            self.analyzer.original_signal,
            preprocess=PreprocessParams(
                filter_mode="clip_smooth",
                smooth_window=int(self.smooth_spin.value()),
                clipping_percentile=self.clipping_spin.value(),
                manual_baseline=self.baseline_spin.value(),
            ),
        )
        if not suggestion.ok:
            self.statusBar().showMessage(suggestion.message)
            return

        blockers = [
            QSignalBlocker(self.low_thresh_spin),
            QSignalBlocker(self.high_thresh_spin),
            QSignalBlocker(self.min_len_spin),
            QSignalBlocker(self.max_len_spin),
        ]
        try:
            self.low_thresh_spin.setValue(suggestion.plateau.threshold_low)
            self.high_thresh_spin.setValue(suggestion.plateau.threshold_high)
            self.min_len_spin.setValue(suggestion.plateau.min_length)
            self.max_len_spin.setValue(suggestion.plateau.max_length)
        finally:
            del blockers

        self.statusBar().showMessage(suggestion.message)
        self.schedule_analysis(immediate=True)

    def apply_analysis_result(self, result):
        self.analyzer.last_result = result
        self.analyzer.set_analysis_mode(result.mode)
        self.analyzer.processed_signal = result.processed_signal
        self.analyzer.plateaus = result.plateaus
        self.analyzer.plateau_properties = result.plateau_properties
        self.analyzer.peaks = result.peaks
        self.analyzer.peak_properties = result.peak_properties
        self.update_preview_plot(result)
        self.update_statistics(result.statistics)
        self.results_model.set_result(result)
        self._export_plot_dirty = True

    def update_plot(self):
        self.update_preview_plot()

    def update_preview_plot(self, result=None):
        result = result or self.analyzer.last_result
        self.preview_plot.clear()
        if result is None or len(result.original_signal) == 0:
            return

        self.preview_plot.getPlotItem().setLabel("bottom", "Time" if self.analyzer.has_real_time else "Data Point")
        self.preview_plot.plot(
            result.x_data,
            result.original_signal,
            pen=pg.mkPen((40, 110, 220, 95), width=1),
            name="Original Signal",
        )
        self.preview_plot.plot(
            result.x_data,
            result.processed_signal,
            pen=pg.mkPen((30, 150, 80), width=1.5),
            name="Processed Signal",
        )
        if result.mode == "plateau":
            self._plot_preview_plateaus(result)
        else:
            self._plot_preview_peaks(result)

    def _plot_preview_plateaus(self, result):
        props = result.plateau_properties or {}
        plateaus = result.plateaus if result.plateaus is not None else np.array([], dtype=int)
        low, high = self.low_thresh_spin.value(), self.high_thresh_spin.value()
        low_line = pg.InfiniteLine(pos=low, angle=0, pen=pg.mkPen((230, 180, 0), width=1, style=Qt.DashLine))
        high_line = pg.InfiniteLine(pos=high, angle=0, pen=pg.mkPen((230, 180, 0), width=1, style=Qt.DashLine))
        self.preview_plot.addItem(low_line)
        self.preview_plot.addItem(high_line)
        if len(plateaus) == 0:
            return
        heights = np.asarray(props.get("plateau_heights", []), dtype=float)
        self.preview_plot.plot(
            result.x_data[plateaus],
            heights,
            pen=None,
            symbol="o",
            symbolBrush=pg.mkBrush(230, 130, 20),
            symbolPen=pg.mkPen(170, 90, 0),
            symbolSize=8,
            name="Detected Plateau",
        )
        if self.show_labels_checkbox.isChecked():
            for i, center_idx in enumerate(plateaus[:self.MAX_PREVIEW_LABELS]):
                text = pg.TextItem(f"{i + 1}\n{heights[i]:.4f}", anchor=(0.5, 1.0), color=(40, 40, 40))
                text.setPos(result.x_data[center_idx], heights[i])
                self.preview_plot.addItem(text)

    def _plot_preview_peaks(self, result):
        peaks = result.peaks if result.peaks is not None else np.array([], dtype=int)
        if len(peaks) == 0:
            return
        heights = np.asarray(result.peak_properties.get("peak_heights", []), dtype=float)
        self.preview_plot.plot(
            result.x_data[peaks],
            heights,
            pen=None,
            symbol="o",
            symbolBrush=pg.mkBrush(210, 40, 50),
            symbolPen=pg.mkPen(140, 20, 30),
            symbolSize=8,
            name="Detected Peaks",
        )
        if self.show_labels_checkbox.isChecked():
            for i, peak_idx in enumerate(peaks[:self.MAX_PREVIEW_LABELS]):
                text = pg.TextItem(f"{i + 1}\n{heights[i]:.4f}", anchor=(0.5, 1.0), color=(40, 40, 40))
                text.setPos(result.x_data[peak_idx], heights[i])
                self.preview_plot.addItem(text)

    def render_export_plot(self):
        result = self.analyzer.last_result
        if result is None:
            return
        self.canvas.axes.clear()
        if len(result.original_signal) == 0:
            self.canvas.draw_idle()
            return

        x_label = "Time" if self.analyzer.has_real_time else "Data Point"
        self.canvas.axes.plot(result.x_data, result.original_signal, "b-", alpha=0.3, lw=1, label="Original Signal")
        self.canvas.axes.plot(result.x_data, result.processed_signal, "g-", alpha=0.9, lw=1.5,
                              label="Processed Signal")
        if result.mode == "plateau":
            self.render_export_plateaus(result)
            mode_title = "Plateau Detection (Thresholding)"
        else:
            self.render_export_peaks(result)
            mode_title = "Peak Detection"
        self.canvas.axes.set_xlabel(x_label)
        self.canvas.axes.set_ylabel("Signal Intensity")
        self.canvas.axes.set_title(f"Droplet Spectrum Analysis - {mode_title}")
        self.canvas.axes.legend(loc="upper right")
        self.canvas.axes.grid(True, alpha=0.4)
        self.canvas.draw_idle()
        self._export_plot_dirty = False

    def render_export_plateaus(self, result):
        props = result.plateau_properties or {}
        plateaus = result.plateaus if result.plateaus is not None else np.array([], dtype=int)
        low, high = self.low_thresh_spin.value(), self.high_thresh_spin.value()
        self.canvas.axes.axhspan(low, high, color="yellow", alpha=0.2, label="Detection Window")
        for i in range(len(plateaus)):
            start_idx, end_idx = props["plateau_starts"][i], props["plateau_ends"][i]
            self.canvas.axes.fill_between(
                result.x_data[start_idx:end_idx + 1],
                result.processed_signal[start_idx:end_idx + 1],
                alpha=0.5,
                color="orange",
                label="Detected Plateau" if i == 0 else "",
            )
            if self.show_labels_checkbox.isChecked() and i < self.MAX_PREVIEW_LABELS:
                center_idx, center_y = props["plateau_centers"][i], props["plateau_heights"][i]
                self.canvas.axes.annotate(
                    f"{i + 1}\n{center_y:.4f}",
                    (result.x_data[center_idx], center_y),
                    xytext=(0, 8),
                    textcoords="offset points",
                    ha="center",
                    fontsize=8,
                    bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.6),
                )

    def render_export_peaks(self, result):
        peaks = result.peaks if result.peaks is not None else np.array([], dtype=int)
        if len(peaks) == 0:
            return
        peak_x = result.x_data[peaks]
        peak_y = result.peak_properties["peak_heights"]
        self.canvas.axes.plot(peak_x, peak_y, "ro", markersize=6, label="Detected Peaks")
        if self.show_labels_checkbox.isChecked():
            for i, (px, py) in enumerate(zip(peak_x[:self.MAX_PREVIEW_LABELS], peak_y[:self.MAX_PREVIEW_LABELS])):
                self.canvas.axes.annotate(
                    f"{i + 1}\n{py:.4f}",
                    (px, py),
                    xytext=(0, 8),
                    textcoords="offset points",
                    ha="center",
                    fontsize=8,
                    bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.6),
                )

    def update_statistics(self, stats):
        if stats:
            if self.analyzer.analysis_mode == "plateau":
                text = (
                    f"平台分析结果:\n平台数量: {stats['plateau_count']} | 平均高度: {stats.get('mean_height', 0):.4f}\n"
                    f"RSD (%): {stats.get('rsd', 0):.2f} | 平均长度: {stats.get('mean_length', 0):.1f}"
                )
            else:
                text = (
                    f"寻峰分析结果:\n峰数量: {stats['peak_count']} | 平均高度: {stats.get('mean_height', 0):.4f}\n"
                    f"RSD (%): {stats.get('rsd', 0):.2f}"
                )
            self.stats_text.setText(text.strip())
        else:
            self.stats_text.setText(
                f"在当前参数下未检测到{'平台' if self.analyzer.analysis_mode == 'plateau' else '峰'}")

    def update_data_table(self):
        self.results_model.set_result(self.analyzer.last_result)

    def export_data(self):
        if self.results_model.rowCount() == 0:
            QMessageBox.warning(self, "无数据", "表格中没有数据可以导出。")
            return
        file_path, _ = QFileDialog.getSaveFileName(self, "导出数据为 Excel", "", "Excel 文件 (*.xlsx)")
        if not file_path:
            return
        try:
            df = pd.DataFrame(self.results_model.rows, columns=self.results_model.headers)
            df.to_excel(file_path, index=False)
            self.statusBar().showMessage(f"数据已导出到: {file_path}")
            QMessageBox.information(self, "成功", f"数据已成功导出到:\n{file_path}")
        except Exception as e:
            QMessageBox.critical(self, "导出失败", f"导出数据时发生错误: {e}")

    def export_chart(self):
        file_path, _ = QFileDialog.getSaveFileName(self, "导出图表", "", "PNG 图像文件 (*.png);;矢量图 (*.svg)")
        if not file_path:
            return
        try:
            if self.analyzer.last_result is None:
                self.update_analysis()
            if self._export_plot_dirty:
                self.render_export_plot()
            self.canvas.fig.savefig(file_path, dpi=300, bbox_inches="tight")
            self.statusBar().showMessage(f"图表已导出到: {file_path}")
            QMessageBox.information(self, "成功", f"图表已成功导出到:\n{file_path}")
        except Exception as e:
            QMessageBox.critical(self, "导出失败", f"导出图表时发生错误: {e}")
