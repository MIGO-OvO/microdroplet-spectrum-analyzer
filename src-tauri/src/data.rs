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

// Stream CSV records and inspect Excel cells directly: no second table of owned strings.
fn visit_table(
    path: &Path,
    mut visit: impl FnMut(&dyn Fn(usize) -> Option<f64>),
) -> Result<(Vec<ColumnInfo>, usize), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut count = 0;
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
            let mut row = csv::StringRecord::new();
            while reader
                .read_record(&mut row)
                .map_err(|e| format!("CSV 数据行格式错误：{e}"))?
            {
                visit(&|index| {
                    row.get(index)
                        .and_then(|value| value.trim().parse::<f64>().ok())
                        .filter(|value| value.is_finite())
                });
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
                visit(&|index| {
                    row.get(index)
                        .and_then(|value| value.as_f64())
                        .filter(|value| value.is_finite())
                });
                count += 1;
            }
            columns
        }
        _ => return Err("仅支持 CSV、XLS 和 XLSX 数据文件。".into()),
    };
    if columns.is_empty() {
        return Err("数据文件没有可用列。".into());
    }
    Ok((columns, count))
}

pub fn inspect(path: &str) -> Result<FileInspection, String> {
    let path = Path::new(path);
    let (columns, row_count) = visit_table(path, |_| {})?;
    Ok(FileInspection {
        file_name: file_name(path),
        row_count,
        columns,
    })
}

pub fn load(request: &LoadDataRequest, revision: u64) -> Result<Dataset, String> {
    if request.time_column_index == Some(request.data_column_index) {
        return Err("时间列和信号列不能相同。".into());
    }
    let path = Path::new(&request.path);
    let mut signal = Vec::new();
    let mut time = request.time_column_index.map(|_| Vec::new());
    let mut dropped_rows = 0;
    let (columns, _) = visit_table(path, |cell| {
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
    Ok(Dataset {
        revision,
        file_name: file_name(path),
        columns,
        signal: Arc::new(signal),
        time: time.map(Arc::new),
        dropped_rows,
    })
}

pub fn summary(dataset: &Dataset) -> DatasetSummary {
    DatasetSummary {
        file_name: dataset.file_name.clone(),
        point_count: dataset.signal.len(),
        dropped_rows: dataset.dropped_rows,
        has_real_time: dataset.time.is_some(),
        columns: dataset.columns.clone(),
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
            let data = load(
                &LoadDataRequest {
                    path,
                    data_column_index: 1,
                    time_column_index: Some(0),
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
        };
        let dataset = load(&request, 1).expect("loaded data");
        assert_eq!(dataset.signal.as_ref(), &[1.0, 3.0]);
        assert_eq!(dataset.time.as_deref(), Some(&vec![0.0, 2.0]));
        assert_eq!(dataset.dropped_rows, 1);
    }
}
