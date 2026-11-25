use crate::csv_samples::{SampleColumns, SampleGroups, SampleMetadata, find_column};
use crate::models::{ColumnInfo, Dataset, DatasetSummary, FileInspection, LoadDataRequest};
use calamine::{DataType, Reader, open_workbook_auto};
use std::path::Path;
use std::sync::Arc;

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名数据文件")
        .to_owned()
}

fn columns(headers: impl Iterator<Item = String>) -> Vec<ColumnInfo> {
    let mut columns: Vec<ColumnInfo> = Vec::new();
    for (index, raw) in headers.enumerate() {
        let base = if raw.trim().is_empty() {
            format!("列 {}", index + 1)
        } else {
            raw.trim().to_owned()
        };
        let name = if columns.iter().any(|column| column.name == base) {
            format!("{base} ({})", index + 1)
        } else {
            base
        };
        columns.push(ColumnInfo { index, name });
    }
    columns
}

struct TableInfo {
    columns: Vec<ColumnInfo>,
    count: usize,
    samples: Vec<SampleMetadata>,
}

// Stream CSV records and inspect Excel cells directly: no second table of owned strings.
fn visit_table(
    path: &Path,
    mut visit: impl FnMut(&dyn Fn(usize) -> Option<f64>, Option<&str>),
) -> Result<TableInfo, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut count = 0;
    let mut groups = SampleGroups::default();
    let columns = match extension.as_str() {
        "csv" => {
            let mut reader = csv::ReaderBuilder::new()
                .flexible(true)
                .from_path(path)
                .map_err(|e| format!("无法读取 CSV：{e}"))?;
            let columns = columns(
                reader
                    .headers()
                    .map_err(|e| format!("无法读取表头：{e}"))?
                    .iter()
                    .map(str::to_owned),
            );
            let sample_columns = SampleColumns::find(&columns);
            let mut row = csv::StringRecord::new();
            while reader
                .read_record(&mut row)
                .map_err(|e| format!("CSV 数据行格式错误：{e}"))?
            {
                let sample_key = sample_columns
                    .as_ref()
                    .map(|fields| groups.observe(fields, &row));
                visit(
                    &|index| {
                        row.get(index)
                            .and_then(|value| value.trim().parse::<f64>().ok())
                            .filter(|value| value.is_finite())
                    },
                    sample_key,
                );
                count += 1;
            }
            columns
        }
        "xlsx" | "xls" | "xlsb" | "ods" => {
            let mut workbook =
                open_workbook_auto(path).map_err(|e| format!("无法打开 Excel：{e}"))?;
            let range = workbook
                .worksheet_range_at(0)
                .ok_or("Excel 中没有工作表。")?
                .map_err(|e| format!("无法读取工作表：{e}"))?;
            let mut rows = range.rows();
            let headers = rows.next().ok_or("工作表为空。")?;
            let columns = columns(headers.iter().map(ToString::to_string));
            for row in rows {
                visit(
                    &|index| {
                        row.get(index)
                            .and_then(|value| value.as_f64())
                            .filter(|value| value.is_finite())
                    },
                    None,
                );
                count += 1;
            }
            columns
        }
        _ => return Err("仅支持 CSV、XLS 和 XLSX 数据文件。".into()),
    };
    if columns.is_empty() {
        return Err("数据文件没有可用列。".into());
    }
    Ok(TableInfo {
        columns,
        count,
        samples: groups.samples,
    })
}

pub fn inspect(path: &str) -> Result<FileInspection, String> {
    let path = Path::new(path);
    let TableInfo {
        columns,
        count,
        samples,
    } = visit_table(path, |_, _| {})?;
    let suggested_signal_column = find_column(
        &columns,
        &[
            "voltage",
            "absorbance",
            "original_signal",
            "signal",
            "电压",
            "吸光度",
            "信号",
        ],
    );
    let suggested_time_column = (!samples.is_empty())
        .then(|| {
            find_column(
                &columns,
                &[
                    "source_timestamp_ms",
                    "timestamp_ms",
                    "frame_index",
                    "time",
                    "time_ms",
                    "时间",
                ],
            )
        })
        .flatten();
    Ok(FileInspection {
        file_name: file_name(path),
        row_count: count,
        columns,
        samples,
        suggested_signal_column,
        suggested_time_column,
    })
}

pub fn load(
    request: &LoadDataRequest,
    revision: u64,
) -> Result<(Dataset, Option<SampleMetadata>), String> {
    if request.time_column_index == Some(request.data_column_index) {
        return Err("时间列和信号列不能相同。".into());
    }
    let path = Path::new(&request.path);
    let mut signal = Vec::new();
    let mut time = request.time_column_index.map(|_| Vec::new());
    let mut dropped_rows = 0;
    let selected_key = request.sample_key.as_deref();
    let TableInfo {
        columns,
        mut samples,
        ..
    } = visit_table(path, |cell, sample_key| {
        if selected_key.is_some() && selected_key != sample_key {
            return;
        }
        let value = cell(request.data_column_index);
        let time_value = request.time_column_index.map(cell);
        if value.is_none() || time_value == Some(None) {
            dropped_rows += 1;
            return;
        }
        signal.push(value.unwrap());
        if let (Some(values), Some(Some(t))) = (&mut time, time_value) {
            values.push(t);
        }
    })?;
    let sample = match selected_key {
        Some(key) => Some(
            samples
                .into_iter()
                .find(|sample| sample.key == key)
                .ok_or("CSV 中找不到所选样本，请重新读取文件。")?,
        ),
        None if samples.len() > 1 => return Err("文件含多个样本，请选择一个样本载入。".into()),
        None => samples.pop(),
    };
    if request.data_column_index >= columns.len()
        || request
            .time_column_index
            .is_some_and(|i| i >= columns.len())
    {
        return Err("所选列不存在。".into());
    }
    if signal.is_empty() {
        return Err("所选信号列中没有可分析的数值。".into());
    }
    if time
        .as_ref()
        .is_some_and(|values| values.windows(2).any(|pair| pair[0] > pair[1]))
    {
        return Err("时间列必须单调递增（允许相同时间）；请整理时间顺序或使用数据点横轴。".into());
    }
    Ok((
        Dataset {
            revision,
            file_name: file_name(path),
            columns,
            signal: Arc::new(signal),
            time: time.map(Arc::new),
            dropped_rows,
        },
        sample,
    ))
}

