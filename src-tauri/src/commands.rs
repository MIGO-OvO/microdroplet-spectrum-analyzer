use std::sync::Mutex;

use tauri::State;

use crate::analyzer;
use crate::data;
use crate::export;
use crate::models::{
    AnalysisRequest, AnalysisResponse, Dataset, DatasetSummary, ExportRequest, ExportResponse,
    FileInspection, FullAnalysisResult, InspectFileRequest, LoadDataRequest, ParameterSuggestion,
    PreprocessCache, SuggestionRequest,
};

#[derive(Default)]
struct SessionState {
    next_revision: u64,
    analysis_generation: u64,
    dataset: Option<Dataset>,
    preprocess_cache: Option<PreprocessCache>,
    last_result: Option<FullAnalysisResult>,
}

#[derive(Default)]
pub struct AppState {
    session: Mutex<SessionState>,
}

fn join_error(error: impl std::fmt::Display) -> String {
    format!("后台任务未能完成：{error}")
}

#[tauri::command]
pub async fn inspect_data_file(request: InspectFileRequest) -> Result<FileInspection, String> {
    tauri::async_runtime::spawn_blocking(move || data::inspect(&request.path))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn load_data_file(
    state: State<'_, AppState>,
    request: LoadDataRequest,
) -> Result<DatasetSummary, String> {
    let revision = {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
        session.next_revision = session.next_revision.wrapping_add(1).max(1);
        session.next_revision
    };
    let dataset = tauri::async_runtime::spawn_blocking(move || data::load(&request, revision))
        .await
        .map_err(join_error)??;
    let summary = data::summary(&dataset);
    let mut session = state
        .session
        .lock()
        .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
    session.dataset = Some(dataset);
    session.preprocess_cache = None;
    session.last_result = None;
    Ok(summary)
}

#[tauri::command]
pub async fn analyze_signal(
    state: State<'_, AppState>,
    request: AnalysisRequest,
) -> Result<AnalysisResponse, String> {
    let (dataset, cache, generation) = {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
        session.analysis_generation += 1;
        (
            session
                .dataset
                .clone()
                .ok_or_else(|| "请先加载数据文件。".to_owned())?,
            session.preprocess_cache.clone(),
            session.analysis_generation,
        )
    };
    let revision = dataset.revision;
    let (mut result, updated_cache) = tauri::async_runtime::spawn_blocking(move || {
        analyzer::analyze_dataset(&dataset, &request, cache.as_ref())
    })
    .await
    .map_err(join_error)?;
    result.result_id = generation;
    let response = analyzer::response_from_result(&result);
    let mut session = state
        .session
        .lock()
        .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
    if session.analysis_generation != generation
        || session.dataset.as_ref().map(|data| data.revision) != Some(revision)
    {
        return Err("分析期间数据文件已更新，请重新运行分析。".into());
    }
    session.preprocess_cache = Some(updated_cache);
    session.last_result = Some(result);
    Ok(response)
}

#[tauri::command]
pub async fn suggest_plateau_parameters(
    state: State<'_, AppState>,
    request: SuggestionRequest,
) -> Result<ParameterSuggestion, String> {
    let signal = {
        let session = state
            .session
            .lock()
            .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
        session
            .dataset
            .as_ref()
            .map(|dataset| dataset.signal.clone())
            .ok_or_else(|| "请先加载数据文件。".to_owned())?
    };
    tauri::async_runtime::spawn_blocking(move || {
        analyzer::suggest_plateau_parameters(&signal, &request.preprocess)
    })
    .await
    .map_err(join_error)
}

/// Separate suggestion entry point: the droplet derivation is driven by the
/// two-state separation and the stable-run lengths, so it cannot reuse the
/// baseline + positive-platform heuristics of the plateau mode.
#[tauri::command]
pub async fn suggest_droplet_parameters(
    state: State<'_, AppState>,
    request: SuggestionRequest,
) -> Result<ParameterSuggestion, String> {
    let signal = {
        let session = state
            .session
            .lock()
            .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
        session
            .dataset
            .as_ref()
            .map(|dataset| dataset.signal.clone())
            .ok_or_else(|| "请先加载数据文件。".to_owned())?
    };
    tauri::async_runtime::spawn_blocking(move || {
        analyzer::suggest_droplet_parameters(&signal, &request.preprocess)
    })
    .await
    .map_err(join_error)
}

#[tauri::command]
pub async fn export_results(
    state: State<'_, AppState>,
    request: ExportRequest,
) -> Result<ExportResponse, String> {
    let result = {
        let session = state
            .session
            .lock()
            .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
        session
            .last_result
            .clone()
            .ok_or_else(|| "当前没有可导出的分析结果。".to_owned())?
    };
    let path = request.path;
    let export_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || export::export_results(&result, &export_path))
        .await
        .map_err(join_error)??;
    Ok(ExportResponse { path })
}

#[tauri::command]
pub async fn export_chart(
    state: State<'_, AppState>,
    request: ExportRequest,
) -> Result<ExportResponse, String> {
    let result = {
        let session = state
            .session
            .lock()
            .map_err(|_| "数据会话已损坏，请重新启动应用。".to_owned())?;
        session
            .last_result
            .clone()
            .ok_or_else(|| "当前没有可导出的分析结果。".to_owned())?
    };
    let path = request.path;
    let export_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || export::export_chart(&result, &export_path))
        .await
        .map_err(join_error)??;
    Ok(ExportResponse { path })
}

#[tauri::command]
pub async fn plot_view(
    state: State<'_, AppState>,
    result_id: u64,
    x_min: f64,
    x_max: f64,
) -> Result<crate::models::PlotSeries, String> {
    let (x, original, processed) = {
        let session = state
            .session
            .lock()
            .map_err(|_| "数据会话不可用。".to_owned())?;
        let result = session
            .last_result
            .as_ref()
            .filter(|result| result.result_id == result_id)
            .ok_or_else(|| "分析结果已更新，请重试。".to_owned())?;
        (
            result.x.clone(),
            result.original.clone(),
            result.processed.clone(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        analyzer::plot_view(&x, &original, &processed, x_min, x_max)
    })
    .await
    .map_err(join_error)?
}
