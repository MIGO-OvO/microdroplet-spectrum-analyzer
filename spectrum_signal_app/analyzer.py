from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.signal import find_peaks, medfilt, savgol_filter


@dataclass(frozen=True)
class PreprocessParams:
    filter_mode: str = "clip_smooth"
    median_window: int = 5
    smooth_window: int = 11
    smooth_order: int = 3
    clipping_percentile: float = 98.0
    manual_baseline: float = 0.0


@dataclass(frozen=True)
class PlateauParams:
    threshold_low: float = 0.1
    threshold_high: float = 0.5
    min_length: int = 5
    max_length: int = 1000
    deviation_threshold: float = 20.0


@dataclass(frozen=True)
class PeakParams:
    min_height: float = 0.1
    min_distance: int = 10
    prominence: float = 0.05


@dataclass(frozen=True)
class AnalysisRequest:
    mode: str = "plateau"
    preprocess: PreprocessParams = field(default_factory=PreprocessParams)
    plateau: PlateauParams = field(default_factory=PlateauParams)
    peak: PeakParams = field(default_factory=PeakParams)


@dataclass
class AnalysisResult:
    mode: str
    x_data: np.ndarray
    original_signal: np.ndarray
    processed_signal: np.ndarray
    plateaus: np.ndarray
    plateau_properties: dict
    peaks: np.ndarray
    peak_properties: dict
    statistics: dict
    used_cached_preprocess: bool = False
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class ParameterSuggestion:
    ok: bool
    message: str
    plateau: PlateauParams | None = None


