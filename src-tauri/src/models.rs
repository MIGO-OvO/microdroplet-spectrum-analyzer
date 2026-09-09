use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisMode {
    #[default]
    Plateau,
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
            smooth_window: 11,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    pub mode: AnalysisMode,
    pub preprocess: PreprocessParams,
    pub plateau: PlateauParams,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadDataRequest {
    pub path: String,
    pub data_column_index: usize,
    pub time_column_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetSummary {
    pub file_name: String,
    pub point_count: usize,
    pub dropped_rows: usize,
    pub has_real_time: bool,
    pub columns: Vec<ColumnInfo>,
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
    pub used_cached_preprocess: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterSuggestion {
    pub ok: bool,
    pub message: String,
    pub plateau: Option<PlateauParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionRequest {
    pub preprocess: PreprocessParams,
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
pub struct PreprocessCache {
    pub dataset_revision: u64,
    pub params: PreprocessParams,
    pub values: Arc<Vec<f64>>,
}

#[derive(Debug, Clone)]
pub struct FullAnalysisResult {
    pub result_id: u64,
    pub request: AnalysisRequest,
    pub has_real_time: bool,
    pub x: Arc<Vec<f64>>,
    pub original: Arc<Vec<f64>>,
    pub processed: Arc<Vec<f64>>,
    pub plateau_features: Vec<PlateauFeature>,
    pub statistics: AnalysisStatistics,
    pub used_cached_preprocess: bool,
    pub warnings: Vec<String>,
}
