//! Dual-platform detection, raw level measurement and local baseline correction.

mod droplet;
mod preprocess;
mod robust;

use std::sync::Arc;

use crate::models::{
    AnalysisMode, AnalysisRequest, AnalysisResponse, AnalysisStatistics, Dataset,
    FullAnalysisResult, PlotSeries, PreprocessCache,
};

pub use droplet::suggest_droplet_parameters;
pub use preprocess::normalize_preprocess_params;

use droplet::{
    build_detection_signal, droplet_detection_key, normalize_droplet_params, run_droplet,
};

const MAX_PREVIEW_POINTS: usize = 12_000;

pub fn normalize_request(request: &AnalysisRequest) -> AnalysisRequest {
    AnalysisRequest {
        x_range: request.x_range.clone(),
        mode: AnalysisMode::Droplet,
        preprocess: normalize_preprocess_params(&request.preprocess),
        plateau: request.plateau.clone(),
        droplet: normalize_droplet_params(&request.droplet),
    }
}

/// Inclusive bounds use the loaded time column, or zero-based valid sample indices.
pub fn selected_range(
    dataset: &Dataset,
    range: Option<&crate::models::XRange>,
) -> Result<(usize, usize), String> {
    let length = dataset.signal.len();
    let Some(range) = range else {
        return Ok((0, length));
    };
    if range
        .min
        .into_iter()
        .chain(range.max)
        .any(|v| !v.is_finite())
        || matches!((range.min, range.max), (Some(a), Some(b)) if a > b)
    {
        return Err("横坐标范围无效：起点必须小于或等于终点，且为有限数值。".into());
    }
    let at = |i: usize| dataset.time.as_ref().map_or(i as f64, |time| time[i]);
    let partition = |bound: f64, inclusive: bool| {
        let (mut lo, mut hi) = (0, length);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if at(mid) < bound || (inclusive && at(mid) == bound) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    };
    let start = range.min.map_or(0, |v| partition(v, false));
    let end = range.max.map_or(length, |v| partition(v, true));
    if end.saturating_sub(start) < 3 {
        return Err("横坐标范围内至少需要 3 个有效数据点。".into());
    }
    Ok((start, end))
}

pub fn validate_request(dataset: &Dataset, request: &AnalysisRequest) -> Result<(), String> {
    selected_range(dataset, request.x_range.as_ref())?;
    if let Some(b) = &request.droplet.amplitude_bands
        && (![b.low_min, b.low_max, b.high_min, b.high_max]
            .iter()
            .all(|v| v.is_finite())
            || b.low_min >= b.low_max
            || b.high_min >= b.high_max
            || b.low_max >= b.high_min)
    {
        return Err("幅度区间无效：每组下限须小于上限，且低平台上限须小于高平台下限。".into());
    }
    Ok(())
}

