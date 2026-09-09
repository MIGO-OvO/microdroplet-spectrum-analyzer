use std::cmp::Ordering;
use std::sync::Arc;

use crate::models::{
    AnalysisMode, AnalysisRequest, AnalysisResponse, AnalysisStatistics, Dataset, FilterMode,
    FullAnalysisResult, ParameterSuggestion, PlateauFeature, PlateauParams, PlotSeries,
    PreprocessCache, PreprocessParams,
};

const MAX_PREVIEW_POINTS: usize = 12_000;

fn odd_window(value: usize) -> usize {
    let value = value.max(3);
    if value.is_multiple_of(2) {
        value + 1
    } else {
        value
    }
}

fn window_for_signal(window: usize, signal_length: usize) -> Option<usize> {
    if signal_length < 3 {
        return None;
    }
    let mut window = window.min(signal_length);
    if window.is_multiple_of(2) {
        window -= 1;
    }
    (window >= 3).then_some(window)
}

pub fn normalize_preprocess_params(params: &PreprocessParams) -> PreprocessParams {
    let median_window = odd_window(params.median_window);
    let smooth_window = odd_window(params.smooth_window);
    PreprocessParams {
        filter_mode: params.filter_mode,
        median_window,
        smooth_window,
        smooth_order: params.smooth_order.min(smooth_window.saturating_sub(1)),
        clipping_percentile: params.clipping_percentile.clamp(0.0, 100.0),
        manual_baseline: finite_or(params.manual_baseline, 0.0),
    }
}

pub fn normalize_plateau_params(params: &PlateauParams) -> PlateauParams {
    let mut low = finite_or(params.threshold_low, 0.1);
    let mut high = finite_or(params.threshold_high, 0.5);
    if low > high {
        std::mem::swap(&mut low, &mut high);
    }
    let mut min_length = params.min_length.max(1);
    let mut max_length = params.max_length.max(1);
    if min_length > max_length {
        std::mem::swap(&mut min_length, &mut max_length);
    }
    PlateauParams {
        threshold_low: low,
        threshold_high: high,
        min_length,
        max_length,
        deviation_threshold: finite_or(params.deviation_threshold, 20.0).max(0.0),
    }
}

pub fn normalize_request(request: &AnalysisRequest) -> AnalysisRequest {
    AnalysisRequest {
        mode: request.mode,
        preprocess: normalize_preprocess_params(&request.preprocess),
        plateau: normalize_plateau_params(&request.plateau),
    }
}

fn finite_or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() { value } else { fallback }
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect();
    if sorted.is_empty() {
        return 0.0;
    }
    let position = (sorted.len() - 1) as f64 * percentile.clamp(0.0, 100.0) / 100.0;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let (_, pivot, right) = sorted.select_nth_unstable_by(lower, f64::total_cmp);
    let low = *pivot;
    if lower == upper {
        low
    } else {
        let high = right.iter().copied().min_by(f64::total_cmp).unwrap_or(low);
        let weight = position - lower as f64;
        low * (1.0 - weight) + high * weight
    }
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn standard_deviation(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let average = mean(values);
    (values
        .iter()
        .map(|value| {
            let difference = value - average;
            difference * difference
        })
        .sum::<f64>()
        / values.len() as f64)
        .sqrt()
}

fn median_filter(signal: &[f64], window: usize) -> Vec<f64> {
    let half = window / 2;
    let mut values = Vec::with_capacity(window);
    (0..signal.len())
        .map(|index| {
            values.clear();
            for offset in 0..window {
                let source = index as isize + offset as isize - half as isize;
                values.push(if source < 0 || source >= signal.len() as isize {
                    0.0
                } else {
                    signal[source as usize]
                });
            }
            *values.select_nth_unstable_by(half, f64::total_cmp).1
        })
        .collect()
}

