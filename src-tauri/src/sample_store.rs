use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    csv_samples::{SampleCoordinates, SampleMetadata},
    models::{AnalysisMode, AnalysisRequest, FullAnalysisResult},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSource {
    pub path: String,
    pub file_name: String,
    pub signal_column: usize,
    pub time_column: Option<usize>,
    pub metadata: Option<SampleMetadata>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurveSnapshot {
    id: String,
    name: String,
    updated_at: String,
    slope: f64,
    intercept: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Concentration {
    value: f64,
    unit: String,
    curve: Option<CurveSnapshot>,
    notices: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSampleRequest {
    pub result_id: u64,
    #[serde(default)]
    pub replace_existing: bool,
    name: String,
    analyte: String,
    concentration: Option<Concentration>,
    manual_coordinates: Option<SampleCoordinates>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleDetails {
    name: String,
    analyte: String,
    source: SampleSource,
    concentration: Option<Concentration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    manual_coordinates: Option<SampleCoordinates>,
    response: Option<f64>,
    detection_count: usize,
    point_count: usize,
    parameters: AnalysisRequest,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplingRecord {
    id: i64,
    saved_at: String,
    #[serde(flatten)]
    details: SampleDetails,
}

impl SampleDetails {
    pub fn from_analysis(
        request: SaveSampleRequest,
        source: SampleSource,
        result: &FullAnalysisResult,
    ) -> Result<Self, String> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err("请输入采样名称。".into());
        }
        if request
            .manual_coordinates
            .is_some_and(|value| !value.is_valid())
        {
            return Err("纬度须在 −90° 到 90°，经度须在 −180° 到 180°。".into());
        }
        let mut concentration = request.concentration;
        if let Some(value) = &mut concentration {
            value.unit = value.unit.trim().to_owned();
            if !value.value.is_finite() || value.unit.is_empty() {
                return Err("请填写有限的浓度值和单位。".into());
            }
        }
        let (response, detection_count) = match result.request.mode {
            AnalysisMode::Droplet => (
                result.droplet_statistics.mean_corrected_signal,
                result.droplet_statistics.droplet_count,
            ),
            AnalysisMode::Plateau => (
                result.statistics.mean_height,
                result.statistics.feature_count,
            ),
        };
        Ok(Self {
            name: name.to_owned(),
            analyte: request.analyte.trim().to_owned(),
            source,
            concentration,
            manual_coordinates: request.manual_coordinates,
            response,
            detection_count,
            point_count: result.x.len(),
            parameters: result.request.clone(),
            warnings: result.warnings.clone(),
        })
    }
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("samples.sqlite3"))
        .map_err(database_error)
}

fn database_error(error: impl std::fmt::Display) -> String {
    format!("采样数据库操作失败：{error}")
}

fn connect(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(database_error)?;
    }
    let conn = Connection::open(path).map_err(database_error)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(database_error)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sampling_records (
            id INTEGER PRIMARY KEY,
            source_key TEXT NOT NULL UNIQUE,
            saved_at TEXT NOT NULL,
            details TEXT NOT NULL
        );",
    )
    .map_err(database_error)?;
    Ok(conn)
}