/// Run one analysis pass.
///
/// The preprocessing cache is keyed by `(dataset revision, preprocess params,
/// selected sample range, detection pipeline)`. Segmentation, classification and measurement parameters
/// are intentionally *not* part of the key: changing them must not force a
/// rebuild of the heavy preprocessing stage.
pub fn analyze_dataset(
    dataset: &Dataset,
    request: &AnalysisRequest,
    cache: Option<&PreprocessCache>,
) -> (FullAnalysisResult, PreprocessCache) {
    let request = normalize_request(request);
    // Command validation rejects invalid input; direct callers receive an empty result below.
    let validation = validate_request(dataset, &request);
    let (start, end) = selected_range(dataset, request.x_range.as_ref()).unwrap_or((0, 0));
    let detection_key = droplet_detection_key(&request.droplet);

    let (processed, noise, scale, used_cached_preprocess) = match cache {
        Some(cache)
            if cache.dataset_revision == dataset.revision
                && cache.params == request.preprocess
                && cache.sample_range == (start, end)
                && cache.detection == detection_key =>
        {
            (Arc::clone(&cache.values), cache.noise, cache.scale, true)
        }
        _ => {
            let detection = build_detection_signal(
                &dataset.signal[start..end],
                &request.preprocess,
                &request.droplet,
            );
            (
                Arc::new(detection.values),
                detection.noise,
                detection.scale,
                false,
            )
        }
    };

    let x = dataset.time.as_ref().map_or_else(
        || Arc::new((start..end).map(|index| index as f64).collect()),
        |time| Arc::new(time[start..end].to_vec()),
    );

    let mut result = FullAnalysisResult {
        result_id: 0,
        request,
        has_real_time: dataset.time.is_some(),
        x,
        original: Arc::new(dataset.signal[start..end].to_vec()),
        processed: Arc::clone(&processed),
        plateau_features: Vec::new(),
        statistics: AnalysisStatistics::default(),
        stable_segments: Vec::new(),
        droplet_measurements: Vec::new(),
        droplet_statistics: Default::default(),
        used_cached_preprocess,
        warnings: Vec::new(),
    };

    if let Err(message) = validation {
        result.warnings.push(message);
    } else {
        let smooth_half = (result.request.preprocess.smooth_window / 2).max(1);
        let analysis = run_droplet(
            &dataset.signal[start..end],
            &result.x,
            &processed,
            noise,
            scale,
            &result.request.droplet,
            result.has_real_time,
            smooth_half,
        );
        result.stable_segments = analysis.segments;
        result.droplet_measurements = analysis.measurements;
        result.droplet_statistics = analysis.statistics;
        result.warnings = analysis.warnings;
    }

    // Keep reported sample indices in the original loaded-file coordinate system.
    for segment in &mut result.stable_segments {
        segment.start_index += start;
        segment.end_index += start;
        segment.center_index += start;
    }
    for measurement in &mut result.droplet_measurements {
        measurement.center_index += start;
    }

    let updated_cache = PreprocessCache {
        sample_range: (start, end),
        dataset_revision: dataset.revision,
        params: result.request.preprocess.clone(),
        detection: detection_key,
        values: processed,
        noise,
        scale,
    };
    (result, updated_cache)
}

fn decimated_indices(signal: &[f64], limit: usize) -> Vec<usize> {
    if signal.len() <= limit || limit < 4 {
        return (0..signal.len()).collect();
    }
    let bucket_count = (limit / 2).max(1);
    let bucket_size = signal.len() as f64 / bucket_count as f64;
    let mut indices = Vec::with_capacity(limit + 2);
    indices.push(0);
    for bucket in 0..bucket_count {
        let start = (bucket as f64 * bucket_size).floor() as usize;
        let end = (((bucket + 1) as f64 * bucket_size).ceil() as usize).min(signal.len());
        if start >= end {
            continue;
        }
        let mut minimum = start;
        let mut maximum = start;
        for index in start + 1..end {
            if signal[index] < signal[minimum] {
                minimum = index;
            }
            if signal[index] > signal[maximum] {
                maximum = index;
            }
        }
        if minimum <= maximum {
            indices.push(minimum);
            indices.push(maximum);
        } else {
            indices.push(maximum);
            indices.push(minimum);
        }
    }
    indices.push(signal.len() - 1);
    indices.sort_unstable();
    indices.dedup();
    indices
}

pub fn response_from_result(result: &FullAnalysisResult) -> AnalysisResponse {
    let mut indices = decimated_indices(&result.processed, MAX_PREVIEW_POINTS / 2);
    indices.extend(decimated_indices(&result.original, MAX_PREVIEW_POINTS / 2));
    indices.sort_unstable();
    indices.dedup();
    AnalysisResponse {
        result_id: result.result_id,
        mode: result.request.mode,
        plot: PlotSeries {
            x: indices.iter().map(|index| result.x[*index]).collect(),
            original: indices
                .iter()
                .map(|index| result.original[*index])
                .collect(),
            processed: indices
                .iter()
                .map(|index| result.processed[*index])
                .collect(),
        },
        plateau_features: result.plateau_features.clone(),
        statistics: result.statistics.clone(),
        stable_segments: result.stable_segments.clone(),
        droplet_measurements: result.droplet_measurements.clone(),
        droplet_statistics: result.droplet_statistics.clone(),
        used_cached_preprocess: result.used_cached_preprocess,
        warnings: result.warnings.clone(),
    }
}

