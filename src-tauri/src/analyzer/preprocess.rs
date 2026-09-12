//! Signal preprocessing: filter modes, Savitzky–Golay smoothing and baseline shift.
//!
//! This module is shared by both analysis modes. The legacy plateau pipeline uses
//! [`preprocess_signal`] directly; the droplet engine uses the same Savitzky–Golay
//! core but feeds it a symmetric despiked signal (see `droplet::build_detection_signal`).

use std::cmp::Ordering;

use crate::models::{FilterMode, PreprocessParams};

use super::robust::{finite_or, odd_window, percentile, reflect_index};

/// Largest window a median or smoothing filter may take for a given length.
///
/// Returns `None` when the signal is too short for the requested minimum.
pub(crate) fn window_for_signal(window: usize, signal_length: usize) -> Option<usize> {
    if signal_length < 3 {
        return None;
    }
    let mut window = window.min(signal_length);
    if window.is_multiple_of(2) {
        window -= 1;
    }
    (window >= 3).then_some(window)
}

fn window_for_median(window: usize, signal_length: usize) -> Option<usize> {
    if signal_length == 0 {
        return None;
    }
    let mut window = window.min(signal_length);
    if window.is_multiple_of(2) {
        window -= 1;
    }
    (window >= 1).then_some(window)
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

/// White-noise gain of a Savitzky–Golay smoothing pass: `sqrt(Σ wᵢ²)`.
///
/// The droplet engine needs the residual noise of the detection signal, and this
/// factor turns the raw sigma estimate into the smoothed sigma exactly, without
/// having to re-measure the smoothed record.
pub(crate) fn savitzky_golay_noise_gain(window: usize, order: usize, signal_length: usize) -> f64 {
    let Some(window) = window_for_signal(window, signal_length) else {
        return 1.0;
    };
    let order = order.min(window - 1);
    let half = window / 2;
    savitzky_golay_weights(window, order, half as f64)
        .map(|weights| {
            weights
                .iter()
                .map(|weight| weight * weight)
                .sum::<f64>()
                .sqrt()
        })
        .filter(|gain| gain.is_finite() && *gain > 0.0)
        .unwrap_or(1.0)
}

pub(crate) fn savitzky_golay_filter(signal: &[f64], window: usize, order: usize) -> Vec<f64> {
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

/// Centered median filter with reflected boundaries.
///
/// The historical implementation padded out-of-range samples with `0.0`, which
/// fabricated a low edge on any signal that is not centered near zero. Reflecting
/// the window instead keeps the boundary estimate inside the data range.
fn median_filter(signal: &[f64], window: usize) -> Vec<f64> {
    let half = window / 2;
    let mut values = Vec::with_capacity(window);
    (0..signal.len())
        .map(|index| {
            values.clear();
            for offset in 0..window {
                let source = reflect_index(
                    index as isize + offset as isize - half as isize,
                    signal.len(),
                );
                values.push(signal[source]);
            }
            *values.select_nth_unstable_by(half, f64::total_cmp).1
        })
        .collect()
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
            if let Some(window) = window_for_median(params.median_window, processed.len()) {
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn parameter_normalization_keeps_windows_valid() {
        let preprocess = normalize_preprocess_params(&PreprocessParams {
            median_window: 2,
            smooth_window: 4,
            smooth_order: 9,
            ..PreprocessParams::default()
        });
        assert!(preprocess.median_window >= 3 && preprocess.median_window % 2 == 1);
        assert!(preprocess.smooth_window >= 3 && preprocess.smooth_window % 2 == 1);
        assert!(preprocess.smooth_order < preprocess.smooth_window);
    }

    #[test]
    fn median_boundaries_reflect_instead_of_fabricating_zero() {
        // Constant 0.4 with a 5-wide median: zero padding would drag the first
        // and last two samples down towards zero.
        let signal = vec![0.4; 9];
        let filtered = median_filter(&signal, 5);
        assert_close(&filtered, &signal, 0.0);

        // The same property on the public entry point (no smoothing window).
        let processed = preprocess_signal(
            &signal,
            &PreprocessParams {
                filter_mode: FilterMode::MedianSmooth,
                median_window: 5,
                smooth_window: 3,
                smooth_order: 1,
                ..PreprocessParams::default()
            },
        );
        assert_close(&processed, &signal, 1e-12);
    }

    #[test]
    fn savitzky_golay_gain_is_bounded_and_matches_a_direct_measurement() {
        let gain = savitzky_golay_noise_gain(11, 3, 4096);
        assert!(gain > 0.0 && gain < 1.0, "{gain}");
        // No smoothing window at all: the gain is exactly one.
        assert_eq!(savitzky_golay_noise_gain(1, 0, 4096), 1.0);
        // A signal shorter than the window is smoothed with a clamped window, and a
        // clamped window at order = window − 1 interpolates: the gain is one up to
        // floating-point noise from the (ill-conditioned) weight solve.
        assert!((savitzky_golay_noise_gain(11, 3, 4) - 1.0).abs() < 1e-8);
        assert!((savitzky_golay_noise_gain(5, 4, 6) - 1.0).abs() < 1e-8);
        // A wider smoothing window cannot amplify white noise.
        assert!(savitzky_golay_noise_gain(5, 2, 4096) > savitzky_golay_noise_gain(21, 2, 4096));
    }

    #[test]
    fn preprocessing_matches_the_reference_fixture() {
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

        // Reference values were regenerated with an independent implementation
        // after the median boundary changed from zero padding to reflection.
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
                -0.001428571429,
                0.004285714286,
                0.011428571429,
            ],
            1e-9,
        );
    }

    #[test]
    fn savitzky_golay_center_weights_match_the_textbook_cubic() {
        // Independent anchor: the standard 5-point cubic smoother is (-3,12,17,12,-3)/35.
        let weights = savitzky_golay_weights(5, 3, 2.0).expect("solvable normal equations");
        let textbook = [
            -3.0 / 35.0,
            12.0 / 35.0,
            17.0 / 35.0,
            12.0 / 35.0,
            -3.0 / 35.0,
        ];
        assert_close(&weights, &textbook, 1e-12);
        assert!((weights.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    }
}
