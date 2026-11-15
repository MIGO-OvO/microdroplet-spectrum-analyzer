use std::{fs::File, io::Write, path::Path};

use plotters::coord::Shift;
use plotters::prelude::*;
use rust_xlsxwriter::Workbook;

use crate::models::{
    AnalysisMode, DropletMeasurement, FullAnalysisResult, SegmentKind, StableSegment,
};

fn excel_error(error: impl std::fmt::Display) -> String {
    format!("无法写入 Excel 文件：{error}")
}

/// Missing values must never be exported as `0`: an absent Platform and a Platform
/// measured at zero are different facts.
const MISSING: &str = "—";

fn reference_label(measurement: &DropletMeasurement) -> String {
    measurement.reference_mode.label().to_owned()
}

fn quality_label(measurement: &DropletMeasurement) -> String {
    if measurement.quality_flags.is_empty() {
        return String::new();
    }
    measurement
        .quality_flags
        .iter()
        .map(|flag| flag.label())
        .collect::<Vec<_>>()
        .join(", ")
}

fn write_optional(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    column: u16,
    value: Option<f64>,
) -> Result<(), String> {
    match value {
        Some(number) if number.is_finite() => worksheet
            .write_number(row, column, number)
            .map(|_| ())
            .map_err(excel_error),
        _ => worksheet
            .write_string(row, column, MISSING)
            .map(|_| ())
            .map_err(excel_error),
    }
}

fn write_headers(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    headers: &[&str],
) -> Result<(), String> {
    for (column, header) in headers.iter().enumerate() {
        worksheet
            .write_string(0, column as u16, *header)
            .map_err(excel_error)?;
    }
    Ok(())
}

fn set_widths(worksheet: &mut rust_xlsxwriter::Worksheet, widths: &[f64]) -> Result<(), String> {
    for (column, width) in widths.iter().enumerate() {
        worksheet
            .set_column_width(column as u16, *width)
            .map_err(excel_error)?;
    }
    Ok(())
}

/// Final droplet measurements: one row per high, with exact low-reference levels
/// that produced each corrected Δ.
fn export_droplet_results(
    workbook: &mut Workbook,
    measurements: &[DropletMeasurement],
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Droplet Results").map_err(excel_error)?;
    let headers = [
        "液滴 #",
        "中心位置",
        "高平台实测值",
        "左低平台电平",
        "右低平台电平",
        "低平台基线（高平台中心）",
        "Corrected ΔSignal",
        "Reference Mode",
        "规则评分（非准确率）",
        "Quality Flags",
        "高平台 ID",
        "左低平台 ID",
        "右低平台 ID",
    ];
    write_headers(worksheet, &headers)?;
    for (row, measurement) in measurements.iter().enumerate() {
        let row = row as u32 + 1;
        worksheet
            .write_number(row, 0, measurement.number as f64)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 1, measurement.center)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 2, measurement.high_level)
            .map_err(excel_error)?;
        write_optional(worksheet, row, 3, measurement.left_low_level)?;
        write_optional(worksheet, row, 4, measurement.right_low_level)?;
        worksheet
            .write_number(row, 5, measurement.baseline_reference)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 6, measurement.corrected_signal)
            .map_err(excel_error)?;
        worksheet
            .write_string(row, 7, reference_label(measurement))
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 8, measurement.confidence)
            .map_err(excel_error)?;
        worksheet
            .write_string(row, 9, quality_label(measurement))
            .map_err(excel_error)?;
        worksheet
            .write_string(row, 10, format!("H{}", measurement.high_segment))
            .map_err(excel_error)?;
        for (column, id) in [
            (11, measurement.left_low_segment),
            (12, measurement.right_low_segment),
        ] {
            worksheet
                .write_string(
                    row,
                    column,
                    id.map_or_else(|| MISSING.to_owned(), |n| format!("L{n}")),
                )
                .map_err(excel_error)?;
        }
    }
    set_widths(
        worksheet,
        &[
            9.0, 14.0, 18.0, 18.0, 18.0, 30.0, 20.0, 16.0, 25.0, 42.0, 14.0, 14.0, 14.0,
        ],
    )
}

