//! Shared numeric helpers and robust statistics.
//!
//! Everything here is dependency-free and allocation-light on purpose: the
//! droplet engine has to stay close to O(n) for 200k–500k point records and the
//! packaged application must not ship a Python or machine-learning runtime.

/// Replace non-finite input with a fallback so one bad sample cannot poison the
/// whole pipeline through silent NaN propagation.
pub(crate) fn finite_or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() { value } else { fallback }
}

/// Force a window length to be odd and at least 3.
pub(crate) fn odd_window(value: usize) -> usize {
    let value = value.max(3);
    if value.is_multiple_of(2) {
        value + 1
    } else {
        value
    }
}

/// Largest odd number not exceeding `value`, never below 3.
///
/// The counterpart of [`odd_window`] for callers that must stay *inside* a bound
/// instead of reaching past it, e.g. a centred-median window that must fit within
/// the shortest state the caller wants to keep.
pub(crate) fn odd_at_most(value: usize) -> usize {
    let value = value.max(3);
    if value.is_multiple_of(2) {
        value - 1
    } else {
        value
    }
}

/// Mirror an index into `[0, length)` by folding it about the two edges.
///
/// Used instead of zero padding: padding a window with `0.0` would fabricate a
/// low signal at the record boundary whenever the data is not near zero. Folding
/// duplicates the edge sample (the repeated value is real data) rather than
/// inventing one.
pub(crate) fn reflect_index(index: isize, length: usize) -> usize {
    if length == 0 {
        return 0;
    }
    let span = length as isize;
    let mut index = index;
    if index < 0 {
        index = -index - 1;
    }
    if index >= span {
        index = 2 * span - index - 1;
    }
    index.clamp(0, span - 1) as usize
}

pub(crate) fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

pub(crate) fn standard_deviation(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let average = mean(values);
    let variance = values
        .iter()
        .map(|value| {
            let difference = value - average;
            difference * difference
        })
        .sum::<f64>()
        / values.len() as f64;
    variance.max(0.0).sqrt()
}

/// k-th smallest value (0-based) without allocating; `scratch` is reordered.
pub(crate) fn select_nth(scratch: &mut [f64], k: usize) -> f64 {
    if scratch.is_empty() {
        return 0.0;
    }
    let index = k.min(scratch.len() - 1);
    *scratch.select_nth_unstable_by(index, f64::total_cmp).1
}

/// Linear-interpolated percentile over the finite values of `values`.
///
/// `scratch` is reused as working memory so hot loops never allocate.
pub(crate) fn percentile_into(values: &[f64], percentile: f64, scratch: &mut Vec<f64>) -> f64 {
    scratch.clear();
    scratch.extend(values.iter().copied().filter(|value| value.is_finite()));
    if scratch.is_empty() {
        return 0.0;
    }
    let position = (scratch.len() - 1) as f64 * percentile.clamp(0.0, 100.0) / 100.0;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let (_, pivot, right) = scratch.select_nth_unstable_by(lower, f64::total_cmp);
    let low = *pivot;
    if lower == upper {
        low
    } else {
        let high = right.iter().copied().min_by(f64::total_cmp).unwrap_or(low);
        let weight = position - lower as f64;
        low * (1.0 - weight) + high * weight
    }
}

pub(crate) fn percentile(values: &[f64], percentile: f64) -> f64 {
    percentile_into(values, percentile, &mut Vec::new())
}

/// Median of the finite values in `values`.
pub(crate) fn median(values: &[f64]) -> f64 {
    percentile(values, 50.0)
}

/// Median absolute deviation scaled to a Gaussian sigma estimate (×1.4826).
pub(crate) fn scaled_mad(values: &[f64], center: f64) -> f64 {
    let deviations: Vec<f64> = values
        .iter()
        .filter(|value| value.is_finite())
        .map(|value| (value - center).abs())
        .collect();
    if deviations.is_empty() {
        return 0.0;
    }
    1.4826 * median(&deviations)
}

