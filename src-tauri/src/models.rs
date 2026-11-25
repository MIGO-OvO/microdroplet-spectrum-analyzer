use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Stored analysis identity. Plateau is accepted for older records; new runs use Droplet.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisMode {
    Plateau,
    #[default]
    Droplet,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    #[default]
    ClipSmooth,
    MedianSmooth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreprocessParams {
    pub filter_mode: FilterMode,
    pub median_window: usize,
    pub smooth_window: usize,
    pub smooth_order: usize,
    pub clipping_percentile: f64,
    pub manual_baseline: f64,
}

impl Default for PreprocessParams {
    fn default() -> Self {
        Self {
            filter_mode: FilterMode::ClipSmooth,
            median_window: 5,
            smooth_window: 51,
            smooth_order: 3,
            clipping_percentile: 98.0,
            manual_baseline: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlateauParams {
    pub threshold_low: f64,
    pub threshold_high: f64,
    pub min_length: usize,
    pub max_length: usize,
    pub deviation_threshold: f64,
}

impl Default for PlateauParams {
    fn default() -> Self {
        Self {
            threshold_low: 0.1,
            threshold_high: 0.5,
            min_length: 5,
            max_length: 1000,
            deviation_threshold: 20.0,
        }
    }
}

/// Parameters of the dual-state droplet engine.
///
/// Only the first group is meant for everyday use. The second group contains
/// adaptive defaults that are exposed as "advanced" controls; every one of them
/// changes a *decision*, never the physical measurement, which always comes from
/// the raw signal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DropletParams {
    /// Explicit windows on the processed detection signal; None uses automatic classification.
    #[serde(default)]
    pub amplitude_bands: Option<AmplitudeBands>,
    /// Minimum number of samples a stable run must span.
    pub min_segment_length: usize,
    /// Maximum number of samples a stable run may span; `0` disables the limit.
    pub max_segment_length: usize,
    /// Odd window used for the local stability decision (slope and spread).
    pub stability_window: usize,
    /// Fraction of each stable run trimmed from both ends before measuring.
    pub edge_trim_fraction: f64,
    /// MAD multiple used to reject outliers inside a measured interior.
    pub outlier_sigma: f64,
    /// Whether a Bottom with only one neighbouring Platform still yields a result.
    pub allow_single_sided_reference: bool,
    /// Odd centered-median window of the symmetric despike stage.
    pub despike_window: usize,
    /// Hampel threshold: residual multiple of the local scaled MAD.
    pub despike_sigma: f64,
    /// Local spread must stay below this multiple of the detection noise.
    pub noise_factor: f64,
    /// Local trend must stay below this multiple of the detection noise.
    pub slope_factor: f64,
    /// Two-state separation must exceed this multiple of the noise/within spread.
    pub cluster_separation_factor: f64,
    /// Reference pairing is soft-flagged beyond this multiple of the typical segment gap.
    pub reference_gap_factor: f64,
}

impl Default for DropletParams {
    fn default() -> Self {
        Self {
            amplitude_bands: Some(AmplitudeBands {
                low_min: -0.07,
                low_max: 0.01,
                high_min: 0.1,
                high_max: 0.5,
            }),
            min_segment_length: 150,
            max_segment_length: 0,
            stability_window: 15,
            edge_trim_fraction: 0.08,
            outlier_sigma: 3.0,
            allow_single_sided_reference: true,
            despike_window: 5,
            despike_sigma: 3.0,
            noise_factor: 6.0,
            slope_factor: 3.0,
            cluster_separation_factor: 2.5,
            reference_gap_factor: 3.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AmplitudeBands {
    pub low_min: f64,
    pub low_max: f64,
    pub high_min: f64,
    pub high_max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XRange {
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    #[serde(default)]
    pub x_range: Option<XRange>,
    pub mode: AnalysisMode,
    pub preprocess: PreprocessParams,
    #[serde(default)]
    pub plateau: PlateauParams,
    /// `serde(default)` keeps older payloads working after the droplet mode landed.
    #[serde(default)]
    pub droplet: DropletParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectFileRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub index: usize,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInspection {
    pub file_name: String,
    pub row_count: usize,
    pub columns: Vec<ColumnInfo>,
    pub samples: Vec<crate::csv_samples::SampleMetadata>,
    pub suggested_signal_column: Option<usize>,
    pub suggested_time_column: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadDataRequest {
    pub path: String,
    pub data_column_index: usize,
    pub time_column_index: Option<usize>,
    pub sample_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetSummary {
    pub file_name: String,
    pub point_count: usize,
    pub dropped_rows: usize,
    pub has_real_time: bool,
    pub columns: Vec<ColumnInfo>,
    pub sample: Option<crate::csv_samples::SampleMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateauFeature {
    pub number: usize,
    pub center_index: usize,
    pub center: f64,
    pub start: f64,
    pub end: f64,
    pub height: f64,
    pub length: usize,
    pub standard_deviation: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SegmentKind {
    /// Stability was proven, but the level could not be attached to either state.
    #[default]
    Unknown,
    /// Upper stable state of the dual-state model.
    Platform,
    /// Lower stable state, used as the baseline reference.
    Bottom,
}

impl SegmentKind {
    /// Stable wire string used in warnings and exports.
    pub fn label(self) -> &'static str {
        match self {
            SegmentKind::Unknown => "Unknown",
            SegmentKind::Platform => "Platform",
            SegmentKind::Bottom => "Bottom",
        }
    }
}

/// How `baseline_reference` was obtained for one droplet.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceMode {
    /// Left and right low segments were available and linearly interpolated.
    #[default]
    Interpolated,
    /// Only a left low segment was in range; its level was used directly.
    LeftOnly,
    /// Only a right low segment was in range; its level was used directly.
    RightOnly,
    /// No usable low segment; no corrected signal was produced.
    None,
}

impl ReferenceMode {
    /// Stable wire string, identical to the serde representation.
    pub fn label(self) -> &'static str {
        match self {
            ReferenceMode::Interpolated => "interpolated",
            ReferenceMode::LeftOnly => "leftOnly",
            ReferenceMode::RightOnly => "rightOnly",
            ReferenceMode::None => "none",
        }
    }
}

/// Independent, machine-readable quality markers. Deliberately an enum: a single
/// free-form "bad" string cannot be filtered or translated by the UI/exporter.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum QualityFlag {
    /// The segment level sat too far from either state centre to be trusted.
    LowClassificationConfidence,
    /// `baseline_reference` came from a single low segment instead of interpolation.
    SingleSidedReference,
    /// A paired low segment was further away than the typical segment spacing.
    LargeReferenceGap,
    /// A low reference interior was noisier than the global robust noise estimate.
    NoisyBottom,
    /// The measured high segment was noisier than the global estimate.
    NoisyPlatform,
    /// An unrecognised stable segment sits inside the reference span.
    NearbyUnknownSegment,
    /// Real x could not be used for interpolation; sample indices were substituted.
    IndexTimeFallback,
}

impl QualityFlag {
    /// Stable wire string, identical to the serde representation.
    pub fn label(self) -> &'static str {
        match self {
            QualityFlag::LowClassificationConfidence => "lowClassificationConfidence",
            QualityFlag::SingleSidedReference => "singleSidedReference",
            QualityFlag::LargeReferenceGap => "largeReferenceGap",
            QualityFlag::NoisyBottom => "noisyBottom",
            QualityFlag::NoisyPlatform => "noisyPlatform",
            QualityFlag::NearbyUnknownSegment => "nearbyUnknownSegment",
            QualityFlag::IndexTimeFallback => "indexTimeFallback",
        }
    }
}

/// One stable region of the detection signal together with the level measured on
/// the raw signal. Detection and measurement are intentionally separate fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StableSegment {
    /// 1-based segment number, also referenced by `DropletMeasurement`.
    pub number: usize,
    pub start_index: usize,
    pub end_index: usize,
    pub center_index: usize,
    pub start: f64,
    pub end: f64,
    pub center: f64,
    /// Robust level measured on the raw signal interior, not on the smoothed signal.
    pub level: f64,
    pub standard_deviation: f64,
    /// Scaled median absolute deviation of the measured interior.
    pub mad: f64,
    /// Least-squares slope of the raw interior against x.
    pub slope: f64,
    pub length: usize,
    /// Interior samples retained after MAD clipping.
    pub effective_length: usize,
    pub kind: SegmentKind,
    /// Product of the stability score and the two-state classification score.
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DropletMeasurement {
    pub number: usize,
    /// 1-based number of the high (Platform) segment that produced this droplet.
    pub high_segment: usize,
    pub left_low_segment: Option<usize>,
    pub right_low_segment: Option<usize>,
    pub center_index: usize,
    pub center: f64,
    pub high_level: f64,
    pub left_low_level: Option<f64>,
    pub right_low_level: Option<f64>,
    /// Locally interpolated low baseline at the high segment's x position.
    pub baseline_reference: f64,
    /// `high_level - baseline_reference`, the requested delta signal.
    pub corrected_signal: f64,
    pub reference_mode: ReferenceMode,
    pub confidence: f64,
    pub quality_flags: Vec<QualityFlag>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DropletStatistics {
    pub droplet_count: usize,
    pub mean_corrected_signal: Option<f64>,
    pub min_corrected_signal: Option<f64>,
    pub max_corrected_signal: Option<f64>,
    pub standard_deviation: Option<f64>,
    pub rsd: Option<f64>,
    pub mean_high: Option<f64>,
    pub mean_baseline: Option<f64>,
    /// Full detected high-platform lengths in samples, including unpaired highs.
    #[serde(default)]
    pub mean_length: Option<f64>,
    #[serde(default)]
    pub length_standard_deviation: Option<f64>,
    #[serde(default)]
    pub length_rsd: Option<f64>,
    pub interpolated_count: usize,
    pub single_sided_count: usize,
    pub low_confidence_count: usize,
    /// Stable segments that stayed `Unknown` after regularisation.
    pub unknown_segment_count: usize,
}

/// Identifies which detection pipeline produced a cached preprocessed signal.
///
/// Parameters that change the detection signal and invalidate its cache.
#[derive(Debug, Clone, PartialEq)]
pub enum DetectionKey {
    Droplet {
        despike_window: usize,
        despike_sigma: f64,
    },
}

/// A preprocess cache entry: the detection signal plus the robust scales derived
/// while building it, so later stages never have to re-scan the raw record.
#[derive(Debug, Clone)]
pub struct PreprocessCache {
    pub sample_range: (usize, usize),
    pub dataset_revision: u64,
    pub params: PreprocessParams,
    pub detection: DetectionKey,
    pub values: Arc<Vec<f64>>,
    /// Robust sigma of the detection signal's residual noise.
    pub noise: f64,
    /// Robust magnitude of the detection signal, used for absolute floors.
    pub scale: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStatistics {
    pub feature_count: usize,
    pub mean_height: Option<f64>,
    pub max_height: Option<f64>,
    pub min_height: Option<f64>,
    pub standard_deviation: Option<f64>,
    pub rsd: Option<f64>,
    pub mean_length: Option<f64>,
    pub length_standard_deviation: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotSeries {
    pub x: Vec<f64>,
    pub original: Vec<f64>,
    pub processed: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResponse {
    pub result_id: u64,
    pub mode: AnalysisMode,
    pub plot: PlotSeries,
    pub plateau_features: Vec<PlateauFeature>,
    pub statistics: AnalysisStatistics,
    pub stable_segments: Vec<StableSegment>,
    pub droplet_measurements: Vec<DropletMeasurement>,
    pub droplet_statistics: DropletStatistics,
    pub used_cached_preprocess: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterSuggestion {
    pub ok: bool,
    pub message: String,
    pub plateau: Option<PlateauParams>,
    pub droplet: Option<DropletParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionRequest {
    pub preprocess: PreprocessParams,
    #[serde(default)]
    pub x_range: Option<XRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    pub path: String,
}

#[derive(Debug, Clone)]
pub struct Dataset {
    pub revision: u64,
    pub file_name: String,
    pub columns: Vec<ColumnInfo>,
    pub signal: Arc<Vec<f64>>,
    pub time: Option<Arc<Vec<f64>>>,
    pub dropped_rows: usize,
}

#[derive(Debug, Clone)]
pub struct FullAnalysisResult {
    pub result_id: u64,
    pub request: AnalysisRequest,
    pub has_real_time: bool,
    pub x: Arc<Vec<f64>>,
    pub original: Arc<Vec<f64>>,
    /// Detection signal; physical levels are measured on the original signal.
    pub processed: Arc<Vec<f64>>,
    pub plateau_features: Vec<PlateauFeature>,
    pub statistics: AnalysisStatistics,
    pub stable_segments: Vec<StableSegment>,
    pub droplet_measurements: Vec<DropletMeasurement>,
    pub droplet_statistics: DropletStatistics,
    pub used_cached_preprocess: bool,
    pub warnings: Vec<String>,
}
