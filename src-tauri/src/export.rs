use std::path::Path;

use plotters::coord::Shift;
use plotters::prelude::*;
use rust_xlsxwriter::Workbook;

use crate::models::{AnalysisMode, FullAnalysisResult};

fn excel_error(error: impl std::fmt::Display) -> String {
    format!("无法写入 Excel 文件：{error}")
}

pub fn export_results(result: &FullAnalysisResult, path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    match result.request.mode {
        AnalysisMode::Plateau => {
            let headers = [
                "平台 #",
                "中心位置",
                "起始点",
                "结束点",
                "高度(精炼)",
                "长度",
            ];
            for (column, header) in headers.iter().enumerate() {
                worksheet
                    .write_string(0, column as u16, *header)
                    .map_err(excel_error)?;
            }
            for (row, feature) in result.plateau_features.iter().enumerate() {
                let row = row as u32 + 1;
                worksheet
                    .write_number(row, 0, feature.number as f64)
                    .map_err(excel_error)?;
                worksheet
                    .write_number(row, 1, feature.center)
                    .map_err(excel_error)?;
                worksheet
                    .write_number(row, 2, feature.start)
                    .map_err(excel_error)?;
                worksheet
                    .write_number(row, 3, feature.end)
                    .map_err(excel_error)?;
                worksheet
                    .write_number(row, 4, feature.height)
                    .map_err(excel_error)?;
                worksheet
                    .write_number(row, 5, feature.length as f64)
                    .map_err(excel_error)?;
            }
            worksheet.set_column_width(0, 10).map_err(excel_error)?;
            worksheet.set_column_width(1, 16).map_err(excel_error)?;
            worksheet.set_column_width(2, 16).map_err(excel_error)?;
            worksheet.set_column_width(3, 16).map_err(excel_error)?;
            worksheet.set_column_width(4, 18).map_err(excel_error)?;
            worksheet.set_column_width(5, 12).map_err(excel_error)?;
        }
    }

    workbook.save(path).map_err(excel_error)
}

fn chart_indices(length: usize, limit: usize) -> Vec<usize> {
    if length <= limit {
        return (0..length).collect();
    }
    let step = length as f64 / limit as f64;
    let mut indices: Vec<usize> = (0..limit)
        .map(|index| (index as f64 * step).floor() as usize)
        .collect();
    indices.push(length - 1);
    indices.sort_unstable();
    indices.dedup();
    indices
}

fn finite_bounds(values: impl Iterator<Item = f64>) -> Option<(f64, f64)> {
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    for value in values.filter(|value| value.is_finite()) {
        minimum = minimum.min(value);
        maximum = maximum.max(value);
    }
    minimum.is_finite().then_some((minimum, maximum))
}