/// Robust sigma estimate from adjacent differences: `median(|Δ|) / 0.953872`.
///
/// For Gaussian noise `median(|Δ|) = 0.6745 · σ · √2`, so dividing by 0.953872
/// returns σ itself. Median based, so spikes and transitions cannot inflate it.
pub(crate) fn adjacent_difference_noise(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let differences: Vec<f64> = values
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .filter(|value| value.is_finite())
        .collect();
    if differences.is_empty() {
        return 0.0;
    }
    percentile(&differences, 50.0) / 0.953872
}

/// Robust magnitude of a signal, used for absolute epsilon floors.
///
/// Combining a percentile range with the median magnitude keeps the floor
/// meaningful for signals near 1e-10 and near 1e6 without ever being zero.
pub(crate) fn robust_scale(values: &[f64]) -> f64 {
    let mut scratch: Vec<f64> = Vec::new();
    let low = percentile_into(values, 1.0, &mut scratch);
    let high = percentile_into(values, 99.0, &mut scratch);
    let center = percentile_into(values, 50.0, &mut scratch).abs();
    (high - low).abs().max(center)
}

/// Least-squares slope of `y` against `x` in the units of y per unit of x.
///
/// Returns `0.0` for degenerate input (fewer than two samples, non-finite
/// values, zero x variance) instead of dividing by zero.
pub(crate) fn linear_slope(x: &[f64], y: &[f64]) -> f64 {
    let count = x.len().min(y.len());
    if count < 2 {
        return 0.0;
    }
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut used = 0usize;
    for index in 0..count {
        if x[index].is_finite() && y[index].is_finite() {
            sum_x += x[index];
            sum_y += y[index];
            used += 1;
        }
    }
    if used < 2 {
        return 0.0;
    }
    let mean_x = sum_x / used as f64;
    let mean_y = sum_y / used as f64;
    let mut sxx = 0.0;
    let mut sxy = 0.0;
    for index in 0..count {
        if x[index].is_finite() && y[index].is_finite() {
            let dx = x[index] - mean_x;
            sxx += dx * dx;
            sxy += dx * (y[index] - mean_y);
        }
    }
    if sxx <= 0.0 || !sxx.is_finite() {
        0.0
    } else {
        let slope = sxy / sxx;
        if slope.is_finite() { slope } else { 0.0 }
    }
}

/// Inclusive `(start, end)` index ranges of every contiguous `true` run.
pub(crate) fn contiguous_ranges(mask: &[bool]) -> Vec<(usize, usize)> {
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

/// Result of measuring one interior slice on the raw signal.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RobustLevel {
    pub level: f64,
    pub standard_deviation: f64,
    pub mad: f64,
    pub effective_length: usize,
    /// `p90 − p10` of the samples that survived MAD clipping.
    ///
    /// Deliberately a spread about the robust level rather than a least-squares
    /// residual spread: one surviving spike has enough leverage to tilt a fitted
    /// line by far more than the noise, so a residual spread would reject an
    /// otherwise perfectly flat state. Clipping first keeps the number honest.
    pub spread: f64,
}

/// Robust level of a slice: median → MAD clipping → robust mean.
///
/// Symmetric by construction, so a large negative spike is rejected exactly like
/// a large positive one. The clipping scale falls back to the global noise estimate
/// when the MAD is zero. A scale of exactly zero is *not* a licence to keep every
/// sample: it means at least half the samples sit exactly on the median, so the
/// clip degenerates to "exact matches only" and a glaring spike on otherwise
/// constant data is still excluded. When too few samples survive, the median is
/// returned rather than `NaN`.
pub(crate) fn robust_level(values: &[f64], sigma: f64, noise_fallback: f64) -> Option<RobustLevel> {
    if values.is_empty() {
        return None;
    }
    let center = median(values);
    let mad = scaled_mad(values, center);
    let scale = if mad > 0.0 && mad.is_finite() {
        mad
    } else if noise_fallback > 0.0 && noise_fallback.is_finite() {
        noise_fallback
    } else {
        0.0
    };

    let limit = sigma.max(0.0) * scale;
    let inliers: Vec<f64> = values
        .iter()
        .copied()
        .filter(|value| value.is_finite() && (value - center).abs() <= limit)
        .collect();

    if inliers.is_empty() {
        let kept: Vec<f64> = values
            .iter()
            .copied()
            .filter(|value| value.is_finite())
            .collect();
        let level = if kept.is_empty() {
            center
        } else {
            median(&kept)
        };
        return Some(RobustLevel {
            level: finite_or(level, center),
            standard_deviation: 0.0,
            mad,
            effective_length: usize::from(!kept.is_empty()),
            spread: 0.0,
        });
    }

    // Fewer than four survivors carries no usable spread information; reporting
    // zero keeps the caller from rejecting a range on a meaningless number.
    let spread = if inliers.len() >= 4 {
        percentile(&inliers, 90.0) - percentile(&inliers, 10.0)
    } else {
        0.0
    };
    Some(RobustLevel {
        level: mean(&inliers),
        standard_deviation: standard_deviation(&inliers),
        mad,
        effective_length: inliers.len(),
        spread,
    })
}