fn solve_linear_system(mut matrix: Vec<Vec<f64>>, mut values: Vec<f64>) -> Option<Vec<f64>> {
    let size = values.len();
    for pivot in 0..size {
        let best = (pivot..size).max_by(|left, right| {
            matrix[*left][pivot]
                .abs()
                .partial_cmp(&matrix[*right][pivot].abs())
                .unwrap_or(Ordering::Equal)
        })?;
        if matrix[best][pivot].abs() < 1e-12 {
            return None;
        }
        matrix.swap(pivot, best);
        values.swap(pivot, best);

        let divisor = matrix[pivot][pivot];
        for value in matrix[pivot].iter_mut().skip(pivot) {
            *value /= divisor;
        }
        values[pivot] /= divisor;

        let pivot_row = matrix[pivot].clone();
        for (row, row_values) in matrix.iter_mut().enumerate() {
            if row == pivot {
                continue;
            }
            let factor = row_values[pivot];
            for (value, pivot_value) in row_values.iter_mut().zip(&pivot_row).skip(pivot) {
                *value -= factor * pivot_value;
            }
            values[row] -= factor * values[pivot];
        }
    }
    Some(values)
}

fn savitzky_golay_weights(window: usize, order: usize, evaluate_at: f64) -> Option<Vec<f64>> {
    let terms = order + 1;
    let mut gram = vec![vec![0.0; terms]; terms];
    for (row, row_values) in gram.iter_mut().enumerate() {
        for (column, value) in row_values.iter_mut().enumerate() {
            *value = (0..window)
                .map(|index| (index as f64).powi((row + column) as i32))
                .sum();
        }
    }
    let evaluation: Vec<f64> = (0..terms)
        .map(|power| evaluate_at.powi(power as i32))
        .collect();
    let coefficients = solve_linear_system(gram, evaluation)?;
    Some(
        (0..window)
            .map(|index| {
                coefficients
                    .iter()
                    .enumerate()
                    .map(|(power, value)| value * (index as f64).powi(power as i32))
                    .sum()
            })
            .collect(),
    )
}

fn apply_weights(values: &[f64], weights: &[f64]) -> f64 {
    values
        .iter()
        .zip(weights)
        .map(|(value, weight)| value * weight)
        .sum()
}

fn savitzky_golay_filter(signal: &[f64], window: usize, order: usize) -> Vec<f64> {
    let Some(window) = window_for_signal(window, signal.len()) else {
        return signal.to_vec();
    };
    let order = order.min(window - 1);
    let half = window / 2;
    let Some(center_weights) = savitzky_golay_weights(window, order, half as f64) else {
        return signal.to_vec();
    };
    let mut output = vec![0.0; signal.len()];
    let first_window = &signal[..window];
    let last_window = &signal[signal.len() - window..];

    for (index, value) in output.iter_mut().enumerate().take(half) {
        let weights = savitzky_golay_weights(window, order, index as f64)
            .unwrap_or_else(|| center_weights.clone());
        *value = apply_weights(first_window, &weights);
    }
    for index in half..signal.len() - half {
        output[index] = apply_weights(&signal[index - half..index + half + 1], &center_weights);
    }
    for (index, value) in output.iter_mut().enumerate().skip(signal.len() - half) {
        let relative = index - (signal.len() - window);
        let weights = savitzky_golay_weights(window, order, relative as f64)
            .unwrap_or_else(|| center_weights.clone());
        *value = apply_weights(last_window, &weights);
    }
    output
}