/// Algorithmic evidence: why each segment was classified the way it was.
fn export_stable_segments(
    workbook: &mut Workbook,
    segments: &[StableSegment],
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Stable Segments").map_err(excel_error)?;
    let headers = [
        "区段 #",
        "类型",
        "起始点",
        "中心位置",
        "结束点",
        "电平(原始信号)",
        "长度",
        "有效长度",
        "标准差",
        "MAD",
        "斜率",
        "规则评分（非准确率）",
        "区段 ID",
    ];
    write_headers(worksheet, &headers)?;
    for (row, segment) in segments.iter().enumerate() {
        let row = row as u32 + 1;
        worksheet
            .write_number(row, 0, segment.number as f64)
            .map_err(excel_error)?;
        worksheet
            .write_string(row, 1, segment.kind.label())
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 2, segment.start)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 3, segment.center)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 4, segment.end)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 5, segment.level)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 6, segment.length as f64)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 7, segment.effective_length as f64)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 8, segment.standard_deviation)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 9, segment.mad)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 10, segment.slope)
            .map_err(excel_error)?;
        worksheet
            .write_number(row, 11, segment.confidence)
            .map_err(excel_error)?;
        let prefix = match segment.kind {
            SegmentKind::Platform => "H",
            SegmentKind::Bottom => "L",
            SegmentKind::Unknown => "U",
        };
        worksheet
            .write_string(row, 12, format!("{prefix}{}", segment.number))
            .map_err(excel_error)?;
    }
    set_widths(
        worksheet,
        &[
            8.0, 12.0, 12.0, 14.0, 12.0, 18.0, 9.0, 10.0, 14.0, 14.0, 13.0, 11.0,
        ],
    )
}

/// Export every sample from the analysis snapshot, before display decimation.
pub fn export_waveform(result: &FullAnalysisResult, path: &str) -> Result<(), String> {
    if !Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
    {
        return Err("波形数据请保存为 .csv 文件。".into());
    }
    let csv_error = |error: csv::Error| format!("无法写入波形 CSV：{error}");
    let mut file = File::create(path).map_err(|error| format!("无法创建波形 CSV：{error}"))?;
    file.write_all(b"\xEF\xBB\xBF")
        .map_err(|error| format!("无法写入波形 CSV：{error}"))?;
    let mut writer = csv::Writer::from_writer(file);
    writer
        .write_record([
            if result.has_real_time {
                "time"
            } else {
                "sample_index"
            },
            "original_signal",
            "processed_signal",
        ])
        .map_err(csv_error)?;
    for index in 0..result.x.len() {
        writer
            .serialize((
                result.x[index],
                result.original[index],
                result.processed[index],
            ))
            .map_err(csv_error)?;
    }
    writer
        .flush()
        .map_err(|error| format!("无法写入波形 CSV：{error}"))
}