fn save_at(
    path: &Path,
    details: SampleDetails,
    replace: bool,
) -> Result<Option<SamplingRecord>, String> {
    let source = &details.source;
    let key = match &source.metadata {
        Some(metadata) if metadata.mission_id.is_some() && metadata.sample_id.is_some() => {
            serde_json::json!(["mission", metadata.mission_id, metadata.sample_id])
        }
        metadata => serde_json::json!([
            "file",
            source.path,
            metadata.as_ref().and_then(|value| value.sample_id.as_ref())
        ]),
    };
    let data = serde_json::to_string(&details).map_err(database_error)?;
    let conn = connect(path)?;
    let row = conn
        .query_row(
            "INSERT INTO sampling_records (source_key, saved_at, details)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?2)
         ON CONFLICT(source_key) DO UPDATE SET saved_at=excluded.saved_at, details=excluded.details WHERE ?3
         RETURNING id, saved_at",
            params![key.to_string(), data, replace],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional().map_err(database_error)?;
    Ok(row.map(|(id, saved_at)| SamplingRecord {
        id,
        saved_at,
        details,
    }))
}

fn list_at(path: &Path) -> Result<Vec<SamplingRecord>, String> {
    let conn = connect(path)?;
    let mut statement = conn
        .prepare(
            "SELECT id, saved_at, details FROM sampling_records ORDER BY saved_at DESC, id DESC",
        )
        .map_err(database_error)?;
    let mut rows = statement.query([]).map_err(database_error)?;
    let mut records = Vec::new();
    while let Some(row) = rows.next().map_err(database_error)? {
        let details: String = row.get(2).map_err(database_error)?;
        records.push(SamplingRecord {
            id: row.get(0).map_err(database_error)?,
            saved_at: row.get(1).map_err(database_error)?,
            details: serde_json::from_str(&details).map_err(database_error)?,
        });
    }
    Ok(records)
}

pub async fn save(
    app: AppHandle,
    details: SampleDetails,
    replace: bool,
) -> Result<Option<SamplingRecord>, String> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_at(&path, details, replace))
        .await
        .map_err(database_error)?
}

#[tauri::command]
pub async fn list_samples(app: AppHandle) -> Result<Vec<SamplingRecord>, String> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || list_at(&path))
        .await
        .map_err(database_error)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail(name: &str, path: &str, sample_id: &str) -> SampleDetails {
        SampleDetails {
            name: name.into(),
            analyte: "nitrite".into(),
            source: SampleSource {
                path: path.into(),
                file_name: "raw.csv".into(),
                signal_column: 3,
                time_column: Some(1),
                metadata: Some(SampleMetadata {
                    sample_id: Some(sample_id.into()),
                    mission_id: Some("mission".into()),
                    latitude: Some(25.1),
                    longitude: Some(110.2),
                    ..SampleMetadata::default()
                }),
            },
            concentration: Some(Concentration {
                value: 1.25,
                unit: "mg/L".into(),
                curve: None,
                notices: Vec::new(),
            }),
            manual_coordinates: None,
            response: Some(0.5),
            detection_count: 12,
            point_count: 180,
            parameters: AnalysisRequest::default(),
            warnings: Vec::new(),
        }
    }

    #[test]
    fn sample_database_keeps_per_window_identity_and_requires_explicit_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("samples.sqlite3");
        let first = save_at(&path, detail("湖心", "raw.csv", "a"), false)
            .unwrap()
            .unwrap();
        assert!(
            save_at(&path, detail("修改", "renamed.csv", "a"), false)
                .unwrap()
                .is_none()
        );
        assert_eq!(list_at(&path).unwrap()[0].details.name, "湖心");
        let coordinates = SampleCoordinates {
            latitude: 24.3,
            longitude: 110.5,
        };
        let mut corrected = detail("更新", "renamed.csv", "a");
        corrected.manual_coordinates = Some(coordinates);
        let updated = save_at(&path, corrected, true).unwrap().unwrap();
        assert_eq!(first.id, updated.id);
        let second = save_at(&path, detail("岸边", "raw.csv", "b"), false)
            .unwrap()
            .unwrap();
        assert_ne!(first.id, second.id);
        let records = list_at(&path).unwrap();
        assert_eq!(records.len(), 2);
        let updated = records.iter().find(|record| record.id == first.id).unwrap();
        assert_eq!(updated.details.name, "更新");
        assert_eq!(updated.details.manual_coordinates, Some(coordinates));
        assert_eq!(
            updated.details.source.metadata.as_ref().unwrap().latitude,
            Some(25.1)
        );
        assert_eq!(updated.details.concentration.as_ref().unwrap().value, 1.25);
        assert_eq!(
            records
                .iter()
                .find(|record| record.id == second.id)
                .unwrap()
                .details
                .manual_coordinates,
            None
        );
    }
}