pub fn summary(dataset: &Dataset, sample: Option<SampleMetadata>) -> DatasetSummary {
    DatasetSummary {
        file_name: dataset.file_name.clone(),
        point_count: dataset.signal.len(),
        dropped_rows: dataset.dropped_rows,
        has_real_time: dataset.time.is_some(),
        columns: dataset.columns.clone(),
        sample,
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use tempfile::NamedTempFile;

    use super::*;

    #[test]
    #[ignore = "manual release-mode IO measurement"]
    fn large_csv_benchmark() {
        for count in [200_000, 500_000] {
            let mut file = NamedTempFile::with_suffix(".csv").unwrap();
            {
                let mut writer = std::io::BufWriter::new(&mut file);
                writeln!(writer, "time,signal,unused").unwrap();
                for i in 0..count {
                    writeln!(writer, "{},0.35,experiment", i).unwrap();
                }
            }
            let path = file.path().to_string_lossy().into_owned();
            let start = std::time::Instant::now();
            assert_eq!(inspect(&path).unwrap().row_count, count);
            let inspect_time = start.elapsed();
            let start = std::time::Instant::now();
            let (data, _) = load(
                &LoadDataRequest {
                    path,
                    data_column_index: 1,
                    time_column_index: Some(0),
                    sample_key: None,
                },
                1,
            )
            .unwrap();
            assert_eq!(data.signal.len(), count);
            println!(
                "CSV rows={count} inspect={inspect_time:?} load={:?}",
                start.elapsed()
            );
        }
    }

    #[test]
    fn csv_loading_drops_non_numeric_rows_and_keeps_time_aligned() {
        let mut file = NamedTempFile::with_suffix(".csv").expect("temporary CSV");
        writeln!(file, "time,signal").unwrap();
        writeln!(file, "0,1.0").unwrap();
        writeln!(file, "1,bad").unwrap();
        writeln!(file, "2,3.0").unwrap();
        let request = LoadDataRequest {
            path: file.path().to_string_lossy().into_owned(),
            data_column_index: 1,
            time_column_index: Some(0),
            sample_key: None,
        };
        let (dataset, sample) = load(&request, 1).expect("loaded data");
        assert_eq!(dataset.signal.as_ref(), &[1.0, 3.0]);
        assert_eq!(dataset.time.as_deref(), Some(&vec![0.0, 2.0]));
        assert_eq!(dataset.dropped_rows, 1);
        assert!(sample.is_none());
    }

    #[test]
    fn raw_csv_groups_samples_before_analysis_and_preserves_only_consistent_positions() {
        let mut file = NamedTempFile::with_suffix(".csv").unwrap();
        write!(file, concat!(
            "sample_id,frame_index,source_timestamp_ms,voltage,mission_id,sample_name,sample_started_at,wgs84_lat,wgs84_lng,position_source,simulated,sample_outcome\n",
            "a,0,10,0.25,mission,湖心,2026-11-25T06:00:00Z,25.1,110.2,gps,False,succeeded\n",
            "a,1,20,0.35,mission,湖心,2026-11-25T06:00:00Z,25.1,110.2,gps,False,succeeded\n",
            "b,0,0,0.65,mission,失锁,,, ,web_no_gps,False,succeeded\n",
            "c,0,0,0.45,mission,不一致,,25.2,110.2,gps,False,succeeded\n",
            "c,1,10,0.55,mission,不一致,,25.3,110.2,gps,False,succeeded\n",
        )).unwrap();
        let path = file.path().to_string_lossy().into_owned();
        let inspection = inspect(&path).unwrap();
        assert_eq!(inspection.row_count, 5);
        assert_eq!(inspection.suggested_signal_column, Some(3));
        assert_eq!(inspection.suggested_time_column, Some(2));
        assert_eq!(inspection.samples.len(), 3);
        assert_eq!(inspection.samples[0].sample_name.as_deref(), Some("湖心"));
        assert_eq!(inspection.samples[1].latitude, None);
        assert!(!inspection.samples[1].invalid_position);
        assert!(inspection.samples[2].invalid_position);
        assert_eq!(inspection.samples[2].longitude, None);

        let mut request = LoadDataRequest {
            path,
            data_column_index: 3,
            time_column_index: Some(2),
            sample_key: None,
        };
        assert!(load(&request, 1).unwrap_err().contains("多个样本"));
        request.sample_key = Some(inspection.samples[0].key.clone());
        let (dataset, metadata) = load(&request, 1).unwrap();
        assert_eq!(dataset.signal.as_slice(), &[0.25, 0.35]);
        assert_eq!(dataset.dropped_rows, 0);
        assert_eq!(metadata.unwrap().latitude, Some(25.1));
    }
}