pub fn preprocess_signal(signal: &[f64], params: &PreprocessParams) -> Vec<f64> {
    let params = normalize_preprocess_params(params);
    let mut processed: Vec<f64> = signal.iter().map(|value| finite_or(*value, 0.0)).collect();

    match params.filter_mode {
        FilterMode::ClipSmooth => {
            if params.clipping_percentile < 100.0 {
                let threshold = percentile(&processed, params.clipping_percentile);
                for value in &mut processed {
                    *value = value.min(threshold);
                }
            }
        }
        FilterMode::MedianSmooth => {
            if let Some(window) = window_for_signal(params.median_window, processed.len()) {
                processed = median_filter(&processed, window);
            }
        }
    }

    if let Some(window) = window_for_signal(params.smooth_window, processed.len()) {
        let order = params.smooth_order.min(window - 1);
        processed = savitzky_golay_filter(&processed, window, order);
    }
    for value in &mut processed {
        *value -= params.manual_baseline;
    }
    processed
}

fn contiguous_ranges(mask: &[bool]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut start = None;
    for (index, included) in mask
        .iter()
        .copied()
        .chain(std::iter::once(false))
        .enumerate()
    {
        match (start, included) {
            (None, true) => start = Some(index),
            (Some(begin), false) => {
                ranges.push((begin, index - 1));
                start = None;
            }
            _ => {}
        }
    }
    ranges
}

pub fn detect_plateaus(
    processed: &[f64],
    x: &[f64],
    params: &PlateauParams,
) -> Vec<PlateauFeature> {
    let params = normalize_plateau_params(params);
    let mask: Vec<bool> = processed
        .iter()
        .map(|value| *value >= params.threshold_low && *value <= params.threshold_high)
        .collect();

    contiguous_ranges(&mask)
        .into_iter()
        .filter_map(|(start, end)| {
            let length = end - start + 1;
            if length < params.min_length || length > params.max_length {
                return None;
            }
            let values = &processed[start..=end];
            let initial_mean = mean(values);
            let deviation_limit =
                initial_mean + initial_mean.abs() * params.deviation_threshold / 100.0;
            let refined: Vec<f64> = values
                .iter()
                .copied()
                .filter(|value| *value <= deviation_limit)
                .collect();
            if (refined.len() as f64) < params.min_length as f64 / 2.0 {
                return None;
            }
            let center_index = (start + end) / 2;
            Some(PlateauFeature {
                number: 0,
                center_index,
                center: x[center_index],
                start: x[start],
                end: x[end],
                height: mean(&refined),
                length,
                standard_deviation: standard_deviation(&refined),
            })
        })
        .enumerate()
        .map(|(index, mut feature)| {
            feature.number = index + 1;
            feature
        })
        .collect()
}

fn statistics_from_heights(heights: &[f64]) -> AnalysisStatistics {
    if heights.is_empty() {
        return AnalysisStatistics::default();
    }
    let average = mean(heights);
    let deviation = standard_deviation(heights);
    AnalysisStatistics {
        feature_count: heights.len(),
        mean_height: Some(average),
        max_height: heights.iter().copied().reduce(f64::max),
        min_height: heights.iter().copied().reduce(f64::min),
        standard_deviation: Some(deviation),
        rsd: Some(if average == 0.0 {
            0.0
        } else {
            deviation / average * 100.0
        }),
        mean_length: None,
        length_standard_deviation: None,
    }
}

fn plateau_statistics(features: &[PlateauFeature]) -> AnalysisStatistics {
    let heights: Vec<f64> = features.iter().map(|feature| feature.height).collect();
    let lengths: Vec<f64> = features
        .iter()
        .map(|feature| feature.length as f64)
        .collect();
    let mut statistics = statistics_from_heights(&heights);
    if !lengths.is_empty() {
        statistics.mean_length = Some(mean(&lengths));
        statistics.length_standard_deviation = Some(standard_deviation(&lengths));
    }
    statistics
}