fn draw_chart<DB: DrawingBackend>(
    root: DrawingArea<DB, Shift>,
    result: &FullAnalysisResult,
) -> Result<(), String>
where
    DB::ErrorType: std::fmt::Debug,
{
    root.fill(&WHITE)
        .map_err(|error| format!("无法初始化图表：{error:?}"))?;
    let (mut x_min, mut x_max) = finite_bounds(result.x.iter().copied()).unwrap_or((0.0, 1.0));
    let (mut y_min, mut y_max) = finite_bounds(
        result
            .original
            .iter()
            .copied()
            .chain(result.processed.iter().copied()),
    )
    .unwrap_or((0.0, 1.0));
    if (x_max - x_min).abs() < f64::EPSILON {
        x_min -= 0.5;
        x_max += 0.5;
    }
    if (y_max - y_min).abs() < f64::EPSILON {
        y_min -= 0.5;
        y_max += 0.5;
    } else {
        let padding = (y_max - y_min) * 0.08;
        y_min -= padding;
        y_max += padding;
    }

    let title = match result.request.mode {
        AnalysisMode::Plateau => "Microdroplet Spectrum Analysis — Plateau Detection",
    };
    let mut chart = ChartBuilder::on(&root)
        .caption(title, ("sans-serif", 30))
        .margin(28)
        .x_label_area_size(48)
        .y_label_area_size(64)
        .build_cartesian_2d(x_min..x_max, y_min..y_max)
        .map_err(|error| format!("无法创建图表坐标系：{error:?}"))?;
    chart
        .configure_mesh()
        .x_desc(if result.has_real_time {
            "Time"
        } else {
            "Data point"
        })
        .y_desc("Signal intensity")
        .light_line_style(RGBColor(220, 227, 232))
        .axis_style(RGBColor(88, 104, 115))
        .draw()
        .map_err(|error| format!("无法绘制图表网格：{error:?}"))?;

    if result.request.mode == AnalysisMode::Plateau {
        chart
            .draw_series(std::iter::once(Rectangle::new(
                [
                    (x_min, result.request.plateau.threshold_low),
                    (x_max, result.request.plateau.threshold_high),
                ],
                RGBAColor(214, 144, 39, 0.08).filled(),
            )))
            .map_err(|error| format!("无法绘制检测区间：{error:?}"))?;
    }

    let indices = chart_indices(result.original.len(), 50_000);
    chart
        .draw_series(LineSeries::new(
            indices
                .iter()
                .map(|index| (result.x[*index], result.original[*index])),
            RGBColor(151, 165, 174),
        ))
        .map_err(|error| format!("无法绘制原始信号：{error:?}"))?
        .label("Original signal")
        .legend(|(x, y)| PathElement::new([(x, y), (x + 24, y)], RGBColor(151, 165, 174)));
    chart
        .draw_series(LineSeries::new(
            indices
                .iter()
                .map(|index| (result.x[*index], result.processed[*index])),
            RGBColor(20, 125, 154),
        ))
        .map_err(|error| format!("无法绘制处理后信号：{error:?}"))?
        .label("Processed signal")
        .legend(|(x, y)| PathElement::new([(x, y), (x + 24, y)], RGBColor(20, 125, 154)));

    match result.request.mode {
        AnalysisMode::Plateau => {
            chart
                .draw_series(result.plateau_features.iter().map(|feature| {
                    Circle::new(
                        (feature.center, feature.height),
                        5,
                        RGBColor(214, 144, 39).filled(),
                    )
                }))
                .map_err(|error| format!("无法绘制平台标记：{error:?}"))?;
        }
    }

    chart
        .configure_series_labels()
        .background_style(WHITE.mix(0.92))
        .border_style(RGBColor(194, 204, 211))
        .position(SeriesLabelPosition::UpperRight)
        .draw()
        .map_err(|error| format!("无法绘制图例：{error:?}"))?;
    root.present()
        .map_err(|error| format!("无法完成图表导出：{error:?}"))
}

pub fn export_chart(result: &FullAnalysisResult, path: &str) -> Result<(), String> {
    let path_object = Path::new(path);
    match path_object
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => draw_chart(
            BitMapBackend::new(path, (1800, 1050)).into_drawing_area(),
            result,
        ),
        "svg" => draw_chart(
            SVGBackend::new(path, (1800, 1050)).into_drawing_area(),
            result,
        ),
        _ => Err("图表仅支持导出为 PNG 或 SVG。".into()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::tempdir;

    use crate::analyzer::analyze_dataset;
    use crate::models::{AnalysisRequest, Dataset};

    use super::*;

    #[test]
    fn result_workbook_and_both_chart_formats_are_written() {
        let directory = tempdir().expect("temporary export directory");
        let mut signal = vec![0.0; 20];
        signal.extend(vec![0.3; 15]);
        signal.extend(vec![0.0; 20]);
        let dataset = Dataset {
            revision: 1,
            file_name: "fixture.csv".into(),
            columns: Vec::new(),
            signal: Arc::new(signal),
            time: None,
            dropped_rows: 0,
        };
        let (result, _) = analyze_dataset(&dataset, &AnalysisRequest::default(), None);
        let workbook = directory.path().join("results.xlsx");
        let png = directory.path().join("chart.png");
        let svg = directory.path().join("chart.svg");

        export_results(&result, workbook.to_str().unwrap()).expect("Excel export");
        export_chart(&result, png.to_str().unwrap()).expect("PNG export");
        export_chart(&result, svg.to_str().unwrap()).expect("SVG export");

        for path in [workbook, png, svg] {
            assert!(path.metadata().expect("export metadata").len() > 100);
        }
    }
}
