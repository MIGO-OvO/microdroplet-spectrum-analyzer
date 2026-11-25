use std::collections::HashMap;

use csv::StringRecord;
use serde::{Deserialize, Serialize};

use crate::models::ColumnInfo;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SampleCoordinates {
    pub latitude: f64,
    pub longitude: f64,
}

impl SampleCoordinates {
    pub fn is_valid(&self) -> bool {
        (-90.0..=90.0).contains(&self.latitude) && (-180.0..=180.0).contains(&self.longitude)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleMetadata {
    pub key: String,
    pub sample_id: Option<String>,
    pub mission_id: Option<String>,
    pub sample_name: Option<String>,
    pub started_at: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub position_source: Option<String>,
    pub simulated: bool,
    pub outcome: Option<String>,
    pub invalid_position: bool,
    pub row_count: usize,
}

pub fn find_column(columns: &[ColumnInfo], aliases: &[&str]) -> Option<usize> {
    aliases.iter().find_map(|alias| {
        columns.iter().find_map(|column| {
            column
                .name
                .eq_ignore_ascii_case(alias)
                .then_some(column.index)
        })
    })
}

pub struct SampleColumns {
    sample_id: Option<usize>,
    mission_id: Option<usize>,
    sample_name: Option<usize>,
    started_at: Option<usize>,
    latitude: Option<usize>,
    longitude: Option<usize>,
    position_source: Option<usize>,
    simulated: Option<usize>,
    outcome: Option<usize>,
}

impl SampleColumns {
    pub fn find(columns: &[ColumnInfo]) -> Option<Self> {
        let find = |aliases: &[&str]| find_column(columns, aliases);
        let fields = Self {
            sample_id: find(&["sample_id", "sampleid", "样本编号", "采样编号"]),
            mission_id: find(&["mission_id", "missionid"]),
            sample_name: find(&["sample_name", "samplename", "样本名称", "采样名称"]),
            started_at: find(&[
                "sample_started_at",
                "timestamp_start",
                "start_time",
                "采样时间",
            ]),
            latitude: find(&["wgs84_lat", "latitude", "lat", "纬度"]),
            longitude: find(&["wgs84_lng", "wgs84_lon", "longitude", "lng", "lon", "经度"]),
            position_source: find(&["position_source"]),
            simulated: find(&["simulated"]),
            outcome: find(&["sample_outcome", "outcome"]),
        };
        (fields.sample_id.is_some()
            || fields.latitude.is_some()
            || fields.longitude.is_some()
            || fields.sample_name.is_some())
        .then_some(fields)
    }
}

#[derive(Default)]
pub struct SampleGroups {
    pub samples: Vec<SampleMetadata>,
    indices: HashMap<String, HashMap<String, usize>>,
}

impl SampleGroups {
    pub fn observe(&mut self, fields: &SampleColumns, row: &StringRecord) -> &str {
        let cell = |index: Option<usize>| index.and_then(|i| row.get(i)).unwrap_or("").trim();
        let mission = cell(fields.mission_id);
        let id = cell(fields.sample_id);
        let index = match self.indices.get(mission).and_then(|ids| ids.get(id)) {
            Some(&index) => index,
            None => {
                let index = self.samples.len();
                self.samples.push(SampleMetadata {
                    key: serde_json::json!([mission, id]).to_string(),
                    mission_id: (!mission.is_empty()).then(|| mission.to_owned()),
                    sample_id: (!id.is_empty()).then(|| id.to_owned()),
                    ..SampleMetadata::default()
                });
                self.indices
                    .entry(mission.to_owned())
                    .or_default()
                    .insert(id.to_owned(), index);
                index
            }
        };
        let sample = &mut self.samples[index];
        for (saved, value) in [
            (&mut sample.sample_name, cell(fields.sample_name)),
            (&mut sample.started_at, cell(fields.started_at)),
            (&mut sample.position_source, cell(fields.position_source)),
            (&mut sample.outcome, cell(fields.outcome)),
        ] {
            if saved.is_none() && !value.is_empty() {
                *saved = Some(value.to_owned());
            }
        }
        let simulated = cell(fields.simulated);
        sample.simulated |= simulated == "1"
            || simulated.eq_ignore_ascii_case("true")
            || cell(fields.position_source) == "lab_sim";

        let lat = cell(fields.latitude);
        let lng = cell(fields.longitude);
        if !sample.invalid_position && (!lat.is_empty() || !lng.is_empty()) {
            match (lat.parse::<f64>(), lng.parse::<f64>()) {
                (Ok(lat), Ok(lng))
                    if (SampleCoordinates {
                        latitude: lat,
                        longitude: lng,
                    })
                    .is_valid()
                        && sample
                            .latitude
                            .is_none_or(|value| (lat - value).abs() <= 1e-8)
                        && sample
                            .longitude
                            .is_none_or(|value| (lng - value).abs() <= 1e-8) =>
                {
                    sample.latitude.get_or_insert(lat);
                    sample.longitude.get_or_insert(lng);
                }
                _ => {
                    sample.invalid_position = true;
                    sample.latitude = None;
                    sample.longitude = None;
                }
            }
        }
        sample.row_count += 1;
        &sample.key
    }
}