pub fn analyze_dataset(
    dataset: &Dataset,
    request: &AnalysisRequest,
    cache: Option<&PreprocessCache>,
) -> (FullAnalysisResult, PreprocessCache) {
    let request = normalize_request(request);
    let (processed, used_cached_preprocess) = match cache {
        Some(cache)
            if cache.dataset_revision == dataset.revision && cache.params == request.preprocess =>
        {
            (Arc::clone(&cache.values), true)
        }
        _ => (
            Arc::new(preprocess_signal(&dataset.signal, &request.preprocess)),
            false,
        ),
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

    let (plateau_features, statistics) = match request.mode {
        AnalysisMode::Plateau => {
            let features = detect_plateaus(&processed, &x, &request.plateau);
            let statistics = plateau_statistics(&features);
            (features, statistics)
        }
    };

    let updated_cache = PreprocessCache {
        dataset_revision: dataset.revision,
        params: request.preprocess.clone(),
        values: Arc::clone(&processed),
    };
    let result = FullAnalysisResult {
        result_id: 0,
        request,
        has_real_time: dataset.time.is_some(),
        x,
        original: Arc::clone(&dataset.signal),
        processed,
        plateau_features,
        statistics,
        used_cached_preprocess,
        warnings: Vec::new(),
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

fn round_significant(value: f64, upward: bool) -> f64 {
    if value == 0.0 {
        return 0.0;
    }
    let step = 10.0_f64.powf(value.abs().log10().floor() - 1.0);
    if step == 0.0 || !step.is_finite() {
        return value;
    }
    let scaled = value / step;
    let rounded = (if upward {
        scaled.ceil()
    } else {
        scaled.floor()
    }) * step;
    // Canonical decimal parsing avoids displaying binary multiplication tails in JSON inputs.
    format!("{rounded:.1e}").parse().unwrap_or(rounded)
}

pub fn suggest_plateau_parameters(
    signal: &[f64],
    preprocess: &PreprocessParams,
) -> ParameterSuggestion {
    let processed = preprocess_signal(signal, preprocess);
    if processed.len() < 20 {
        return ParameterSuggestion {
            ok: false,
            message: "数据点过少，无法自动建议参数。".into(),
            plateau: None,
        };
    }

    // Robust baseline and adjacent-difference noise estimate resist high spikes.
    let baseline = percentile(&processed, 10.0);
    let differences: Vec<f64> = processed
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .collect();
    let noise = percentile(&differences, 50.0) / 0.953872;
    let peak = processed.iter().copied().fold(baseline, f64::max);
    let floor = (peak - baseline).abs() * 1e-6 + f64::EPSILON;
    let cutoff = baseline + (6.0 * noise).max(floor);
    let mask: Vec<bool> = processed.iter().map(|value| *value > cutoff).collect();
    let mut candidates = Vec::new();
    let minimum_run = normalize_preprocess_params(preprocess).smooth_window.max(5);
    for (start, end) in contiguous_ranges(&mask) {
        let length = end - start + 1;
        if length < minimum_run {
            continue;
        }
        // Use interiors, not rising/falling edges, to estimate plateau amplitude.
        let trim = (length / 4).max(1);
        let interior = &processed[start + trim..=end - trim];
        let spread = percentile(interior, 90.0) - percentile(interior, 10.0);
        let level = percentile(interior, 50.0);
        if level - baseline > (6.0 * noise).max(floor)
            && spread <= ((level - baseline) * 0.25).max(noise * 8.0)
        {
            candidates.extend_from_slice(interior);
        }
    }
    if candidates.len() < 5 {
        return ParameterSuggestion {
            ok: false,
            message: "未找到可可靠识别的稳定平台，请手动设置区间或调整平滑参数。".into(),
            plateau: None,
        };
    }
    let lower = percentile(&candidates, 2.0);
    let upper = percentile(&candidates, 98.0);
    let margin = (noise * 4.0)
        .max((upper - lower) * 0.08)
        .max((upper - baseline).abs() * 0.01);
    let low = round_significant(lower - margin, false);
    let high = round_significant(upper + margin, true);
    let mask: Vec<bool> = processed
        .iter()
        .map(|value| *value >= low && *value <= high)
        .collect();
    let lengths: Vec<f64> = contiguous_ranges(&mask)
        .iter()
        .map(|(start, end)| (end - start + 1) as f64)
        .collect();
    let (min_length, max_length) = if lengths.is_empty() {
        (5, 1000)
    } else {
        let minimum = (percentile(&lengths, 10.0) * 0.5).round().max(5.0) as usize;
        let maximum = (percentile(&lengths, 90.0) * 1.5).round() as usize;
        (minimum, maximum.max(minimum))
    };
    ParameterSuggestion {
        ok: true,
        message: "已根据数据特征自动填写建议参数。".into(),
        plateau: Some(normalize_plateau_params(&PlateauParams {
            threshold_low: low,
            threshold_high: high,
            min_length,
            max_length,
            deviation_threshold: 20.0,
        })),
    }
}

#[cfg(test)]
mod tests {
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

    fn assert_close(actual: &[f64], expected: &[f64], tolerance: f64) {
        assert_eq!(actual.len(), expected.len());
        for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
            assert!(
                (actual - expected).abs() <= tolerance,
                "value {index}: expected {expected}, received {actual}"
            );
        }
    }

    #[test]
    fn quantile_selection_matches_interpolation() {
        assert_eq!(percentile(&[4.0, 1.0, 3.0, 2.0], 50.0), 2.5);
        assert_eq!(percentile(&[f64::NAN, 7.0], 99.0), 7.0);
        assert_eq!(percentile(&[], 10.0), 0.0);
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
    fn suggestions_reject_flat_noise_and_isolated_spikes() {
        for signal in [
            vec![0.4; 1000],
            (0..1000)
                .map(|i| if i == 500 { 10.0 } else { 0.0 })
                .collect(),
        ] {
            assert!(!suggest_plateau_parameters(&signal, &PreprocessParams::default()).ok);
        }
    }

    #[test]
    fn suggested_lengths_tolerate_smoothing_changes() {
        let data = dataset(
            (0..20_000)
                .map(|i| {
                    if (400..550).contains(&(i % 1000)) {
                        0.35
                    } else {
                        0.0
                    }
                })
                .collect(),
        );
        let preprocess = PreprocessParams::default();
        let plateau = suggest_plateau_parameters(&data.signal, &preprocess)
            .plateau
            .unwrap();
        for window in [11, 13, 21] {
            let request = AnalysisRequest {
                preprocess: PreprocessParams {
                    smooth_window: window,
                    ..preprocess.clone()
                },
                plateau: plateau.clone(),
                ..Default::default()
            };
            assert_eq!(
                analyze_dataset(&data, &request, None)
                    .0
                    .statistics
                    .feature_count,
                20
            );
        }
    }

    #[test]
    fn sparse_noisy_plateaus_are_detected_with_two_significant_bounds() {
        for baseline in [0.0, 3.0, -0.5] {
            let signal: Vec<_> = (0..20_000)
                .map(|i| {
                    baseline
                        + if (10_000..10_150).contains(&i) {
                            0.35
                        } else {
                            0.0
                        }
                        + ((i * 7919 % 1009) as f64 / 1009.0 - 0.5) * 0.002
                })
                .collect();
            let params = PreprocessParams {
                clipping_percentile: 100.0,
                ..Default::default()
            };
            let suggestion = suggest_plateau_parameters(&signal, &params);
            assert!(suggestion.ok, "{}", suggestion.message);
            let p = suggestion.plateau.unwrap();
            assert!(
                p.threshold_low < baseline + 0.35 && p.threshold_high > baseline + 0.35,
                "{p:?}"
            );
            for value in [p.threshold_low, p.threshold_high] {
                let scale = 10.0_f64.powf(value.abs().log10().floor() - 1.0);
                assert!((value / scale - (value / scale).round()).abs() < 1e-8);
            }
        }
    }

    fn dataset(signal: Vec<f64>) -> Dataset {
        Dataset {
            revision: 1,
            file_name: "test.csv".into(),
            columns: Vec::new(),
            signal: Arc::new(signal),
            time: None,
            dropped_rows: 0,
        }
    }

    #[test]
    fn plateau_centered_at_zero_is_counted() {
        let signal = vec![1.0, 0.0, 0.0];
        let x = vec![0.0, 1.0, 2.0];
        let features = detect_plateaus(
            &signal,
            &x,
            &PlateauParams {
                threshold_low: 0.5,
                threshold_high: 1.5,
                min_length: 1,
                max_length: 1,
                deviation_threshold: 20.0,
            },
        );
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].center_index, 0);
        assert!((features[0].height - 1.0).abs() < 1e-12);
    }

    #[test]
    fn parameter_normalization_keeps_windows_and_ranges_valid() {
        let preprocess = normalize_preprocess_params(&PreprocessParams {
            median_window: 2,
            smooth_window: 4,
            smooth_order: 9,
            ..PreprocessParams::default()
        });
        let plateau = normalize_plateau_params(&PlateauParams {
            threshold_low: 5.0,
            threshold_high: 1.0,
            min_length: 10,
            max_length: 2,
            ..PlateauParams::default()
        });
        assert!(preprocess.median_window >= 3 && preprocess.median_window % 2 == 1);
        assert!(preprocess.smooth_window >= 3 && preprocess.smooth_window % 2 == 1);
        assert!(preprocess.smooth_order < preprocess.smooth_window);
        assert!(plateau.threshold_low <= plateau.threshold_high);
        assert!(plateau.min_length <= plateau.max_length);
    }

    #[test]
    fn suggestion_returns_a_valid_range_for_two_platforms() {
        let mut signal = vec![0.0; 50];
        signal.extend(vec![0.35; 30]);
        signal.extend(vec![0.0; 50]);
        signal.extend(vec![0.38; 25]);
        signal.extend(vec![0.0; 50]);
        let suggestion = suggest_plateau_parameters(&signal, &PreprocessParams::default());
        assert!(suggestion.ok, "{}", suggestion.message);
        let plateau = suggestion.plateau.expect("suggested plateau parameters");
        assert!(plateau.threshold_low <= plateau.threshold_high);
        assert!(plateau.min_length <= plateau.max_length);
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
    fn preprocessing_matches_the_python_reference_fixture() {
        let signal = [
            0.0, 0.02, 0.0, 0.3, 0.32, 0.31, 0.29, 0.0, 0.01, 0.0, 0.6, 0.0, 0.02,
        ];
        let clip = preprocess_signal(
            &signal,
            &PreprocessParams {
                filter_mode: FilterMode::ClipSmooth,
                smooth_window: 5,
                smooth_order: 3,
                clipping_percentile: 90.0,
                manual_baseline: 0.01,
                ..PreprocessParams::default()
            },
        );
        assert_close(
            &clip,
            &[
                0.003742857143,
                -0.044971428571,
                0.072457142857,
                0.216457142857,
                0.328742857143,
                0.323314285714,
                0.209028571429,
                0.066285714286,
                -0.057257142857,
                0.102457142857,
                0.141885714286,
                0.100742857143,
                -0.017685714286,
            ],
            1e-9,
        );

        let median = preprocess_signal(
            &signal,
            &PreprocessParams {
                filter_mode: FilterMode::MedianSmooth,
                median_window: 3,
                smooth_window: 5,
                smooth_order: 3,
                manual_baseline: 0.01,
                ..PreprocessParams::default()
            },
        );
        assert_close(
            &median,
            &[
                0.001,
                -0.054,
                0.076,
                0.222285714286,
                0.323142857143,
                0.319714285714,
                0.214,
                0.066857142857,
                -0.028,
                -0.007714285714,
                0.000285714286,
                0.003142857143,
                -0.008285714286,
            ],
            1e-9,
        );
    }
}