/// Symmetric centered-median despike (Hampel filter).
///
/// Each sample is compared with the median of a centered window; when the
/// residual exceeds `sigma_factor` times the window's scaled MAD it is replaced by
/// that median. Positive and negative spikes are treated identically, unlike the
/// one-sided percentile clip used by the legacy preprocessing path.
///
/// A window whose MAD is exactly zero (perfectly flat data) falls back to a tiny
/// scale derived from the global magnitude, so a lone spike on an otherwise flat
/// plateau is still removed.
pub(crate) fn hampel_despike(signal: &[f64], window: usize, sigma_factor: f64) -> Vec<f64> {
    let length = signal.len();
    if length == 0 {
        return Vec::new();
    }
    let sanitized: Vec<f64> = signal.iter().map(|value| finite_or(*value, 0.0)).collect();
    if length < 3 {
        return sanitized;
    }
    let mut window = window.min(length);
    if window.is_multiple_of(2) {
        window = window.saturating_sub(1);
    }
    if window < 3 {
        return sanitized;
    }

    let half = window / 2;
    let floor = (1e-12 * robust_scale(&sanitized)).max(1e-300);
    let mut buffer: Vec<f64> = Vec::with_capacity(window);
    let mut deviations: Vec<f64> = Vec::with_capacity(window);
    let mut rank: Vec<f64> = Vec::with_capacity(window);
    let mut output = sanitized.clone();

    for (index, value) in output.iter_mut().enumerate() {
        buffer.clear();
        deviations.clear();
        for offset in 0..window {
            let source = reflect_index(index as isize + offset as isize - half as isize, length);
            buffer.push(sanitized[source]);
        }
        let center = select_nth(&mut buffer, half);
        deviations.extend(buffer.iter().map(|sample| (sample - center).abs()));
        let local = 1.4826 * percentile_into(&deviations, 50.0, &mut rank);
        let scale = if local > floor { local } else { floor };
        if (sanitized[index] - center).abs() > sigma_factor * scale {
            *value = center;
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantile_selection_matches_interpolation() {
        assert_eq!(percentile(&[4.0, 1.0, 3.0, 2.0], 50.0), 2.5);
        assert_eq!(percentile(&[f64::NAN, 7.0], 99.0), 7.0);
        assert_eq!(percentile(&[], 10.0), 0.0);
    }

    #[test]
    fn reflected_windows_never_fabricate_zero_padding() {
        // A constant high signal must stay constant at both boundaries; zero
        // padding would create a fictitious low edge.
        let signal = vec![0.4; 11];
        let filtered = hampel_despike(&signal, 5, 3.0);
        assert_close(&filtered, &signal, 0.0);
        assert_eq!(reflect_index(-1, 11), 0);
        assert_eq!(reflect_index(-2, 11), 1);
        assert_eq!(reflect_index(11, 11), 10);
        assert_eq!(reflect_index(13, 11), 8);
        assert_eq!(reflect_index(-5, 3), 1);
    }

    #[test]
    fn hampel_removes_both_spike_polarities_and_keeps_steps() {
        let mut signal = vec![0.01; 200];
        signal[60] = 9.0;
        signal[140] = -9.0;
        let filtered = hampel_despike(&signal, 5, 3.0);
        assert!((filtered[60] - 0.01).abs() < 1e-9);
        assert!((filtered[140] - 0.01).abs() < 1e-9);

        // A clean step must survive: every edge window has a large MAD, so no
        // sample is considered an outlier there.
        let mut stepped = vec![0.0005; 60];
        stepped.extend(vec![0.035; 60]);
        let filtered = hampel_despike(&stepped, 5, 3.0);
        assert_close(&filtered, &stepped, 0.0);
    }

    #[test]
    fn robust_level_rejects_outliers_on_both_sides() {
        let mut values = vec![1.0; 41];
        values[10] = 100.0;
        values[30] = -100.0;
        let measured = robust_level(&values, 3.0, 0.0).unwrap();
        assert!((measured.level - 1.0).abs() < 1e-9, "{measured:?}");
        assert_eq!(measured.effective_length, 39);
        // The spread is measured on the survivors, so the spikes cannot leak into it.
        assert!(measured.spread < 1e-9, "{measured:?}");
    }

    #[test]
    fn robust_level_spread_is_not_inflated_by_a_single_spike() {
        // A fitted line would be tilted by the survivor and report a spread many
        // times the noise; the clipped spread must stay at the noise level.
        let mut values: Vec<f64> = (0..121)
            .map(|index| 0.5 + ((index * 7919 % 1009) as f64 / 1009.0 - 0.5) * 0.002)
            .collect();
        values[60] = 5.0;
        let measured = robust_level(&values, 3.0, 0.001).unwrap();
        assert!(measured.spread < 0.004, "{measured:?}");
        assert!((measured.level - 0.5).abs() < 1e-3, "{measured:?}");
    }

    #[test]
    fn robust_level_degrades_to_median_without_nan() {
        // Every sample is an outlier, so MAD clipping removes everything.
        let values = vec![1.0, 2.0, 3.0];
        let measured = robust_level(&values, 0.0, 0.0).unwrap();
        assert!(measured.level.is_finite());
        assert_eq!(measured.effective_length, 1);

        let mut constant = vec![0.5; 10];
        constant[3] = 5e-12;
        let measured = robust_level(&constant, 3.0, 0.0).unwrap();
        assert!((measured.level - 0.5).abs() < 1e-9, "{measured:?}");
        assert!(measured.mad.abs() < 1e-12);
    }

    #[test]
    fn adjacent_difference_noise_recovers_sigma() {
        assert_eq!(adjacent_difference_noise(&[1.0]), 0.0);
        let noisy: Vec<f64> = (0..20_000)
            .map(|index| ((index * 7919 % 1009) as f64 / 1009.0 - 0.5) * 0.002)
            .collect();
        let sigma = adjacent_difference_noise(&noisy);
        assert!(sigma > 0.0 && sigma < 0.01, "{sigma}");
    }

    #[test]
    fn linear_slope_is_zero_for_degenerate_input() {
        assert_eq!(linear_slope(&[1.0], &[1.0]), 0.0);
        assert_eq!(linear_slope(&[1.0, 1.0, 1.0], &[1.0, 2.0, 3.0]), 0.0);
        assert!((linear_slope(&[0.0, 1.0, 2.0], &[0.0, 2.0, 4.0]) - 2.0).abs() < 1e-12);
    }

    #[test]
    fn odd_windows_respect_their_bound() {
        assert_eq!(odd_window(4), 5);
        assert_eq!(odd_at_most(0), 3);
        assert_eq!(odd_at_most(3), 3);
        assert_eq!(odd_at_most(4), 3);
        assert_eq!(odd_at_most(8), 7);
        assert_eq!(odd_at_most(21), 21);
    }

    #[test]
    fn contiguous_ranges_splits_masks() {
        assert_eq!(
            contiguous_ranges(&[false, true, true, false, true]),
            vec![(1, 2), (4, 4)]
        );
        assert!(contiguous_ranges(&[]).is_empty());
        assert!(contiguous_ranges(&[false, false]).is_empty());
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
}