pub fn plot_view(
    x: &[f64],
    original: &[f64],
    processed: &[f64],
    x_min: f64,
    x_max: f64,
) -> Result<PlotSeries, String> {
    if !x_min.is_finite() || !x_max.is_finite() || x_min > x_max || x.is_empty() {
        return Err("无效的图表范围。".into());
    }
    let start = x.partition_point(|value| *value < x_min).saturating_sub(1);
    let end = (x.partition_point(|value| *value <= x_max) + 1).min(x.len());
    let mut indices = decimated_indices(&processed[start..end], MAX_PREVIEW_POINTS / 2);
    indices.extend(decimated_indices(
        &original[start..end],
        MAX_PREVIEW_POINTS / 2,
    ));
    indices.sort_unstable();
    indices.dedup();
    Ok(PlotSeries {
        x: indices.iter().map(|i| x[start + i]).collect(),
        original: indices.iter().map(|i| original[start + i]).collect(),
        processed: indices.iter().map(|i| processed[start + i]).collect(),
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Arc;

    use crate::models::Dataset;

    pub(crate) fn dataset(signal: Vec<f64>) -> Dataset {
        Dataset {
            revision: 1,
            file_name: "test.csv".into(),
            columns: Vec::new(),
            signal: Arc::new(signal),
            time: None,
            dropped_rows: 0,
        }
    }

    pub(crate) fn dataset_with_time(signal: Vec<f64>, time: Vec<f64>) -> Dataset {
        Dataset {
            revision: 1,
            file_name: "test.csv".into(),
            columns: Vec::new(),
            signal: Arc::new(signal),
            time: Some(Arc::new(time)),
            dropped_rows: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::models::{AmplitudeBands, AnalysisRequest, FilterMode, PreprocessParams};

    use super::test_support::dataset;
    use super::*;

    #[test]
    fn manual_bands_and_x_range_are_honored() {
        // A slowly sloping two-level signal followed by a large environmental offset.
        let data = dataset(
            (0..1400)
                .map(|i| {
                    let level = if (i / 100) % 2 == 0 { 0.07 } else { 0.005 };
                    level + (i % 100) as f64 * 0.00002 + if i >= 700 { 1.0 } else { 0.0 }
                })
                .collect(),
        );
        let mut payload = serde_json::to_value(AnalysisRequest::default()).unwrap();
        payload["mode"] = "droplet".into();
        payload["xRange"] = serde_json::json!({"min":100.0,"max":599.0});
        payload["droplet"]["amplitudeBands"] = serde_json::json!({
            "lowMin":0.0,"lowMax":0.01,"highMin":0.06,"highMax":0.08
        });
        let request: AnalysisRequest = serde_json::from_value(payload).unwrap();
        let (result, _) = analyze_dataset(&data, &request, None);
        assert_eq!(
            result.droplet_measurements.len(),
            2,
            "{:?}",
            result.warnings
        );
        assert!(
            result
                .stable_segments
                .iter()
                .all(|s| s.start >= 100.0 && s.end <= 599.0)
        );
        assert!(result.stable_segments.iter().all(|s| s.start_index >= 100));
        for m in &result.droplet_measurements {
            assert!((m.corrected_signal - 0.065).abs() < 0.0002);
        }
    }

    #[test]
    fn ranges_isolate_preprocessing_and_invalidate_cache() {
        use crate::models::XRange;
        let mut raw = vec![1e6; 100];
        raw.extend((0..500).map(|i| if (i / 100) % 2 == 0 { 0.2 } else { 0.0 }));
        raw.extend(vec![-1e6; 100]);
        let data = dataset(raw);
        let request = AnalysisRequest {
            x_range: Some(XRange {
                min: Some(100.0),
                max: Some(599.0),
            }),
            ..Default::default()
        };
        let (result, cache) = analyze_dataset(&data, &request, None);
        let isolated = dataset(data.signal[100..600].to_vec());
        let (reference, _) = analyze_dataset(&isolated, &AnalysisRequest::default(), None);
        assert_eq!(result.processed, reference.processed);
        assert_eq!(
            result.droplet_statistics.mean_corrected_signal,
            reference.droplet_statistics.mean_corrected_signal
        );
        assert_eq!(result.x.first(), Some(&100.0));
        assert_eq!(result.x.last(), Some(&599.0));
        assert_eq!(
            result.stable_segments[0].center_index,
            reference.stable_segments[0].center_index + 100
        );
        let (same, _) = analyze_dataset(&data, &request, Some(&cache));
        assert!(same.used_cached_preprocess);
        let changed = AnalysisRequest {
            x_range: None,
            ..request
        };
        let (whole, _) = analyze_dataset(&data, &changed, Some(&cache));
        assert!(!whole.used_cached_preprocess);
    }

    #[test]
    fn time_bounds_are_inclusive_and_invalid_ranges_are_rejected() {
        use crate::models::{AmplitudeBands, DropletParams, XRange};
        let data =
            test_support::dataset_with_time(vec![0.0; 6], vec![-1.0, 0.0, 0.2, 0.2, 1.7, 8.0]);
        assert_eq!(
            selected_range(
                &data,
                Some(&XRange {
                    min: Some(0.0),
                    max: Some(0.2)
                })
            )
            .unwrap(),
            (1, 4)
        );
        assert_eq!(
            selected_range(
                &data,
                Some(&XRange {
                    min: None,
                    max: Some(0.2)
                })
            )
            .unwrap(),
            (0, 4)
        );
        for range in [
            XRange {
                min: Some(8.0),
                max: Some(-1.0),
            },
            XRange {
                min: Some(10.0),
                max: None,
            },
            XRange {
                min: Some(f64::NAN),
                max: None,
            },
        ] {
            assert!(selected_range(&data, Some(&range)).is_err());
        }
        let request = AnalysisRequest {
            mode: AnalysisMode::Droplet,
            droplet: DropletParams {
                amplitude_bands: Some(AmplitudeBands {
                    low_min: 0.0,
                    low_max: 0.1,
                    high_min: 0.1,
                    high_max: 0.2,
                }),
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(validate_request(&data, &request).is_err());
        assert!(
            analyze_dataset(&data, &request, None)
                .0
                .droplet_measurements
                .is_empty()
        );
    }

    #[test]
    fn manual_windows_follow_processed_baseline_but_measure_raw_levels() {
        use crate::models::{AmplitudeBands, DropletParams};
        let data = dataset(
            (0..700)
                .map(|i| if (i / 100) % 2 == 0 { 0.07 } else { 0.005 })
                .collect(),
        );
        let mut request = AnalysisRequest {
            mode: AnalysisMode::Droplet,
            droplet: DropletParams {
                amplitude_bands: Some(AmplitudeBands {
                    low_min: 0.0,
                    low_max: 0.01,
                    high_min: 0.06,
                    high_max: 0.08,
                }),
                allow_single_sided_reference: false,
                ..Default::default()
            },
            ..Default::default()
        };
        let (before, cache) = analyze_dataset(&data, &request, None);
        request.preprocess.manual_baseline = 0.1;
        request.droplet.amplitude_bands = Some(AmplitudeBands {
            low_min: -0.1,
            low_max: -0.09,
            high_min: -0.04,
            high_max: -0.02,
        });
        let (after, _) = analyze_dataset(&data, &request, Some(&cache));
        assert_eq!(after.droplet_measurements.len(), 2);
        assert!(!after.used_cached_preprocess);
        for (a, b) in before
            .droplet_measurements
            .iter()
            .zip(&after.droplet_measurements)
        {
            assert!((a.corrected_signal - b.corrected_signal).abs() < 1e-12);
            assert!((b.high_level - 0.07).abs() < 1e-12);
        }
        request.droplet.amplitude_bands.as_mut().unwrap().high_max = -0.015;
        let (_, updated_cache) = analyze_dataset(&data, &request, None);
        request.droplet.amplitude_bands.as_mut().unwrap().low_min = -0.11;
        assert!(
            analyze_dataset(&data, &request, Some(&updated_cache))
                .0
                .used_cached_preprocess
        );
    }

    #[test]
    #[ignore = "manual release-mode performance measurement"]
    fn large_signal_benchmark() {
        for count in [200_000, 500_000] {
            let data = dataset(
                (0..count)
                    .map(|i| {
                        let noise = ((i * 7919 % 1009) as f64 / 1009.0 - 0.5) * 0.002;
                        noise
                            + if i % 1000 >= 400 && i % 1000 < 550 {
                                0.35
                            } else {
                                0.0
                            }
                    })
                    .collect(),
            );
            for mode in [FilterMode::ClipSmooth, FilterMode::MedianSmooth] {
                let request = AnalysisRequest {
                    preprocess: PreprocessParams {
                        filter_mode: mode,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let start = std::time::Instant::now();
                let (result, cache) = analyze_dataset(&data, &request, None);
                let analysis = start.elapsed();
                let start = std::time::Instant::now();
                let _ = response_from_result(&result);
                let response = start.elapsed();
                let start = std::time::Instant::now();
                let _ = analyze_dataset(&data, &request, Some(&cache));
                let cached = start.elapsed();
                let start = std::time::Instant::now();
                let suggestion = suggest_droplet_parameters(&data.signal, &request.preprocess);
                assert!(suggestion.ok);
                println!(
                    "points={count} mode={mode:?} analysis={analysis:?} preview={response:?} cached={cached:?} suggestion={:?}",
                    start.elapsed()
                );
            }
        }
    }

    #[test]
    fn viewport_returns_every_local_point_and_preserves_raw_spikes() {
        let count = 500_000;
        let x: Vec<_> = (0..count).map(|i| i as f64).collect();
        let mut original = vec![0.0; count];
        original[234_567] = 10.0;
        let processed = vec![0.0; count];
        let plot = plot_view(&x, &original, &processed, 234_550.0, 234_590.0).unwrap();
        assert_eq!(plot.x.len(), 43);
        assert!(plot.original.contains(&10.0));
        let full = plot_view(&x, &original, &processed, 0.0, 499_999.0).unwrap();
        assert!(full.original.contains(&10.0));
        assert!(full.x.len() <= MAX_PREVIEW_POINTS + 4);
        assert!(plot_view(&x, &original, &processed, f64::NAN, 1.0).is_err());
    }

    #[test]
    fn preprocessing_cache_is_reused_when_only_detection_changes() {
        let mut signal = vec![0.0; 20];
        signal.extend(vec![0.5; 10]);
        signal.extend(vec![0.0; 20]);
        let dataset = dataset(signal);
        let request = AnalysisRequest {
            preprocess: PreprocessParams {
                smooth_window: 5,
                ..PreprocessParams::default()
            },
            ..AnalysisRequest::default()
        };
        let (_, cache) = analyze_dataset(&dataset, &request, None);
        let mut changed = request;
        changed.droplet.amplitude_bands = Some(AmplitudeBands {
            low_min: -0.1,
            low_max: 0.1,
            high_min: 0.2,
            high_max: 0.7,
        });
        let (result, _) = analyze_dataset(&dataset, &changed, Some(&cache));
        assert!(result.used_cached_preprocess);
    }

    #[test]
    fn legacy_requests_run_the_current_engine_without_rewriting_saved_parameters() {
        let mut signal = vec![0.0; 200];
        signal.extend(vec![0.3; 100]);
        signal.extend(vec![0.0; 200]);
        let data = dataset(signal);

        let mut saved = serde_json::to_value(AnalysisRequest::default()).unwrap();
        saved["mode"] = "plateau".into();
        saved.as_object_mut().unwrap().remove("droplet");
        let legacy: AnalysisRequest = serde_json::from_value(saved).unwrap();
        let (droplet, _) = analyze_dataset(&data, &legacy, None);
        assert_eq!(legacy.mode, AnalysisMode::Plateau);
        assert_eq!(droplet.request.mode, AnalysisMode::Droplet);
        assert!(
            !droplet.droplet_measurements.is_empty(),
            "{:?}",
            droplet.warnings
        );
        assert!(droplet.plateau_features.is_empty());
        assert_eq!(droplet.statistics.feature_count, 0);
        let (current, _) = analyze_dataset(&data, &AnalysisRequest::default(), None);
        assert_eq!(
            droplet.droplet_statistics.mean_corrected_signal,
            current.droplet_statistics.mean_corrected_signal
        );
        assert_eq!(
            droplet.droplet_measurements.len(),
            current.droplet_measurements.len()
        );
    }

    #[test]
    fn legacy_mode_identity_does_not_select_a_different_detection_pipeline() {
        let mut signal = vec![0.0; 400];
        signal.extend(vec![0.3; 200]);
        signal.extend(vec![0.0; 400]);
        let data = dataset(signal);
        let request = AnalysisRequest {
            preprocess: PreprocessParams {
                clipping_percentile: 100.0,
                ..PreprocessParams::default()
            },
            ..AnalysisRequest::default()
        };
        let (_, cache) = analyze_dataset(&data, &request, None);
        let legacy_request = AnalysisRequest {
            mode: AnalysisMode::Plateau,
            ..request
        };
        let (result, _) = analyze_dataset(&data, &legacy_request, Some(&cache));
        assert!(result.used_cached_preprocess);
        assert_eq!(result.request.mode, AnalysisMode::Droplet);
    }
}
