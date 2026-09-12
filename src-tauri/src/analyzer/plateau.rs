//! Legacy plateau pipeline: amplitude-window region detection and suggestions.
//!
//! This mode is unchanged on purpose. It answers "which contiguous samples sit
//! inside an amplitude window", which is a different question from the droplet
//! engine's "which stable signal states exist and how do they alternate".

use crate::models::{
    AnalysisStatistics, ParameterSuggestion, PlateauFeature, PlateauParams, PreprocessParams,
};

use super::preprocess::{normalize_preprocess_params, preprocess_signal};
use super::robust::{contiguous_ranges, finite_or, mean, percentile, standard_deviation};

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

/// Detect contiguous regions whose samples all fall inside the amplitude window.
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

pub fn plateau_statistics(features: &[PlateauFeature]) -> AnalysisStatistics {
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

/// Suggest an amplitude window from robust noise and sustained-region interiors.
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
            droplet: None,
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
            droplet: None,
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
        droplet: None,
    }
}

#[cfg(test)]
mod tests {
    use crate::analyzer::test_support::dataset;
    use crate::models::AnalysisRequest;

    use super::*;

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
    fn parameter_normalization_keeps_ranges_valid() {
        let plateau = normalize_plateau_params(&PlateauParams {
            threshold_low: 5.0,
            threshold_high: 1.0,
            min_length: 10,
            max_length: 2,
            ..PlateauParams::default()
        });
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
                crate::analyzer::analyze_dataset(&data, &request, None)
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
}
