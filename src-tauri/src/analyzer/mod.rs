//! Signal analysis entry points and the mode dispatch.
//!
//! ```text
//! analyze_dataset()
//!   ├── Plateau → amplitude-window region detection (legacy, unchanged)
//!   └── Droplet → detection signal → stable segments → raw level estimation
//!                 → two-state classification → sequence regularisation
//!                 → platform association → local interpolation → corrected Δ
//! ```
//!
//! The dispatch is deliberately flat: each mode owns its own module, and the only
//! shared pieces are preprocessing, robust statistics and preview decimation.

mod droplet;
mod plateau;
mod preprocess;
mod robust;

use std::sync::Arc;

use crate::models::{
    AnalysisMode, AnalysisRequest, AnalysisResponse, AnalysisStatistics, Dataset, DetectionKey,
    FullAnalysisResult, PlotSeries, PreprocessCache,
};

pub use droplet::suggest_droplet_parameters;
pub use plateau::{normalize_plateau_params, suggest_plateau_parameters};
pub use preprocess::{normalize_preprocess_params, preprocess_signal};

use droplet::{
    build_detection_signal, droplet_detection_key, normalize_droplet_params, run_droplet,
};
use plateau::{detect_plateaus, plateau_statistics};

const MAX_PREVIEW_POINTS: usize = 12_000;

pub fn normalize_request(request: &AnalysisRequest) -> AnalysisRequest {
    AnalysisRequest {
        mode: request.mode,
        preprocess: normalize_preprocess_params(&request.preprocess),
        plateau: normalize_plateau_params(&request.plateau),
        droplet: normalize_droplet_params(&request.droplet),
    }
}

/// Run one analysis pass.
///
/// The preprocessing cache is keyed by `(dataset revision, preprocess params,
/// detection pipeline)`. Segmentation, classification and measurement parameters
/// are intentionally *not* part of the key: changing them must not force a
/// rebuild of the heavy preprocessing stage.
pub fn analyze_dataset(
    dataset: &Dataset,
    request: &AnalysisRequest,
    cache: Option<&PreprocessCache>,
) -> (FullAnalysisResult, PreprocessCache) {
    let request = normalize_request(request);
    let detection_key = match request.mode {
        AnalysisMode::Plateau => DetectionKey::Plateau,
        AnalysisMode::Droplet => droplet_detection_key(&request.droplet),
    };

    let (processed, noise, scale, used_cached_preprocess) = match cache {
        Some(cache)
            if cache.dataset_revision == dataset.revision
                && cache.params == request.preprocess
                && cache.detection == detection_key =>
        {
            (Arc::clone(&cache.values), cache.noise, cache.scale, true)
        }
        _ => match request.mode {
            AnalysisMode::Plateau => (
                Arc::new(preprocess_signal(&dataset.signal, &request.preprocess)),
                0.0,
                0.0,
                false,
            ),
            AnalysisMode::Droplet => {
                let detection =
                    build_detection_signal(&dataset.signal, &request.preprocess, &request.droplet);
                (
                    Arc::new(detection.values),
                    detection.noise,
                    detection.scale,
                    false,
                )
            }
        },
    };

    let x = dataset.time.as_ref().map_or_else(
        || {
            Arc::new(
                (0..dataset.signal.len())
                    .map(|index| index as f64)
                    .collect(),
            )
        },
        Arc::clone,
    );

    let mut result = FullAnalysisResult {
        result_id: 0,
        request,
        has_real_time: dataset.time.is_some(),
        x,
        original: Arc::clone(&dataset.signal),
        processed: Arc::clone(&processed),
        plateau_features: Vec::new(),
        statistics: AnalysisStatistics::default(),
        stable_segments: Vec::new(),
        droplet_measurements: Vec::new(),
        droplet_statistics: Default::default(),
        used_cached_preprocess,
        warnings: Vec::new(),
    };

    match result.request.mode {
        AnalysisMode::Plateau => {
            result.plateau_features =
                detect_plateaus(&processed, &result.x, &result.request.plateau);
            result.statistics = plateau_statistics(&result.plateau_features);
        }
        AnalysisMode::Droplet => {
            let smooth_half = (result.request.preprocess.smooth_window / 2).max(1);
            let analysis = run_droplet(
                &dataset.signal,
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
    }

    let updated_cache = PreprocessCache {
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
    use crate::models::{AnalysisRequest, FilterMode, PlateauParams, PreprocessParams};

    use super::test_support::dataset;
    use super::*;

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
                let suggestion = suggest_plateau_parameters(&data.signal, &request.preprocess);
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
            plateau: PlateauParams {
                threshold_low: 0.2,
                threshold_high: 0.7,
                min_length: 3,
                max_length: 20,
                ..PlateauParams::default()
            },
            ..AnalysisRequest::default()
        };
        let (_, cache) = analyze_dataset(&dataset, &request, None);
        let mut changed = request;
        changed.plateau.threshold_low = 0.3;
        let (result, _) = analyze_dataset(&dataset, &changed, Some(&cache));
        assert!(result.used_cached_preprocess);
    }

    #[test]
    fn plateau_results_stay_empty_for_droplet_mode_and_vice_versa() {
        let mut signal = vec![0.0; 200];
        signal.extend(vec![0.3; 100]);
        signal.extend(vec![0.0; 200]);
        let data = dataset(signal);

        let (plateau, _) = analyze_dataset(&data, &AnalysisRequest::default(), None);
        assert_eq!(plateau.request.mode, AnalysisMode::Plateau);
        assert!(plateau.droplet_measurements.is_empty());
        assert_eq!(plateau.droplet_statistics.droplet_count, 0);

        let droplet_request = AnalysisRequest {
            mode: AnalysisMode::Droplet,
            preprocess: PreprocessParams {
                clipping_percentile: 100.0,
                ..PreprocessParams::default()
            },
            ..AnalysisRequest::default()
        };
        let (droplet, _) = analyze_dataset(&data, &droplet_request, None);
        assert!(droplet.plateau_features.is_empty());
        assert_eq!(droplet.statistics.feature_count, 0);
    }

    #[test]
    fn cached_plateau_preprocessing_is_never_reused_for_droplet() {
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
        let droplet_request = AnalysisRequest {
            mode: AnalysisMode::Droplet,
            ..request
        };
        let (result, _) = analyze_dataset(&data, &droplet_request, Some(&cache));
        assert!(!result.used_cached_preprocess);
    }
}