pub fn export_results(result: &FullAnalysisResult, path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();

    match result.request.mode {
        AnalysisMode::Plateau => {
            // The legacy branch keeps the default single worksheet and its exact
            // column layout so older workbooks stay byte-comparable in structure.
            let worksheet = workbook.add_worksheet();
            let headers = [
                "平台 #",
                "中心位置",
                "起始点",
                "结束点",
                "高度(精炼)",
                "长度",
            ];
            write_headers(worksheet, &headers)?;
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
            set_widths(worksheet, &[10.0, 16.0, 16.0, 16.0, 18.0, 12.0])?;
        }
        AnalysisMode::Droplet => {
            export_droplet_results(&mut workbook, &result.droplet_measurements)?;
            export_stable_segments(&mut workbook, &result.stable_segments)?;
        }
    }

    let statistics = workbook.add_worksheet();
    statistics.set_name("Statistics").map_err(excel_error)?;
    write_headers(statistics, &["统计量", "数值"])?;
    let length_mean = match result.request.mode {
        AnalysisMode::Droplet => result.droplet_statistics.mean_length,
        AnalysisMode::Plateau => result.statistics.mean_length,
    };
    let length_sd = match result.request.mode {
        AnalysisMode::Droplet => result.droplet_statistics.length_standard_deviation,
        AnalysisMode::Plateau => result.statistics.length_standard_deviation,
    };
    let length_rsd = length_mean
        .filter(|average| *average > 0.0)
        .zip(length_sd)
        .map(|(average, deviation)| deviation / average * 100.0);
    for (index, (label, value)) in [
        ("平均高平台长度（点）", length_mean),
        ("高平台长度标准差（点，总体）", length_sd),
        ("高平台长度 RSD (%)", length_rsd),
    ]
    .into_iter()
    .enumerate()
    {
        statistics
            .write_string(index as u32 + 1, 0, label)
            .map_err(excel_error)?;
        write_optional(statistics, index as u32 + 1, 1, value)?;
    }
    statistics
        .write_string(4, 0, "统计范围")
        .map_err(excel_error)?;
    statistics
        .write_string(
            4,
            1,
            "全部已分类高平台，含未形成液滴测量的平台；长度为检测范围点数",
        )
        .map_err(excel_error)?;
    set_widths(statistics, &[34.0, 78.0])?;

    let metadata = workbook.add_worksheet();
    metadata
        .set_name("Analysis Parameters")
        .map_err(excel_error)?;
    metadata
        .write_string(0, 0, "Processing parameters (JSON)")
        .map_err(excel_error)?;
    metadata
        .write_string(
            0,
            1,
            serde_json::to_string(&result.request).map_err(|e| e.to_string())?,
        )
        .map_err(excel_error)?;
    metadata.write_string(1, 0, "X axis").map_err(excel_error)?;
    metadata
        .write_string(
            1,
            1,
            if result.has_real_time {
                "Time column"
            } else {
                "Zero-based valid sample index"
            },
        )
        .map_err(excel_error)?;
    if result.request.mode == AnalysisMode::Droplet {
        metadata
            .write_string(2, 0, "Response definition")
            .map_err(excel_error)?;
        metadata
            .write_string(
                2,
                1,
                "highMinusLowBaselineV1: high raw level - low baseline at high center",
            )
            .map_err(excel_error)?;
        metadata
            .write_string(3, 0, "Score interpretation")
            .map_err(excel_error)?;
        metadata
            .write_string(
                3,
                1,
                "Heuristic, not accuracy. Manual-band segment score starts at 1.",
            )
            .map_err(excel_error)?;
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
    if result.request.mode == AnalysisMode::Droplet
        && let Some(bands) = &result.request.droplet.amplitude_bands
    {
        y_min = y_min.min(bands.low_min);
        y_max = y_max.max(bands.high_max);
    }
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
        AnalysisMode::Droplet => "Microdroplet Spectrum Analysis — Dual-State Droplet Δ",
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
    if result.request.mode == AnalysisMode::Droplet
        && let Some(bands) = &result.request.droplet.amplitude_bands
    {
        for (lower, upper, color) in [
            (bands.low_min, bands.low_max, RGBColor(22, 104, 193)),
            (bands.high_min, bands.high_max, RGBColor(36, 134, 106)),
        ] {
            chart
                .draw_series(std::iter::once(Rectangle::new(
                    [(x_min, lower), (x_max, upper)],
                    color.mix(0.07).filled(),
                )))
                .map_err(|error| format!("无法绘制幅度区间：{error:?}"))?;
            for value in [lower, upper] {
                chart
                    .draw_series(LineSeries::new(
                        [(x_min, value), (x_max, value)],
                        color.mix(0.5),
                    ))
                    .map_err(|error| format!("无法绘制幅度边界：{error:?}"))?;
            }
        }
    }
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
        .label(if result.request.mode == AnalysisMode::Droplet {
            "Detection signal"
        } else {
            "Processed signal"
        })
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
        AnalysisMode::Droplet => {
            // One marker per stable segment, coloured by the classified state, plus a
            // Evidence markers for both states, plus high-centered delta lines.
            let platform: Vec<(f64, f64)> = result
                .stable_segments
                .iter()
                .filter(|segment| segment.kind == SegmentKind::Platform)
                .map(|segment| (segment.center, segment.level))
                .collect();
            let bottom: Vec<(f64, f64)> = result
                .stable_segments
                .iter()
                .filter(|segment| segment.kind == SegmentKind::Bottom)
                .map(|segment| (segment.center, segment.level))
                .collect();
            let unknown: Vec<(f64, f64)> = result
                .stable_segments
                .iter()
                .filter(|segment| segment.kind == SegmentKind::Unknown)
                .map(|segment| (segment.center, segment.level))
                .collect();
            for (label, color, points) in [
                ("High (H)", RGBColor(36, 134, 106), platform),
                ("Low baseline (L)", RGBColor(20, 125, 154), bottom),
                ("Unknown", RGBColor(182, 114, 22), unknown),
            ] {
                if points.is_empty() {
                    continue;
                }
                chart
                    .draw_series(
                        points
                            .iter()
                            .map(|(x, y)| Circle::new((*x, *y), 4, color.filled())),
                    )
                    .map_err(|error| format!("无法绘制稳定区段标记：{error:?}"))?
                    .label(label)
                    .legend(move |(x, y)| Circle::new((x + 12, y), 4, color.filled()));
            }
            chart
                .draw_series(result.droplet_measurements.iter().map(|measurement| {
                    Circle::new(
                        (measurement.center, measurement.high_level),
                        7,
                        RGBColor(217, 76, 61).stroke_width(2),
                    )
                }))
                .map_err(|error| format!("无法绘制液滴标记：{error:?}"))?
                .label("High measurement (H)")
                .legend(|(x, y)| {
                    Circle::new((x + 12, y), 7, RGBColor(217, 76, 61).stroke_width(2))
                });
            chart
                .draw_series(result.droplet_measurements.iter().map(|m| {
                    PathElement::new(
                        vec![(m.center, m.high_level), (m.center, m.baseline_reference)],
                        RGBColor(162, 64, 122).stroke_width(2),
                    )
                }))
                .map_err(|error| format!("无法绘制高平台基线差：{error:?}"))?;
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
    use crate::models::{AnalysisMode, AnalysisRequest, Dataset, DropletParams, PreprocessParams};

    use super::*;

    fn fixture_dataset(signal: Vec<f64>) -> Dataset {
        Dataset {
            revision: 1,
            file_name: "fixture.csv".into(),
            columns: Vec::new(),
            signal: Arc::new(signal),
            time: None,
            dropped_rows: 0,
        }
    }

    #[test]
    fn waveform_csv_keeps_every_processed_sample_and_the_original_selected_coordinates() {
        use crate::analyzer::response_from_result;
        use crate::models::XRange;

        let directory = tempdir().unwrap();
        for real_time in [false, true] {
            let mut dataset = fixture_dataset(
                (0..15_030)
                    .map(|i| {
                        (i as f64 * 0.12).sin() * 0.001 + if i % 500 < 200 { 0.3 } else { 0.0 }
                    })
                    .collect(),
            );
            if real_time {
                dataset.time = Some(Arc::new(
                    (0..15_030).map(|i| 3.0 + i as f64 * 0.25).collect(),
                ));
            }
            let x = |i: usize| {
                if real_time {
                    3.0 + i as f64 * 0.25
                } else {
                    i as f64
                }
            };
            let request = AnalysisRequest {
                x_range: Some(XRange {
                    min: Some(x(100)),
                    max: Some(x(14_900)),
                }),
                ..AnalysisRequest::default()
            };
            let (result, _) = analyze_dataset(&dataset, &request, None);
            assert_eq!(result.x.len(), 14_801);
            assert!(response_from_result(&result).plot.x.len() < result.x.len());
            assert_ne!(result.original, result.processed);
            let path = directory.path().join(format!("waveform-{real_time}.csv"));
            export_waveform(&result, path.to_str().unwrap()).unwrap();
            assert!(std::fs::read(&path).unwrap().starts_with(b"\xEF\xBB\xBF"));
            let mut reader = csv::Reader::from_path(&path).unwrap();
            assert_eq!(
                reader.headers().unwrap().get(0),
                Some(if real_time { "time" } else { "sample_index" })
            );
            assert_eq!(reader.headers().unwrap().get(2), Some("processed_signal"));
            let rows: Vec<_> = reader
                .deserialize::<(f64, f64, f64)>()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(rows.len(), result.x.len());
            for (index, row) in rows.iter().enumerate() {
                assert_eq!(
                    *row,
                    (
                        result.x[index],
                        result.original[index],
                        result.processed[index]
                    )
                );
            }
            assert_eq!(rows.first().unwrap().0, x(100));
            assert_eq!(rows.last().unwrap().0, x(14_900));
            assert!(
                export_waveform(
                    &result,
                    directory.path().join("missing/out.csv").to_str().unwrap()
                )
                .is_err()
            );
            assert!(
                export_waveform(
                    &result,
                    directory.path().join("waveform.xlsx").to_str().unwrap()
                )
                .is_err()
            );
            assert!(!directory.path().join("waveform.xlsx").exists());
        }
    }

    #[test]
    fn result_workbook_and_both_chart_formats_are_written() {
        let directory = tempdir().expect("temporary export directory");
        let mut signal = vec![0.0; 20];
        signal.extend(vec![0.3; 15]);
        signal.extend(vec![0.0; 20]);
        let dataset = fixture_dataset(signal);
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

    #[test]
    fn droplet_export_writes_measurements_and_segment_evidence() {
        let directory = tempdir().expect("temporary export directory");
        // Two asymmetric states repeated three times: Platform / Bottom alternating.
        let mut signal = Vec::new();
        for _ in 0..3 {
            signal.extend(vec![0.0348; 120]);
            signal.extend(vec![0.0006169; 60]);
        }
        signal.extend(vec![0.0348; 120]);
        let dataset = fixture_dataset(signal);
        let request = AnalysisRequest {
            mode: AnalysisMode::Droplet,
            preprocess: PreprocessParams {
                smooth_window: 5,
                smooth_order: 3,
                clipping_percentile: 100.0,
                ..PreprocessParams::default()
            },
            droplet: DropletParams {
                amplitude_bands: None,
                stability_window: 5,
                min_segment_length: 3,
                ..DropletParams::default()
            },
            ..AnalysisRequest::default()
        };
        let (result, _) = analyze_dataset(&dataset, &request, None);
        assert!(
            !result.droplet_measurements.is_empty(),
            "fixture must produce droplets: {:?}",
            result.warnings
        );
        assert!(!result.stable_segments.is_empty());

        let workbook = directory.path().join("droplets.xlsx");
        let png = directory.path().join("droplets.png");
        let svg = directory.path().join("droplets.svg");
        export_results(&result, workbook.to_str().unwrap()).expect("droplet Excel export");
        export_chart(&result, png.to_str().unwrap()).expect("droplet PNG export");
        export_chart(&result, svg.to_str().unwrap()).expect("droplet SVG export");
        for path in [workbook, png, svg] {
            assert!(path.metadata().expect("export metadata").len() > 100);
        }

        // A ZIP stores entry names uncompressed, so the second worksheet's part name
        // is directly visible: the segment-evidence sheet really was written.
        let raw = std::fs::read(directory.path().join("droplets.xlsx")).expect("workbook bytes");
        let text = String::from_utf8_lossy(&raw);
        assert!(text.contains("xl/worksheets/sheet1.xml"));
        assert!(text.contains("xl/worksheets/sheet2.xml"));
        // Read the workbook back: columns must encode the new physics and exact IDs.
        use calamine::{Data, Reader, open_workbook_auto};
        let mut book = open_workbook_auto(directory.path().join("droplets.xlsx")).unwrap();
        let sheet = book.worksheet_range("Droplet Results").unwrap();
        assert_eq!(
            sheet.get_value((0, 2)),
            Some(&Data::String("高平台实测值".into()))
        );
        assert_eq!(
            sheet.get_value((0, 5)),
            Some(&Data::String("低平台基线（高平台中心）".into()))
        );
        for (i, m) in result.droplet_measurements.iter().enumerate() {
            let row = i as u32 + 1;
            assert_eq!(sheet.get_value((row, 2)), Some(&Data::Float(m.high_level)));
            assert_eq!(
                sheet.get_value((row, 5)),
                Some(&Data::Float(m.baseline_reference))
            );
            assert_eq!(
                sheet.get_value((row, 6)),
                Some(&Data::Float(m.corrected_signal))
            );
            assert_eq!(
                sheet.get_value((row, 10)),
                Some(&Data::String(format!("H{}", m.high_segment)))
            );
            for (column, id) in [(11, m.left_low_segment), (12, m.right_low_segment)] {
                assert_eq!(
                    sheet.get_value((row, column)),
                    Some(&Data::String(
                        id.map_or_else(|| MISSING.to_owned(), |n| format!("L{n}"))
                    ))
                );
            }
        }
        let metadata = book.worksheet_range("Analysis Parameters").unwrap();
        assert!(
            metadata
                .get_value((2, 1))
                .unwrap()
                .to_string()
                .contains("highMinusLowBaselineV1")
        );
        let statistics = book.worksheet_range("Statistics").unwrap();
        assert_eq!(
            statistics.get_value((1, 1)),
            Some(&Data::Float(result.droplet_statistics.mean_length.unwrap()))
        );
        assert_eq!(
            statistics.get_value((2, 1)),
            Some(&Data::Float(
                result.droplet_statistics.length_standard_deviation.unwrap()
            ))
        );
        assert_eq!(
            statistics.get_value((3, 1)),
            Some(&Data::Float(result.droplet_statistics.length_rsd.unwrap()))
        );
    }
}