class SpectrumAnalyzer:
    def __init__(self):
        self.original_signal = None
        self.time_data = None
        self.has_real_time = False
        self.processed_signal = None
        self.plateaus = None
        self.plateau_properties = None
        self.peaks = None
        self.peak_properties = None
        self.analysis_mode = "plateau"
        self.last_result = None
        self._preprocess_cache_key = None
        self._preprocess_cache_result = None

    def set_analysis_mode(self, mode):
        self.analysis_mode = "peak" if mode == "peak" else "plateau"

    def clear_cache(self):
        self._preprocess_cache_key = None
        self._preprocess_cache_result = None

    def load_data(self, file_path, data_column, time_column=None):
        try:
            df = pd.read_csv(file_path) if file_path.endswith(".csv") else pd.read_excel(file_path)
            data_col_idx = self.find_column_index(df, data_column)
            if data_col_idx is None:
                return False, f"Data column not found: {data_column}"

            raw_signal = pd.to_numeric(df.iloc[:, data_col_idx], errors="coerce")
            has_time_column = time_column and time_column != "None"
            raw_time = None
            if has_time_column:
                time_col_idx = self.find_column_index(df, time_column)
                if time_col_idx is None:
                    return False, f"Time column not found: {time_column}"
                raw_time = pd.to_numeric(df.iloc[:, time_col_idx], errors="coerce")
                valid_mask = raw_signal.notna() & raw_time.notna()
            else:
                valid_mask = raw_signal.notna()

            dropped_rows = int((~valid_mask).sum())
            signal = raw_signal[valid_mask].to_numpy(dtype=float)
            if len(signal) == 0:
                return False, "No numeric signal values found in selected data column"

            self.original_signal = signal
            if raw_time is not None:
                self.time_data = raw_time[valid_mask].to_numpy(dtype=float)
                self.has_real_time = True
            else:
                self.time_data = None
                self.has_real_time = False

            self.processed_signal = None
            self.plateaus = None
            self.plateau_properties = None
            self.peaks = None
            self.peak_properties = None
            self.last_result = None
            self.clear_cache()

            message = "Data loaded successfully"
            if dropped_rows:
                message += f"; dropped {dropped_rows} non-numeric/empty rows"
            return True, message
        except Exception as e:
            return False, f"Data loading failed: {str(e)}"

    def find_column_index(self, df, column_name):
        if column_name in df.columns:
            return df.columns.get_loc(column_name)
        try:
            idx = int(column_name)
            if 0 <= idx < len(df.columns):
                return idx
        except (ValueError, TypeError):
            pass
        target = str(column_name).strip()
        for i, col in enumerate(df.columns):
            if str(col).strip() == target:
                return i
        return None

    @staticmethod
    def _normalize_filter_mode(filter_mode):
        text = str(filter_mode or "").strip()
        if text in {"clip_smooth", "clip", "削峰+平滑", "削峰+平滑 (推荐)"} or text.startswith("削峰"):
            return "clip_smooth"
        return "median_smooth"

    @staticmethod
    def _odd_window(value, minimum=3):
        value = max(minimum, int(round(value)))
        return value if value % 2 == 1 else value + 1

    @staticmethod
    def normalize_preprocess_params(params):
        params = params if isinstance(params, PreprocessParams) else PreprocessParams()
        median_window = SpectrumAnalyzer._odd_window(params.median_window)
        smooth_window = SpectrumAnalyzer._odd_window(params.smooth_window)
        smooth_order = max(0, min(int(params.smooth_order), smooth_window - 1))
        clipping_percentile = min(100.0, max(0.0, float(params.clipping_percentile)))
        return PreprocessParams(
            filter_mode=SpectrumAnalyzer._normalize_filter_mode(params.filter_mode),
            median_window=median_window,
            smooth_window=smooth_window,
            smooth_order=smooth_order,
            clipping_percentile=clipping_percentile,
            manual_baseline=float(params.manual_baseline),
        )

    @staticmethod
    def normalize_plateau_params(params):
        params = params if isinstance(params, PlateauParams) else PlateauParams()
        low = float(params.threshold_low)
        high = float(params.threshold_high)
        if low > high:
            low, high = high, low
        min_length = max(1, int(round(params.min_length)))
        max_length = max(1, int(round(params.max_length)))
        if min_length > max_length:
            min_length, max_length = max_length, min_length
        return PlateauParams(
            threshold_low=low,
            threshold_high=high,
            min_length=min_length,
            max_length=max_length,
            deviation_threshold=max(0.0, float(params.deviation_threshold)),
        )

    @staticmethod
    def normalize_peak_params(params):
        params = params if isinstance(params, PeakParams) else PeakParams()
        return PeakParams(
            min_height=float(params.min_height),
            min_distance=max(1, int(round(params.min_distance))),
            prominence=max(0.0, float(params.prominence)),
        )

    @staticmethod
    def normalize_analysis_request(request):
        request = request if isinstance(request, AnalysisRequest) else AnalysisRequest()
        mode = "peak" if request.mode == "peak" else "plateau"
        return AnalysisRequest(
            mode=mode,
            preprocess=SpectrumAnalyzer.normalize_preprocess_params(request.preprocess),
            plateau=SpectrumAnalyzer.normalize_plateau_params(request.plateau),
            peak=SpectrumAnalyzer.normalize_peak_params(request.peak),
        )

    @staticmethod
    def _clean_signal_array(signal):
        signal = np.asarray(signal, dtype=float)
        if signal.ndim != 1:
            signal = signal.ravel()
        if not np.isfinite(signal).all():
            signal = pd.Series(signal).interpolate(limit_direction="both").fillna(0.0).to_numpy(dtype=float)
        return signal

    @staticmethod
    def _window_for_signal(window, signal_length):
        if signal_length < 3:
            return None
        window = min(window, signal_length)
        if window % 2 == 0:
            window -= 1
        return window if window >= 3 else None

    def _compute_preprocessed(self, signal, params):
        params = self.normalize_preprocess_params(params)
        processed = self._clean_signal_array(signal).astype(float, copy=True)

        if params.filter_mode == "clip_smooth":
            if params.clipping_percentile < 100:
                threshold = np.percentile(processed, params.clipping_percentile)
                processed = np.clip(processed, a_min=None, a_max=threshold)
            smooth_window = self._window_for_signal(params.smooth_window, len(processed))
            if smooth_window is not None:
                smooth_order = min(params.smooth_order, smooth_window - 1)
                processed = savgol_filter(processed, smooth_window, smooth_order)
        else:
            median_window = self._window_for_signal(params.median_window, len(processed))
            if median_window is not None:
                processed = medfilt(processed, median_window)
            smooth_window = self._window_for_signal(params.smooth_window, len(processed))
            if smooth_window is not None:
                smooth_order = min(params.smooth_order, smooth_window - 1)
                processed = savgol_filter(processed, smooth_window, smooth_order)

        return processed - params.manual_baseline

    def _cache_key_for(self, signal, params):
        array = np.asarray(signal)
        return (id(signal), array.shape, str(array.dtype), params)

    def _preprocess_with_cache(self, signal, params):
        params = self.normalize_preprocess_params(params)
        key = self._cache_key_for(signal, params)
        if self._preprocess_cache_key == key and self._preprocess_cache_result is not None:
            self.processed_signal = self._preprocess_cache_result
            return self.processed_signal, True
        self.processed_signal = self._compute_preprocessed(signal, params)
        self._preprocess_cache_key = key
        self._preprocess_cache_result = self.processed_signal
        return self.processed_signal, False

    def preprocess_signal(self, signal, filter_mode="削峰+平滑", median_window=5, smooth_window=11,
                          smooth_order=3, clipping_percentile=98.0, manual_baseline=0.0):
        params = PreprocessParams(
            filter_mode=filter_mode,
            median_window=median_window,
            smooth_window=smooth_window,
            smooth_order=smooth_order,
            clipping_percentile=clipping_percentile,
            manual_baseline=manual_baseline,
        )
        self.processed_signal, _ = self._preprocess_with_cache(signal, params)
        return self.processed_signal

    def detect_plateaus(self, threshold_low, threshold_high, min_length=5, max_length=1000, deviation_threshold=20.0):
        if self.processed_signal is None:
            return None, None
        try:
            params = self.normalize_plateau_params(
                PlateauParams(threshold_low, threshold_high, min_length, max_length, deviation_threshold)
            )
            mask = (self.processed_signal >= params.threshold_low) & (self.processed_signal <= params.threshold_high)
            bounded_mask = np.concatenate(([False], mask, [False]))
            diffs = np.diff(bounded_mask.astype(int))
            starts = np.where(diffs == 1)[0]
            ends = np.where(diffs == -1)[0] - 1
            final_properties = {"plateau_values": [], "plateau_starts": [], "plateau_ends": [], "plateau_lengths": [],
                                "plateau_heights": [], "plateau_std": [], "plateau_centers": []}
            for start_idx, end_idx in zip(starts, ends):
                length = end_idx - start_idx + 1
                if params.min_length <= length <= params.max_length:
                    plateau_data = self.processed_signal[start_idx: end_idx + 1]
                    initial_mean = np.mean(plateau_data)
                    deviation_limit = initial_mean * (1 + params.deviation_threshold / 100.0)
                    refined_data = plateau_data[plateau_data <= deviation_limit]
                    if len(refined_data) < params.min_length / 2:
                        continue
                    final_mean_height = float(np.mean(refined_data))
                    final_std = float(np.std(refined_data))
                    final_properties["plateau_starts"].append(int(start_idx))
                    final_properties["plateau_ends"].append(int(end_idx))
                    final_properties["plateau_lengths"].append(int(length))
                    final_properties["plateau_heights"].append(final_mean_height)
                    final_properties["plateau_std"].append(final_std)
                    final_properties["plateau_centers"].append(int((start_idx + end_idx) // 2))
                    final_properties["plateau_values"].append(final_mean_height)
            self.plateaus = np.array(final_properties["plateau_centers"], dtype=int)
            self.plateau_properties = final_properties
            return self.plateaus, self.plateau_properties
        except Exception as e:
            print(f"Plateau detection error: {e}")
            return None, None

    def detect_peaks(self, min_height=0.1, min_distance=10, prominence=0.05):
        if self.processed_signal is None:
            return None, None
        try:
            params = self.normalize_peak_params(PeakParams(min_height, min_distance, prominence))
            self.peaks, self.peak_properties = find_peaks(
                self.processed_signal,
                height=params.min_height,
                distance=params.min_distance,
                prominence=params.prominence,
                width=2,
            )
            return self.peaks, self.peak_properties
        except Exception as e:
            print(f"Peak detection error: {e}")
            return None, None

    def calculate_statistics(self):
        if self.analysis_mode == "plateau":
            return self.calculate_plateau_statistics()
        return self.calculate_peak_statistics()

    def calculate_plateau_statistics(self):
        if self.plateaus is None or len(self.plateaus) == 0:
            return {}
        heights = np.asarray(self.plateau_properties["plateau_heights"], dtype=float)
        lengths = np.asarray(self.plateau_properties["plateau_lengths"], dtype=float)
        return {"plateau_count": len(self.plateaus), "mean_height": float(np.mean(heights)),
                "max_height": float(np.max(heights)), "min_height": float(np.min(heights)),
                "std_height": float(np.std(heights)),
                "rsd": float((np.std(heights) / np.mean(heights)) * 100) if np.mean(heights) != 0 else 0.0,
                "mean_length": float(np.mean(lengths)), "std_length": float(np.std(lengths))}

    def calculate_peak_statistics(self):
        if self.peaks is None or len(self.peaks) == 0:
            return {}
        heights = np.asarray(self.peak_properties["peak_heights"], dtype=float)
        return {"peak_count": len(self.peaks), "mean_height": float(np.mean(heights)),
                "max_height": float(np.max(heights)), "min_height": float(np.min(heights)),
                "std_height": float(np.std(heights)),
                "rsd": float((np.std(heights) / np.mean(heights)) * 100) if np.mean(heights) != 0 else 0.0}

    def suggest_plateau_parameters(self, signal=None, preprocess=None):
        signal = self.original_signal if signal is None else signal
        if signal is None:
            return ParameterSuggestion(False, "请先加载数据文件。")

        params = self.normalize_preprocess_params(preprocess or PreprocessParams(filter_mode="clip_smooth"))
        processed = self._compute_preprocessed(signal, params)
        if processed is None or len(processed) < 20:
            return ParameterSuggestion(False, "数据点过少，无法自动建议参数。")

        baseline_val = np.percentile(processed, 10)
        global_std = float(np.std(processed))
        noise_region = processed[processed < baseline_val + global_std * 0.5]
        noise_std = float(np.std(noise_region)) if len(noise_region) else global_std
        high_signal_mask = processed > baseline_val + 5 * noise_std
        rolling_std = pd.Series(processed).rolling(window=15, center=True).std()
        stable_values = rolling_std.dropna()
        if len(stable_values) == 0:
            return ParameterSuggestion(False, "数据点过少，无法判断稳定平台。")

        stable_mask = rolling_std <= np.percentile(stable_values, 25)
        candidate_points = processed[high_signal_mask & stable_mask.to_numpy(dtype=bool)]
        if len(candidate_points) < 10 and int(np.sum(high_signal_mask)) >= 10:
            candidate_points = processed[high_signal_mask]
        if len(candidate_points) < 10:
            return ParameterSuggestion(False, "未能找到足够清晰的平台区域用于自动建议。")

        suggested_low = float(np.percentile(candidate_points, 15))
        suggested_high = float(np.percentile(candidate_points, 85))
        if suggested_low > suggested_high:
            suggested_low, suggested_high = suggested_high, suggested_low

        mask = (processed >= suggested_low) & (processed <= suggested_high)
        bounded_mask = np.concatenate(([False], mask, [False]))
        diffs = np.diff(bounded_mask.astype(int))
        starts = np.where(diffs == 1)[0]
        ends = np.where(diffs == -1)[0] - 1
        min_length = 5
        max_length = 1000
        if len(starts) > 0:
            lengths = ends - starts + 1
            min_length = max(5, int(round(np.percentile(lengths, 10))))
            max_length = max(min_length, int(round(np.percentile(lengths, 90) * 1.5)))

        plateau = self.normalize_plateau_params(
            PlateauParams(suggested_low, suggested_high, min_length, max_length)
        )
        return ParameterSuggestion(True, "已根据数据特征自动填写建议参数。", plateau)

    def analyze(self, request):
        request = self.normalize_analysis_request(request)
        self.set_analysis_mode(request.mode)
        if self.original_signal is None:
            empty = np.array([], dtype=float)
            result = AnalysisResult(
                mode=request.mode,
                x_data=empty,
                original_signal=empty,
                processed_signal=empty,
                plateaus=np.array([], dtype=int),
                plateau_properties={},
                peaks=np.array([], dtype=int),
                peak_properties={},
                statistics={},
                warnings=("No data loaded",),
            )
            self.last_result = result
            return result

        processed, used_cached = self._preprocess_with_cache(self.original_signal, request.preprocess)
        x_data = self.time_data if self.has_real_time and self.time_data is not None else np.arange(len(self.original_signal))

        if request.mode == "plateau":
            plateaus, plateau_properties = self.detect_plateaus(
                request.plateau.threshold_low,
                request.plateau.threshold_high,
                request.plateau.min_length,
                request.plateau.max_length,
                request.plateau.deviation_threshold,
            )
            peaks = np.array([], dtype=int)
            peak_properties = {}
        else:
            peaks, peak_properties = self.detect_peaks(
                request.peak.min_height,
                request.peak.min_distance,
                request.peak.prominence,
            )
            plateaus = np.array([], dtype=int)
            plateau_properties = {}

        result = AnalysisResult(
            mode=request.mode,
            x_data=np.asarray(x_data),
            original_signal=np.asarray(self.original_signal),
            processed_signal=processed,
            plateaus=plateaus if plateaus is not None else np.array([], dtype=int),
            plateau_properties=plateau_properties or {},
            peaks=peaks if peaks is not None else np.array([], dtype=int),
            peak_properties=peak_properties or {},
            statistics=self.calculate_statistics(),
            used_cached_preprocess=used_cached,
        )
        self.last_result = result
        return result
