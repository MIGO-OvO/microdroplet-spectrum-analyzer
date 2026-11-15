//! Dual-state droplet engine.
//!
//! Pipeline (each stage is a separate function on purpose):
//!
//! ```text
//! raw signal ──┬── despike (Hampel) → Savitzky–Golay → detection signal
//!              │        └── detect_stable_ranges      (where are the flat regions?)
//!              └── raw interior → median/MAD → robust mean   (what is the value?)
//!
//!   detect_stable_ranges
//!     → measure_ranges
//!     → classify_dual_states
//!     → regularize_segment_sequence
//!     → build_measurements
//!     → droplet_statistics
//! ```
//!
//! **Detection and measurement are decoupled.** The stability mask uses the
//! smoothed *detection* signal to find regions; classification uses raw
//! measured levels, and pairing uses segment centers. Every physical number
//! (`level`, `standard_deviation`, `mad`, `corrected_signal`) is measured on the
//! **raw** signal interior. Smoothing can still affect boundaries and selected points.
//!
//! ## Why the low baseline is interpolated
//!
//! `baseline_reference` interpolates adjacent low levels at the high segment's center.
//! Δ is measured high minus this low baseline. Linear drift cancellation assumes
//! correctly located centers and representative segment levels; nonlinear drift and
//! detection errors still need experimental validation. For low levels 0.0005 at
//! t=100 and 0.001 at t=200, and a high of 0.0348 at t=150:
//!
//! ```text
//! baseline_reference = 0.0005 + (0.001 - 0.0005) · (150 - 100) / (200 - 100)
//!                    = 0.00075
//! corrected_signal   = 0.0348 - 0.00075 = 0.03405
//! ```

use crate::models::{
    DetectionKey, DropletMeasurement, DropletParams, DropletStatistics, ParameterSuggestion,
    PreprocessParams, QualityFlag, ReferenceMode, SegmentKind, StableSegment,
};

use super::preprocess::{
    normalize_preprocess_params, savitzky_golay_filter, savitzky_golay_noise_gain,
};
use super::robust::{
    adjacent_difference_noise, contiguous_ranges, hampel_despike, linear_slope, mean, median,
    odd_at_most, odd_window, percentile, percentile_into, reflect_index, robust_level,
    robust_scale, scaled_mad, select_nth, standard_deviation,
};

/// Residual-spread budget of the per-segment sanity check, in units of sigma.
///
/// A genuinely flat interior has `p90 - p10 ≈ 2.56σ`, so 8σ accepts every honest
/// segment while still rejecting a range that silently contains a step.
const RESIDUAL_SPREAD_SIGMA: f64 = 8.0;

/// Below this classification score a segment is reported as `Unknown` instead of
/// being forced into one of the two states.
const UNKNOWN_CONFIDENCE_THRESHOLD: f64 = 0.15;

/// Measurements below this combined confidence are counted as low confidence.
const LOW_CONFIDENCE_THRESHOLD: f64 = 0.5;

/// Two-state separation must also be a real fraction of the signal's dynamic range.
const SEPARATION_DYNAMIC_FRACTION: f64 = 0.25;

/// A segment interior noisier than this multiple of the global robust noise is flagged.
const NOISY_SEGMENT_SIGMA: f64 = 3.0;

/// In-window MAD multiple applied before measuring the local spread, so a surviving
/// spike cannot fragment an otherwise flat state.
const WINDOW_OUTLIER_SIGMA: f64 = 3.0;

/// Fraction of a merged interior that must survive MAD clipping for the merge to be
/// accepted: a gap that is a spike or a transition artefact is mostly rejectable,
/// while a real opposite state would not be.
const MERGE_INLIER_RATIO: f64 = 0.8;

/// Holes up to this many samples inside the stability mask are closed immediately.
/// Anything wider stays a real gap and is judged later by the measured levels.
const MASK_BRIDGE_SAMPLES: usize = 2;

/// A same-kind gap may be up to `MERGE_GAP_WINDOWS × stability_window` samples wide.
///
/// Wide enough to absorb a transition artefact, and safe because the merge is also
/// gated on the level: a genuine opposite state differs by a full separation, far
/// more than the merge tolerance, so it can never be swallowed.
const MERGE_GAP_WINDOWS: usize = 2;

pub(crate) struct DetectionSignal {
    pub values: Vec<f64>,
    /// Robust sigma of the detection signal's residual noise.
    pub noise: f64,
    /// Robust magnitude of the signal, used for absolute epsilon floors.
    pub scale: f64,
}

pub(crate) struct DropletAnalysis {
    pub segments: Vec<StableSegment>,
    pub measurements: Vec<DropletMeasurement>,
    pub statistics: DropletStatistics,
    pub warnings: Vec<String>,
}

/// Everything the measurement stage needs. Grouping it keeps the stage signatures
/// small and makes it obvious that no detection-signal value is reachable from here.
#[derive(Clone, Copy)]
pub(crate) struct MeasureContext<'a> {
    raw: &'a [f64],
    x: &'a [f64],
    params: &'a DropletParams,
    raw_noise: f64,
    /// Smoothing half-window; the minimum edge guard of every measured interior.
    guard_base: usize,
}

pub fn normalize_droplet_params(params: &DropletParams) -> DropletParams {
    let min_segment_length = params.min_segment_length.clamp(1, 10_000_000);
    let mut max_segment_length = params.max_segment_length.min(10_000_000);
    if max_segment_length != 0 && max_segment_length < min_segment_length {
        max_segment_length = min_segment_length;
    }
    DropletParams {
        amplitude_bands: params.amplitude_bands.clone(),
        min_segment_length,
        max_segment_length,
        stability_window: odd_window(params.stability_window).min(999),
        edge_trim_fraction: clamp_or(params.edge_trim_fraction, 0.08, 0.0, 0.45),
        outlier_sigma: clamp_or(params.outlier_sigma, 3.0, 1.0, 10.0),
        allow_single_sided_reference: params.allow_single_sided_reference,
        // A centred-median window longer than the shortest segment we want to keep
        // would erase a genuine state, so the despike window is capped by the largest
        // odd window that still fits inside `min_segment_length`.
        despike_window: odd_window(params.despike_window)
            .min(odd_at_most(min_segment_length))
            .max(3),
        despike_sigma: clamp_or(params.despike_sigma, 3.0, 1.0, 10.0),
        noise_factor: clamp_or(params.noise_factor, 6.0, 2.0, 50.0),
        slope_factor: clamp_or(params.slope_factor, 3.0, 1.0, 50.0),
        cluster_separation_factor: clamp_or(params.cluster_separation_factor, 2.5, 0.5, 20.0),
        reference_gap_factor: clamp_or(params.reference_gap_factor, 3.0, 1.0, 20.0),
    }
}

fn clamp_or(value: f64, fallback: f64, minimum: f64, maximum: f64) -> f64 {
    if value.is_finite() {
        value.clamp(minimum, maximum)
    } else {
        fallback
    }
}

pub(crate) fn droplet_detection_key(params: &DropletParams) -> DetectionKey {
    DetectionKey::Droplet {
        despike_window: params.despike_window,
        despike_sigma: params.despike_sigma,
    }
}

/// Build the detection signal: symmetric despike, light Savitzky–Golay smoothing
/// and the (optional) manual baseline shift.
///
/// The manual baseline is subtracted here only: measurements use the untouched raw
/// signal, which is what makes the corrected Δ invariant under a constant offset.
pub(crate) fn build_detection_signal(
    raw: &[f64],
    preprocess: &PreprocessParams,
    params: &DropletParams,
) -> DetectionSignal {
    let preprocess = normalize_preprocess_params(preprocess);
    let despiked = hampel_despike(raw, params.despike_window, params.despike_sigma);
    let raw_noise = adjacent_difference_noise(&despiked);
    let gain = savitzky_golay_noise_gain(
        preprocess.smooth_window,
        preprocess.smooth_order,
        despiked.len(),
    );
    let mut values =
        savitzky_golay_filter(&despiked, preprocess.smooth_window, preprocess.smooth_order);
    for value in &mut values {
        *value -= preprocess.manual_baseline;
    }
    DetectionSignal {
        noise: raw_noise * gain,
        scale: robust_scale(&values),
        values,
    }
}

/// Half-width of the centred stability window, normalised exactly like
/// [`stability_mask`] normalises it. Zero when the record is too short.
fn stability_half(params: &DropletParams, length: usize) -> usize {
    let mut window = params.stability_window.min(length);
    if window.is_multiple_of(2) {
        window = window.saturating_sub(1);
    }
    if window < 3 { 0 } else { window / 2 }
}

/// Local stability mask.
///
/// A sample is stable when the *robust* spread of its centred window and the change
/// between the two half-window medians both stay within a small multiple of the
/// detection noise. Both measures are median based, so a lone spike cannot break a
/// state; both are relative to the noise, so the decision never depends on an
/// absolute amplitude band. The ±half window is simultaneously the guard region that
/// keeps transitions out.
fn stability_mask(detection: &[f64], params: &DropletParams, noise: f64, scale: f64) -> Vec<bool> {
    let length = detection.len();
    let mut mask = vec![false; length];
    let half = stability_half(params, length);
    if half == 0 {
        return mask;
    }
    let window = 2 * half + 1;
    let floor = (1e-12 * scale).max(1e-300);
    let spread_limit = (params.noise_factor * noise).max(floor);
    let trend_limit = (params.slope_factor * noise).max(floor);

    let mut buffer: Vec<f64> = Vec::with_capacity(window);
    let mut deviations: Vec<f64> = Vec::with_capacity(window);
    let mut inliers: Vec<f64> = Vec::with_capacity(window);
    let mut rank: Vec<f64> = Vec::with_capacity(window);
    let mut spread_rank: Vec<f64> = Vec::with_capacity(window);

    for (index, slot) in mask.iter_mut().enumerate() {
        buffer.clear();
        for offset in 0..window {
            let source = reflect_index(index as isize + offset as isize - half as isize, length);
            buffer.push(detection[source]);
        }
        // Trend from the half-window medians: a clean step registers immediately,
        // while a single outlier cannot move a median.
        let left_median = select_nth(&mut buffer[..half], half / 2);
        let right_start = half + 1;
        let right_median = select_nth(&mut buffer[right_start..], (window - right_start) / 2);
        let trend = (right_median - left_median).abs();

        let center = select_nth(&mut buffer, half);
        deviations.clear();
        deviations.extend(buffer.iter().map(|value| (value - center).abs()));
        let local_mad = 1.4826 * percentile_into(&deviations, 50.0, &mut rank);
        inliers.clear();
        if local_mad > floor {
            let limit = WINDOW_OUTLIER_SIGMA * local_mad;
            inliers.extend(
                buffer
                    .iter()
                    .copied()
                    .filter(|value| (value - center).abs() <= limit),
            );
        } else {
            inliers.extend(buffer.iter().copied());
        }
        if inliers.len() < 2 {
            continue;
        }
        let spread = if inliers.len() >= 4 {
            percentile_into(&inliers, 90.0, &mut spread_rank)
                - percentile_into(&inliers, 10.0, &mut spread_rank)
        } else {
            percentile_into(&inliers, 100.0, &mut spread_rank)
                - percentile_into(&inliers, 0.0, &mut spread_rank)
        };
        *slot = spread <= spread_limit && trend <= trend_limit;
    }
    mask
}

/// Turn the stability mask into candidate ranges.
///
/// Only single-sample holes are closed here (a lone rejected sample is noise, not a
/// state boundary). Wider artefacts are left as real gaps and are handled later by
/// `regularize_segment_sequence`, which can compare the measured levels on both sides
/// before merging. Keeping the two responsibilities apart is what makes a wide spike
/// both non-fragmenting *and* unable to hide a genuine state change.
fn detect_stable_ranges(
    detection: &[f64],
    params: &DropletParams,
    noise: f64,
    scale: f64,
) -> Vec<(usize, usize)> {
    if detection.len() < 3 {
        return Vec::new();
    }
    let mask = stability_mask(detection, params, noise, scale);
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in contiguous_ranges(&mask) {
        match merged.last_mut() {
            Some(last) if start.saturating_sub(last.1 + 1) <= MASK_BRIDGE_SAMPLES => {
                last.1 = end;
            }
            _ => merged.push((start, end)),
        }
    }
    merged
        .into_iter()
        .filter(|(start, end)| {
            let length = end - start + 1;
            length >= params.min_segment_length
                && (params.max_segment_length == 0 || length <= params.max_segment_length)
        })
        .collect()
}

/// How many samples to drop from each end of a measured range.
///
/// `guard_base` (the Savitzky–Golay half-window) keeps the smoothing smear out of the
/// interior; `edge_trim_fraction` additionally removes a fixed share of long ranges so
/// a boundary that is slightly off cannot bias the level.
fn edge_guard(context: &MeasureContext<'_>, length: usize) -> usize {
    let requested = context
        .guard_base
        .max((context.params.edge_trim_fraction * length as f64).round() as usize);
    requested.min(length.saturating_sub(2) / 2)
}

/// Measure one stable range on the raw signal: guard the edges, then estimate the
/// level with a median → MAD → robust-mean chain.
///
/// Returns `None` when the interior is unusably short or when the robust spread of
/// the interior proves the range was not actually flat.
fn measure_range(context: &MeasureContext<'_>, start: usize, end: usize) -> Option<StableSegment> {
    let raw = context.raw;
    if end < start || end >= raw.len() || context.x.len() != raw.len() {
        return None;
    }
    let length = end - start + 1;
    let guard = edge_guard(context, length);
    let interior_start = start + guard;
    let interior_end = end - guard;
    if interior_end < interior_start {
        return None;
    }
    let interior = &raw[interior_start..=interior_end];
    let measured = robust_level(interior, context.params.outlier_sigma, context.raw_noise)?;
    let interior_x = &context.x[interior_start..=interior_end];
    let budget =
        (RESIDUAL_SPREAD_SIGMA * context.raw_noise.max(1e-12 * robust_scale(interior))).max(1e-300);
    let spread = measured.spread;
    if context.params.amplitude_bands.is_none() && spread > budget {
        return None;
    }
    let center_index = (start + end) / 2;
    Some(StableSegment {
        number: 0,
        start_index: start,
        end_index: end,
        center_index,
        start: context.x[start],
        end: context.x[end],
        center: context.x[center_index],
        level: measured.level,
        standard_deviation: measured.standard_deviation,
        mad: measured.mad,
        slope: linear_slope(interior_x, interior),
        length,
        effective_length: measured.effective_length,
        kind: SegmentKind::Unknown,
        // Stability score only; the two-state classification multiplies into it.
        confidence: if context.params.amplitude_bands.is_some() {
            1.0
        } else {
            (1.0 - spread / budget).clamp(0.0, 1.0)
        },
    })
}

/// Grow one conservative range back towards the physical state boundary.
///
/// The stability mask only marks a sample once the whole centred window — and the
/// smoothed detection values that window reads — are inside the state, so a detected
/// range is short by up to `smooth_half + stability_half` samples at every boundary.
/// That shortfall is symmetric for a clean step and therefore leaves the segment
/// centre biased whenever one side of the state ends at the record edge.
///
/// Samples are added back one at a time while they still agree with the measured
/// level within the noise budget, so a clean step recovers its exact boundary while a
/// slow transition stops the growth immediately. `limit` is the geometric bound on
/// how much the mask can have lost, and `lower_bound` / `upper_bound` keep the grown
/// range from ever crossing a neighbouring state.
fn grow_range(
    context: &MeasureContext<'_>,
    range: (usize, usize),
    level: f64,
    lower_bound: usize,
    upper_bound: usize,
    limit: usize,
) -> (usize, usize) {
    let tolerance = context.params.outlier_sigma * context.raw_noise.max(0.0);
    let agrees = |index: usize| {
        let value = context.raw[index];
        value.is_finite() && (value - level).abs() <= tolerance
    };
    let mut start = range.0;
    while start > lower_bound && range.0 - start < limit && agrees(start - 1) {
        start -= 1;
    }
    let mut end = range.1;
    while end < upper_bound && end - range.1 < limit && agrees(end + 1) {
        end += 1;
    }
    (start, end)
}

/// Stage 1+2 — locate stable ranges, measure each of them on the raw signal, then
/// recover the samples the stability test systematically loses at state boundaries.
///
/// Both passes measure on the raw signal; the growth decision compares a *raw* sample
/// with the already measured *raw* level, so the detection signal never leaks into a
/// reported physical number.
pub(crate) fn measure_ranges(
    context: &MeasureContext<'_>,
    ranges: impl IntoIterator<Item = (usize, usize)>,
) -> Vec<StableSegment> {
    let mut segments: Vec<StableSegment> = ranges
        .into_iter()
        .filter_map(|(start, end)| measure_range(context, start, end))
        .collect();
    let limit = context.guard_base + stability_half(context.params, context.raw.len());
    if limit > 0 && !segments.is_empty() {
        let last = context.raw.len().saturating_sub(1);
        for index in 0..segments.len() {
            let lower_bound = if index == 0 {
                0
            } else {
                segments[index - 1].end_index + 1
            };
            let upper_bound = if index + 1 == segments.len() {
                last
            } else {
                segments[index + 1].start_index.saturating_sub(1)
            };
            let current = (segments[index].start_index, segments[index].end_index);
            let grown = grow_range(
                context,
                current,
                segments[index].level,
                lower_bound,
                upper_bound,
                limit,
            );
            if grown != current
                && let Some(remeasured) = measure_range(context, grown.0, grown.1)
            {
                segments[index] = remeasured;
            }
        }
    }
    renumber(&mut segments);
    segments
}

fn renumber(segments: &mut [StableSegment]) {
    for (index, segment) in segments.iter_mut().enumerate() {
        segment.number = index + 1;
    }
}

/// Robust dynamic range of a record (p95 − p5).
fn robust_range(values: &[f64]) -> f64 {
    (percentile(values, 95.0) - percentile(values, 5.0)).abs()
}

/// One-dimensional robust two-cluster split of the stable-segment levels.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ClusterModel {
    pub bottom_center: f64,
    pub platform_center: f64,
    pub separation: f64,
    pub within_sigma: f64,
    pub separable: bool,
}

fn weighted_percentile(samples: &mut [(f64, f64)], percentile: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.sort_by(|left, right| left.0.total_cmp(&right.0));
    let total: f64 = samples.iter().map(|(_, weight)| *weight).sum();
    if total <= 0.0 || !total.is_finite() {
        return samples[samples.len() / 2].0;
    }
    let target = total * percentile.clamp(0.0, 100.0) / 100.0;
    let mut cumulative = 0.0;
    for (value, weight) in samples.iter() {
        cumulative += *weight;
        if cumulative >= target {
            return *value;
        }
    }
    samples[samples.len() - 1].0
}

/// Robust two-state classifier over stable-segment levels.
///
/// Lightweight and deterministic: weighted 10 %/90 % percentiles as initial centres,
/// nearest-centre assignment, weighted-median updates.
///
/// The weight is the segment's own *confidence*, never its length. Length weighting
/// looks tempting but is actively harmful here: in a real droplet record the Platform
/// is usually far wider than the Bottom, so a length-weighted update lets the wide
/// state swallow the narrow one. One confidence weight means one vote per segment,
/// with poorly explained segments voting less.
///
/// When the two clusters are not separated relative to the noise, the within-cluster
/// spread and the signal's dynamic range, `separable` stays false and the caller must
/// not invent droplets.
fn classify_dual_states(
    levels: &[f64],
    weights: &[f64],
    params: &DropletParams,
    raw_noise: f64,
    range: f64,
    floor: f64,
) -> ClusterModel {
    if levels.len() < 2 {
        return ClusterModel::default();
    }
    let mut samples: Vec<(f64, f64)> = levels
        .iter()
        .zip(weights)
        .map(|(level, weight)| (*level, weight.max(1e-12)))
        .collect();
    let mut lower = weighted_percentile(&mut samples, 10.0);
    let mut upper = weighted_percentile(&mut samples, 90.0);
    if !lower.is_finite() || !upper.is_finite() {
        return ClusterModel::default();
    }
    if lower > upper {
        std::mem::swap(&mut lower, &mut upper);
    }
    if (upper - lower).abs() <= floor {
        return ClusterModel::default();
    }

    for _ in 0..100 {
        let mut low_members: Vec<(f64, f64)> = Vec::new();
        let mut high_members: Vec<(f64, f64)> = Vec::new();
        for (level, weight) in levels.iter().zip(weights) {
            if (level - lower).abs() <= (level - upper).abs() {
                low_members.push((*level, weight.max(1e-12)));
            } else {
                high_members.push((*level, weight.max(1e-12)));
            }
        }
        if low_members.is_empty() || high_members.is_empty() {
            return ClusterModel::default();
        }
        let next_lower = weighted_percentile(&mut low_members, 50.0);
        let next_upper = weighted_percentile(&mut high_members, 50.0);
        let movement = (next_lower - lower).abs() + (next_upper - upper).abs();
        lower = next_lower;
        upper = next_upper;
        if movement <= 1e-12 * (1.0 + lower.abs() + upper.abs()) {
            break;
        }
    }
    if lower > upper {
        std::mem::swap(&mut lower, &mut upper);
    }

    let low_values: Vec<f64> = levels
        .iter()
        .filter(|level| (**level - lower).abs() <= (**level - upper).abs())
        .copied()
        .collect();
    let high_values: Vec<f64> = levels
        .iter()
        .filter(|level| (**level - lower).abs() > (**level - upper).abs())
        .copied()
        .collect();
    if low_values.is_empty() || high_values.is_empty() {
        return ClusterModel::default();
    }
    let within_sigma = scaled_mad(&low_values, lower).max(scaled_mad(&high_values, upper));
    let separation = (upper - lower).abs();
    let noise_scale = within_sigma.max(raw_noise).max(floor);
    let separable = separation > params.cluster_separation_factor * noise_scale
        && separation >= SEPARATION_DYNAMIC_FRACTION * range;

    ClusterModel {
        bottom_center: lower,
        platform_center: upper,
        separation,
        within_sigma,
        separable,
    }
}

fn classify_segment(segment: &mut StableSegment, clusters: &ClusterModel, floor: f64) {
    let scale = (0.5 * clusters.separation)
        .max(3.0 * clusters.within_sigma)
        .max(floor)
        .max(1e-300);
    let bottom_distance = (segment.level - clusters.bottom_center).abs();
    let platform_distance = (segment.level - clusters.platform_center).abs();
    let nearest = bottom_distance.min(platform_distance);
    let classification = (1.0 - nearest / scale).clamp(0.0, 1.0);
    // A level sitting half-way between the states is evidence of a transition or a
    // drift artefact, not of a state: it becomes Unknown instead of a fake droplet.
    segment.kind = if classification < UNKNOWN_CONFIDENCE_THRESHOLD {
        SegmentKind::Unknown
    } else if platform_distance <= bottom_distance {
        SegmentKind::Platform
    } else {
        SegmentKind::Bottom
    };
    segment.confidence = (segment.confidence * classification).clamp(0.0, 1.0);
}

fn apply_classification(segments: &mut [StableSegment], clusters: &ClusterModel, floor: f64) {
    for segment in segments.iter_mut() {
        classify_segment(segment, clusters, floor);
    }
}

/// Stage 4 — sequence regularisation.
///
/// Only structural repairs are allowed: two adjacent segments of the *same* kind
/// separated by a short gap and by an almost identical level are merged. Nothing is
/// ever paired by segment parity, and an unrecognised structure stays `Unknown`
/// instead of being reshaped into a nicer alternating pattern.
fn regularize_segment_sequence(
    context: &MeasureContext<'_>,
    segments: &mut Vec<StableSegment>,
    clusters: &ClusterModel,
    floor: f64,
) {
    let merge_gap = (MERGE_GAP_WINDOWS * context.params.stability_window).max(3);
    let merge_tolerance = (0.25 * clusters.separation)
        .max(2.0 * clusters.within_sigma)
        .max(floor);
    let mut merged: Vec<StableSegment> = Vec::with_capacity(segments.len());
    for segment in segments.drain(..) {
        let mut accepted = false;
        if let Some(last) = merged.last_mut() {
            let same_state = last.kind == segment.kind && last.kind != SegmentKind::Unknown;
            let gap = segment.start_index.saturating_sub(last.end_index + 1);
            let level_gap = (last.level - segment.level).abs();
            if same_state && gap <= merge_gap && level_gap <= merge_tolerance {
                accepted = try_merge(context, last, &segment, merge_tolerance);
            }
        }
        if !accepted {
            merged.push(segment);
        }
    }
    for segment in &mut merged {
        classify_segment(segment, clusters, floor);
    }
    *segments = merged;
    renumber(segments);
}

/// Merge `next` into `last` when the intervening gap behaves like an artefact.
///
/// The merged interior must keep the same level (|Δ| within `merge_tolerance`) and
/// must be at least `MERGE_INLIER_RATIO` inliers after MAD clipping — a real opposite
/// state inside the gap could not satisfy both.
fn try_merge(
    context: &MeasureContext<'_>,
    last: &mut StableSegment,
    next: &StableSegment,
    merge_tolerance: f64,
) -> bool {
    let start = last.start_index;
    let end = next.end_index;
    let length = end - start + 1;
    let guard = edge_guard(context, length);
    let interior_start = start + guard;
    let interior_end = end - guard;
    if interior_end < interior_start {
        return false;
    }
    let interior = &context.raw[interior_start..=interior_end];
    let Some(measured) = robust_level(interior, context.params.outlier_sigma, context.raw_noise)
    else {
        return false;
    };
    let inlier_ratio = measured.effective_length as f64 / interior.len().max(1) as f64;
    if inlier_ratio < MERGE_INLIER_RATIO {
        return false;
    }
    if (measured.level - last.level).abs() > merge_tolerance
        || (measured.level - next.level).abs() > merge_tolerance
    {
        return false;
    }
    let center_index = (start + end) / 2;
    *last = StableSegment {
        number: last.number,
        start_index: start,
        end_index: end,
        center_index,
        start: context.x[start],
        end: context.x[end],
        center: context.x[center_index],
        level: measured.level,
        standard_deviation: measured.standard_deviation,
        mad: measured.mad,
        slope: linear_slope(&context.x[interior_start..=interior_end], interior),
        length,
        effective_length: measured.effective_length,
        kind: last.kind,
        confidence: last.confidence.min(next.confidence),
    };
    true
}

fn nearest_low(segments: &[StableSegment], from: usize, forward: bool) -> Option<usize> {
    if forward {
        (from + 1..segments.len()).find(|index| segments[*index].kind == SegmentKind::Bottom)
    } else {
        (0..from)
            .rev()
            .find(|index| segments[*index].kind == SegmentKind::Bottom)
    }
}

fn push_flag(flags: &mut Vec<QualityFlag>, flag: QualityFlag) {
    if !flags.contains(&flag) {
        flags.push(flag);
    }
}

/// Low baseline at a high segment's center between two low levels.
///
/// ```text
/// reference = left + (right − left) · (t_high − t_left) / (t_right − t_left)
/// ```
///
/// `t` values are segment centre coordinates: the real time column when the dataset
/// has one, sample indices otherwise. Returns `None` when the axis cannot express the
/// interval (non-finite or non-increasing), so the caller can fall back instead of
/// dividing by zero. A high outside the time bracket also refuses real-time
/// interpolation; the caller then uses flagged sample-index interpolation.
fn interpolate_reference(
    left_level: f64,
    left_t: f64,
    right_level: f64,
    right_t: f64,
    high_t: f64,
) -> Option<f64> {
    let denominator = right_t - left_t;
    if !denominator.is_finite() || denominator <= 0.0 {
        return None;
    }
    if !high_t.is_finite() || high_t < left_t || high_t > right_t {
        return None;
    }
    let ratio = (high_t - left_t) / denominator;
    let reference = left_level + (right_level - left_level) * ratio;
    reference.is_finite().then_some(reference)
}

/// Stage 5 — associate every high with neighbouring low baseline references and
/// compute the locally corrected signal.
fn build_measurements(
    segments: &[StableSegment],
    x: &[f64],
    params: &DropletParams,
    raw_noise: f64,
    has_real_time: bool,
    floor: f64,
) -> (Vec<DropletMeasurement>, Vec<String>, usize) {
    let mut warnings = Vec::new();
    let mut measurements = Vec::new();
    let mut skipped = 0usize;

    // Robust typical spacing between neighbouring stable segments: the yardstick for
    // "is this low actually adjacent, or a leftover from a missing region?".
    let mut gaps: Vec<f64> = Vec::new();
    for pair in segments.windows(2) {
        let distance = (x[pair[1].center_index] - x[pair[0].center_index]).abs();
        if distance > 0.0 && distance.is_finite() {
            gaps.push(distance);
        }
    }
    let span = match (x.first(), x.last()) {
        (Some(first), Some(last)) => (last - first).abs(),
        _ => 0.0,
    };
    let typical = if gaps.is_empty() {
        (span / segments.len().max(1) as f64).max(1.0)
    } else {
        median(&gaps).max(1e-12)
    };
    let soft_gap = params.reference_gap_factor * typical;
    let hard_gap = 2.0 * soft_gap;

    for (position, high) in segments.iter().enumerate() {
        if high.kind != SegmentKind::Platform {
            continue;
        }
        let left_position = nearest_low(segments, position, false);
        let right_position = nearest_low(segments, position, true);
        let high_x = x[high.center_index];
        let left_distance =
            left_position.map(|index| (high_x - x[segments[index].center_index]).abs());
        let right_distance =
            right_position.map(|index| (high_x - x[segments[index].center_index]).abs());

        let mut flags: Vec<QualityFlag> = Vec::new();
        let mut too_far = false;
        for distance in [left_distance, right_distance].into_iter().flatten() {
            if distance > soft_gap {
                too_far = true;
            }
        }
        let usable_left = left_position.filter(|_| left_distance.is_some_and(|d| d <= hard_gap));
        let usable_right = right_position.filter(|_| right_distance.is_some_and(|d| d <= hard_gap));
        // A reference that exists but was dropped for distance is exactly the danger
        // case: silently pairing across a missing region.
        if (left_position.is_some() && usable_left.is_none())
            || (right_position.is_some() && usable_right.is_none())
        {
            too_far = true;
        }
        if too_far {
            push_flag(&mut flags, QualityFlag::LargeReferenceGap);
        }

        // Every branch either yields the baseline triple or skips this high.
        let resolved: Option<(Option<usize>, Option<usize>, ReferenceMode, f64)> =
            match (usable_left, usable_right) {
                (Some(left_index), Some(right_index)) => {
                    let left = &segments[left_index];
                    let right = &segments[right_index];
                    let mut t_left = x[left.center_index];
                    let mut t_right = x[right.center_index];
                    let mut t_high = high_x;
                    let mut reference =
                        interpolate_reference(left.level, t_left, right.level, t_right, t_high);
                    if reference.is_none() {
                        // Real x is unavailable or not usable for interpolation: fall
                        // back to sample positions instead of dividing by zero.
                        push_flag(&mut flags, QualityFlag::IndexTimeFallback);
                        t_left = left.center_index as f64;
                        t_right = right.center_index as f64;
                        t_high = high.center_index as f64;
                        reference =
                            interpolate_reference(left.level, t_left, right.level, t_right, t_high);
                    }
                    match reference {
                        Some(reference) => Some((
                            Some(left_index),
                            Some(right_index),
                            ReferenceMode::Interpolated,
                            reference,
                        )),
                        None => {
                            // Degenerate geometry: take the nearer low rather than
                            // extrapolating from an unreliable axis.
                            if !params.allow_single_sided_reference {
                                skipped += 1;
                                continue;
                            }
                            push_flag(&mut flags, QualityFlag::SingleSidedReference);
                            if (t_high - t_left).abs() <= (t_right - t_high).abs() {
                                Some((Some(left_index), None, ReferenceMode::LeftOnly, left.level))
                            } else {
                                Some((
                                    None,
                                    Some(right_index),
                                    ReferenceMode::RightOnly,
                                    right.level,
                                ))
                            }
                        }
                    }
                }
                (Some(left_index), None) => {
                    if !params.allow_single_sided_reference {
                        skipped += 1;
                        continue;
                    }
                    push_flag(&mut flags, QualityFlag::SingleSidedReference);
                    Some((
                        Some(left_index),
                        None,
                        ReferenceMode::LeftOnly,
                        segments[left_index].level,
                    ))
                }
                (None, Some(right_index)) => {
                    if !params.allow_single_sided_reference {
                        skipped += 1;
                        continue;
                    }
                    push_flag(&mut flags, QualityFlag::SingleSidedReference);
                    Some((
                        None,
                        Some(right_index),
                        ReferenceMode::RightOnly,
                        segments[right_index].level,
                    ))
                }
                (None, None) => {
                    skipped += 1;
                    continue;
                }
            };
        let Some((left_segment, right_segment, mode, reference)) = resolved else {
            skipped += 1;
            continue;
        };

        let left = left_segment.map(|index| &segments[index]);
        let right = right_segment.map(|index| &segments[index]);
        let noisy_low = left.is_some_and(|s| s.mad > NOISY_SEGMENT_SIGMA * raw_noise.max(floor))
            || right.is_some_and(|s| s.mad > NOISY_SEGMENT_SIGMA * raw_noise.max(floor));
        if noisy_low {
            push_flag(&mut flags, QualityFlag::NoisyBottom);
        }
        if high.mad > NOISY_SEGMENT_SIGMA * raw_noise.max(floor) {
            push_flag(&mut flags, QualityFlag::NoisyPlatform);
        }

        // An unrecognised stable structure inside the reference span means the local
        // drift correction rests on a region we did not model.
        let span_low = left.map_or(high.number, |s| s.number.min(high.number));
        let span_high = right.map_or(high.number, |s| s.number.max(high.number));
        let has_unknown_inside = segments.iter().any(|segment| {
            segment.kind == SegmentKind::Unknown
                && segment.number >= span_low
                && segment.number <= span_high
        });
        if has_unknown_inside {
            push_flag(&mut flags, QualityFlag::NearbyUnknownSegment);
        }

        let reference_factor = match mode {
            ReferenceMode::Interpolated => 1.0,
            ReferenceMode::LeftOnly | ReferenceMode::RightOnly => 0.6,
            ReferenceMode::None => 0.0,
        };
        let worst = left
            .map(|s| (high_x - x[s.center_index]).abs())
            .into_iter()
            .chain(right.map(|s| (high_x - x[s.center_index]).abs()))
            .fold(0.0_f64, f64::max);
        let gap_factor = if worst <= soft_gap || hard_gap <= soft_gap {
            1.0
        } else {
            1.0 - 0.5 * ((worst - soft_gap) / (hard_gap - soft_gap)).clamp(0.0, 1.0)
        };
        let mut confidence = high.confidence;
        if let Some(segment) = left {
            confidence = confidence.min(segment.confidence);
        }
        if let Some(segment) = right {
            confidence = confidence.min(segment.confidence);
        }
        confidence = (confidence * reference_factor * gap_factor).clamp(0.0, 1.0);
        if confidence < LOW_CONFIDENCE_THRESHOLD {
            push_flag(&mut flags, QualityFlag::LowClassificationConfidence);
        }
        flags.sort_unstable();
        flags.dedup();

        measurements.push(DropletMeasurement {
            number: 0,
            high_segment: high.number,
            left_low_segment: left.map(|s| s.number),
            right_low_segment: right.map(|s| s.number),
            center_index: high.center_index,
            center: high_x,
            high_level: high.level,
            left_low_level: left.map(|s| s.level),
            right_low_level: right.map(|s| s.level),
            baseline_reference: reference,
            corrected_signal: high.level - reference,
            reference_mode: mode,
            confidence,
            quality_flags: flags,
        });
    }

    for (index, measurement) in measurements.iter_mut().enumerate() {
        measurement.number = index + 1;
    }
    if skipped > 0 {
        warnings.push(format!(
            "{skipped} 个高平台缺少可用的低平台基线，已跳过这些测量。"
        ));
    }
    let single = measurements
        .iter()
        .filter(|m| m.reference_mode != ReferenceMode::Interpolated)
        .count();
    if single > 0 {
        warnings.push(format!(
            "{single} 个高平台仅使用单侧低平台基线（未插值），已按较低规则评分输出。"
        ));
    }
    if !has_real_time {
        warnings.push("当前数据没有时间列，x 轴使用数据点序号；局部插值按序号间距进行。".into());
    }
    (measurements, warnings, skipped)
}

fn droplet_statistics(
    measurements: &[DropletMeasurement],
    segments: &[StableSegment],
) -> DropletStatistics {
    let unknown_segment_count = segments
        .iter()
        .filter(|segment| segment.kind == SegmentKind::Unknown)
        .count();
    let lengths: Vec<f64> = segments
        .iter()
        .filter(|segment| segment.kind == SegmentKind::Platform)
        .map(|segment| segment.length as f64)
        .collect();
    let mean_length = (!lengths.is_empty()).then(|| mean(&lengths));
    let length_standard_deviation = (!lengths.is_empty()).then(|| standard_deviation(&lengths));
    let length_rsd = mean_length
        .filter(|average| *average > 0.0)
        .zip(length_standard_deviation)
        .map(|(average, deviation)| deviation / average * 100.0);
    if measurements.is_empty() {
        return DropletStatistics {
            unknown_segment_count,
            mean_length,
            length_standard_deviation,
            length_rsd,
            ..Default::default()
        };
    }
    let corrected: Vec<f64> = measurements.iter().map(|m| m.corrected_signal).collect();
    let highs: Vec<f64> = measurements.iter().map(|m| m.high_level).collect();
    let references: Vec<f64> = measurements.iter().map(|m| m.baseline_reference).collect();
    let average = mean(&corrected);
    let deviation = standard_deviation(&corrected);
    DropletStatistics {
        droplet_count: measurements.len(),
        mean_corrected_signal: Some(average),
        min_corrected_signal: corrected.iter().copied().reduce(f64::min),
        max_corrected_signal: corrected.iter().copied().reduce(f64::max),
        standard_deviation: Some(deviation),
        rsd: Some(if average == 0.0 {
            0.0
        } else {
            deviation / average * 100.0
        }),
        mean_high: Some(mean(&highs)),
        mean_baseline: Some(mean(&references)),
        mean_length,
        length_standard_deviation,
        length_rsd,
        interpolated_count: measurements
            .iter()
            .filter(|m| m.reference_mode == ReferenceMode::Interpolated)
            .count(),
        single_sided_count: measurements
            .iter()
            .filter(|m| {
                matches!(
                    m.reference_mode,
                    ReferenceMode::LeftOnly | ReferenceMode::RightOnly
                )
            })
            .count(),
        low_confidence_count: measurements
            .iter()
            .filter(|m| m.confidence < LOW_CONFIDENCE_THRESHOLD)
            .count(),
        unknown_segment_count,
    }
}

/// Run the full droplet pipeline on one dataset.
///
/// `smooth_half` is the Savitzky–Golay half-window of the detection signal; it sets
/// the minimum edge guard so no measured interior can contain transition contamination.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_droplet(
    raw: &[f64],
    x: &[f64],
    detection: &[f64],
    noise: f64,
    scale: f64,
    params: &DropletParams,
    has_real_time: bool,
    smooth_half: usize,
) -> DropletAnalysis {
    let empty = |warnings: Vec<String>| DropletAnalysis {
        segments: Vec::new(),
        measurements: Vec::new(),
        statistics: DropletStatistics::default(),
        warnings,
    };
    if raw.len() != detection.len() || x.len() != detection.len() || detection.len() < 3 {
        return empty(vec!["数据点过少，无法进行液滴双电平分析。".into()]);
    }
    let raw_noise = adjacent_difference_noise(raw);
    let floor = (1e-12 * scale).max(1e-300);
    let context = MeasureContext {
        raw,
        x,
        params,
        raw_noise,
        guard_base: smooth_half.max(1),
    };

    if let Some(bands) = &params.amplitude_bands {
        let mut segments = Vec::new();
        for (kind, lower, upper) in [
            (SegmentKind::Bottom, bands.low_min, bands.low_max),
            (SegmentKind::Platform, bands.high_min, bands.high_max),
        ] {
            let mask: Vec<bool> = detection
                .iter()
                .map(|v| *v >= lower && *v <= upper)
                .collect();
            for (start, end) in contiguous_ranges(&mask) {
                let length = end - start + 1;
                if length < params.min_segment_length
                    || (params.max_segment_length > 0 && length > params.max_segment_length)
                {
                    continue;
                }
                if let Some(mut segment) = measure_range(&context, start, end) {
                    segment.kind = kind;
                    segments.push(segment);
                }
            }
        }
        segments.sort_by_key(|s| s.start_index);
        for (i, segment) in segments.iter_mut().enumerate() {
            segment.number = i + 1;
        }
        let (measurements, mut warnings, _) =
            build_measurements(&segments, x, params, raw_noise, has_real_time, floor);
        if measurements.is_empty() {
            warnings.push(
                "指定幅度区间内没有可配对的高低平台，请检查区间、横坐标范围和最小长度。".into(),
            );
        }
        let statistics = droplet_statistics(&measurements, &segments);
        return DropletAnalysis {
            segments,
            measurements,
            statistics,
            warnings,
        };
    }

    let ranges = detect_stable_ranges(detection, params, noise, scale);
    let mut segments = measure_ranges(&context, ranges);
    if segments.is_empty() {
        return empty(vec![
            "未检测到任何稳定区段，请检查数据质量或调整稳定性窗口／最小长度。".into(),
        ]);
    }

    let levels: Vec<f64> = segments.iter().map(|segment| segment.level).collect();
    // One vote per segment, scaled by how well that segment is explained.
    let weights: Vec<f64> = segments
        .iter()
        .map(|segment| segment.confidence.max(0.05))
        .collect();
    let clusters = classify_dual_states(
        &levels,
        &weights,
        params,
        raw_noise,
        robust_range(raw),
        floor,
    );
    if !clusters.separable {
        for segment in &mut segments {
            segment.kind = SegmentKind::Unknown;
            segment.confidence = 0.0;
        }
        let statistics = droplet_statistics(&[], &segments);
        return DropletAnalysis {
            segments,
            measurements: Vec::new(),
            statistics,
            warnings: vec![
                "当前稳定区段无法可靠分成高／低两个状态，请检查数据或调整检测参数。".into(),
            ],
        };
    }
    apply_classification(&mut segments, &clusters, floor);
    regularize_segment_sequence(&context, &mut segments, &clusters, floor);

    let (measurements, warnings, _skipped) =
        build_measurements(&segments, x, params, raw_noise, has_real_time, floor);
    let statistics = droplet_statistics(&measurements, &segments);
    DropletAnalysis {
        segments,
        measurements,
        statistics,
        warnings,
    }
}

/// Suggest droplet parameters from the data itself.
///
/// The stability window comes from the detected stable-run lengths and the length
/// bounds from the run-length distribution. Returns `ok = false` whenever two states
/// cannot be told apart, instead of fabricating plausible-looking numbers.
pub fn suggest_droplet_parameters(
    signal: &[f64],
    preprocess: &PreprocessParams,
) -> ParameterSuggestion {
    let defaults = DropletParams::default();
    let detection = build_detection_signal(signal, preprocess, &defaults);
    if detection.values.len() < 40 {
        return ParameterSuggestion {
            ok: false,
            message: "数据点过少，无法自动建议液滴分析参数。".into(),
            plateau: None,
            droplet: None,
        };
    }
    let smooth_half = (normalize_preprocess_params(preprocess).smooth_window / 2).max(1);
    let x: Vec<f64> = (0..detection.values.len())
        .map(|index| index as f64)
        .collect();
    let context = MeasureContext {
        raw: signal,
        x: &x,
        params: &defaults,
        raw_noise: adjacent_difference_noise(signal),
        guard_base: smooth_half,
    };
    let ranges = detect_stable_ranges(
        &detection.values,
        &defaults,
        detection.noise,
        detection.scale,
    );
    let segments = measure_ranges(&context, ranges);
    if segments.len() < 2 {
        return ParameterSuggestion {
            ok: false,
            message: "未检测到足够的稳定区段，请检查数据或调整平滑参数。".into(),
            plateau: None,
            droplet: None,
        };
    }
    let floor = (1e-12 * detection.scale).max(1e-300);
    let levels: Vec<f64> = segments.iter().map(|segment| segment.level).collect();
    let weights: Vec<f64> = segments
        .iter()
        .map(|segment| segment.confidence.max(0.05))
        .collect();
    let clusters = classify_dual_states(
        &levels,
        &weights,
        &defaults,
        context.raw_noise,
        robust_range(signal),
        floor,
    );
    if !clusters.separable {
        return ParameterSuggestion {
            ok: false,
            message:
                "当前稳定区段无法可靠分成高／低两个状态，未生成建议参数；请检查数据质量或改用平台检测。"
                    .into(),
            plateau: None,
            droplet: None,
        };
    }

    let lengths: Vec<f64> = segments
        .iter()
        .map(|segment| segment.length as f64)
        .collect();
    let shortest = lengths.iter().copied().reduce(f64::min).unwrap_or(8.0);
    let longest = lengths.iter().copied().reduce(f64::max).unwrap_or(100.0);
    let stability_window = odd_window((shortest / 2.0).round().max(5.0) as usize).min(51);
    let min_segment_length = (shortest / 2.0).round().max(4.0) as usize;
    let max_segment_length = (longest * 2.0).round().max(min_segment_length as f64) as usize;

    ParameterSuggestion {
        ok: true,
        message: format!(
            "已根据检测到的高／低稳定状态自动填写参数：两状态间距约 {:.6}，稳定区段 {} 个。",
            clusters.separation,
            segments.len()
        ),
        plateau: None,
        droplet: Some(normalize_droplet_params(&DropletParams {
            min_segment_length,
            max_segment_length,
            stability_window,
            ..defaults
        })),
    }
}

#[cfg(test)]
mod tests {
    use crate::analyzer::analyze_dataset;
    use crate::analyzer::test_support::{dataset, dataset_with_time};
    use crate::models::{AnalysisMode, AnalysisRequest, DetectionKey};

    use super::*;

    const PLATFORM: f64 = 0.0348;
    const BOTTOM: f64 = 0.0006169;
    const DELTA: f64 = PLATFORM - BOTTOM;

    /// Deterministic pseudo-noise. Identical on every machine and every run, so the
    /// tolerances below are stable without pulling in a random-number dependency.
    fn pseudo_noise(index: usize, amplitude: f64) -> f64 {
        ((index * 7919 % 1009) as f64 / 1009.0 - 0.5) * amplitude
    }

    fn sections_waveform(sections: &[(f64, usize)], noise: f64) -> Vec<f64> {
        let mut signal = Vec::new();
        for (level, length) in sections {
            for _ in 0..*length {
                let index = signal.len();
                signal.push(*level + pseudo_noise(index, noise));
            }
        }
        signal
    }

    /// `Bottom / Platform` repeated `cycles` times, closed by one more Bottom.
    fn repeating_waveform(
        cycles: usize,
        platform_len: usize,
        bottom_len: usize,
        noise: f64,
    ) -> Vec<f64> {
        let mut sections = Vec::new();
        for _ in 0..cycles {
            sections.push((BOTTOM, bottom_len));
            sections.push((PLATFORM, platform_len));
        }
        sections.push((BOTTOM, bottom_len));
        sections_waveform(&sections, noise)
    }

    fn narrow_params() -> DropletParams {
        DropletParams {
            stability_window: 5,
            min_segment_length: 3,
            edge_trim_fraction: 0.0,
            ..DropletParams::default()
        }
    }

    fn droplet_request(droplet: DropletParams) -> AnalysisRequest {
        AnalysisRequest {
            mode: AnalysisMode::Droplet,
            preprocess: PreprocessParams {
                clipping_percentile: 100.0,
                ..PreprocessParams::default()
            },
            droplet,
            ..AnalysisRequest::default()
        }
    }

    fn analyze_with(signal: Vec<f64>, droplet: DropletParams) -> DropletAnalysis {
        let (result, _) = analyze_dataset(&dataset(signal), &droplet_request(droplet), None);
        DropletAnalysis {
            segments: result.stable_segments,
            measurements: result.droplet_measurements,
            statistics: result.droplet_statistics,
            warnings: result.warnings,
        }
    }

    fn analyze(signal: Vec<f64>) -> DropletAnalysis {
        analyze_with(signal, DropletParams::default())
    }

    /// Lower-state mean over a record: the naive single global reference a user would
    /// otherwise pick, kept here purely as a control comparison.
    fn low_mean(signal: &[f64]) -> f64 {
        let low: Vec<f64> = signal
            .iter()
            .copied()
            .filter(|value| *value < 0.02)
            .collect();
        low.iter().sum::<f64>() / low.len() as f64
    }

    fn assert_close(actual: f64, expected: f64, tolerance: f64, context: &str) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{context}: expected {expected}, received {actual} (tolerance {tolerance})"
        );
    }

    // ---------------------------------------------------------------- §48 example

    #[test]
    fn documented_interpolation_example_is_reproduced_exactly() {
        // Low-left 0.0005 at t=100; low-right 0.001 at t=200; high at t=150.
        let reference = interpolate_reference(0.0005, 100.0, 0.001, 200.0, 150.0).unwrap();
        assert_close(reference, 0.00075, 1e-15, "documented reference");
        assert_close(0.0348 - reference, 0.03405, 1e-12, "documented corrected Δ");
        // An axis that cannot express the interval must refuse instead of dividing.
        assert!(interpolate_reference(0.0348, 100.0, 0.0343, 100.0, 150.0).is_none());
        assert!(interpolate_reference(0.0348, 200.0, 0.0343, 100.0, 150.0).is_none());

        // Then the same geometry end to end: low A at 100, high B at 150, low C at 200.
        // A leading ramp keeps
        // the record honest without producing a segment of its own.
        // Binary-exact levels isolate pairing from zero-noise rounding at boundaries.
        let mut signal: Vec<f64> = (0..60)
            .map(|i| -0.03 + (0.03 + 1.0 / 1024.0) * i as f64 / 60.0)
            .collect();
        signal.extend(vec![1.0 / 1024.0; 81]); // 60..=140 -> centre 100
        signal.extend(vec![0.03125; 19]); // 141..=159 -> centre 150
        signal.extend(vec![1.0 / 512.0; 81]); // 160..=240 -> centre 200
        let request = AnalysisRequest {
            mode: AnalysisMode::Droplet,
            preprocess: PreprocessParams {
                smooth_window: 5,
                smooth_order: 3,
                clipping_percentile: 100.0,
                ..PreprocessParams::default()
            },
            droplet: narrow_params(),
            ..AnalysisRequest::default()
        };
        let (result, _) = analyze_dataset(&dataset(signal), &request, None);
        let segments = &result.stable_segments;
        assert_eq!(segments.len(), 3, "{segments:#?}");
        assert_eq!(segments[0].kind, SegmentKind::Bottom);
        assert_eq!(segments[1].kind, SegmentKind::Platform);
        assert_eq!(segments[2].kind, SegmentKind::Bottom);
        for (segment, centre) in segments.iter().zip([100usize, 150, 200]) {
            assert_eq!(segment.center_index, centre, "{segments:#?}");
        }
        assert_close(segments[0].level, 1.0 / 1024.0, 1e-12, "Low A level");
        assert_close(segments[1].level, 0.03125, 1e-12, "High B level");
        assert_close(segments[2].level, 1.0 / 512.0, 1e-12, "Low C level");

        assert_eq!(result.droplet_measurements.len(), 1);
        let measurement = &result.droplet_measurements[0];
        assert_eq!(measurement.left_low_segment, Some(1));
        assert_eq!(measurement.right_low_segment, Some(3));
        assert_eq!(measurement.reference_mode, ReferenceMode::Interpolated);
        assert_eq!(measurement.high_segment, 2);
        assert_close(
            measurement.baseline_reference,
            0.00146484375,
            1e-12,
            "reference",
        );
        assert_close(
            measurement.corrected_signal,
            0.02978515625,
            1e-9,
            "corrected Δ",
        );
    }

    // ------------------------------------------------------- §17 offset invariance

    #[test]
    fn corrected_signal_is_invariant_under_a_constant_offset() {
        let base = repeating_waveform(4, 140, 70, 0.0012);
        let offset = 1234.5;
        let shifted: Vec<f64> = base.iter().map(|value| value + offset).collect();
        let negative: Vec<f64> = base.iter().map(|value| value - 7.25).collect();

        let first = analyze(base);
        let second = analyze(shifted);
        let third = analyze(negative);

        assert_eq!(first.measurements.len(), 4);
        assert_eq!(second.measurements.len(), first.measurements.len());
        assert_eq!(third.measurements.len(), first.measurements.len());
        for index in 0..first.measurements.len() {
            let reference = first.measurements[index].corrected_signal;
            assert_close(
                second.measurements[index].corrected_signal,
                reference,
                1e-9,
                "offset +1234.5",
            );
            assert_close(
                third.measurements[index].corrected_signal,
                reference,
                1e-9,
                "offset -7.25",
            );
        }
    }

    #[test]
    fn manual_baseline_changes_detection_but_not_the_corrected_signal() {
        let signal = repeating_waveform(3, 140, 70, 0.0012);
        let mut request = droplet_request(DropletParams::default());
        let (plain, _) = analyze_dataset(&dataset(signal.clone()), &request, None);

        request.preprocess.manual_baseline = 0.75;
        let (shifted, _) = analyze_dataset(&dataset(signal), &request, None);

        assert!(!plain.droplet_measurements.is_empty());
        assert_eq!(
            plain.droplet_measurements.len(),
            shifted.droplet_measurements.len()
        );
        for (left, right) in plain
            .droplet_measurements
            .iter()
            .zip(&shifted.droplet_measurements)
        {
            assert_close(
                right.corrected_signal,
                left.corrected_signal,
                1e-9,
                "manual baseline invariance",
            );
        }
    }

    // ------------------------------------------------------------ §18 slow drift

    #[test]
    fn two_sided_interpolation_cancels_linear_drift() {
        // Platform drifts 0.030 → 0.040 while the Bottom keeps a fixed true Δ; a
        // global Platform mean cannot follow that, local interpolation can.
        const TRUE_DELTA: f64 = 0.0339;
        let cycles = 6;
        let platform_len = 150;
        let bottom_len = 80;
        let total = (platform_len + bottom_len) * cycles + platform_len;
        let mut signal: Vec<f64> = Vec::with_capacity(total);
        for cycle in 0..cycles {
            for offset in 0..platform_len {
                let index = cycle * (platform_len + bottom_len) + offset;
                let drift = 0.030 + 0.010 * index as f64 / (total - 1) as f64;
                signal.push(drift + pseudo_noise(index, 0.0012));
            }
            for offset in 0..bottom_len {
                let index = cycle * (platform_len + bottom_len) + platform_len + offset;
                let drift = 0.030 + 0.010 * index as f64 / (total - 1) as f64;
                signal.push(drift - TRUE_DELTA + pseudo_noise(index, 0.0012));
            }
        }
        for offset in 0..platform_len {
            let index = cycles * (platform_len + bottom_len) + offset;
            let drift = 0.030 + 0.010 * index as f64 / (total - 1) as f64;
            signal.push(drift + pseudo_noise(index, 0.0012));
        }

        // Reflect the legacy drift fixture: low baseline drifts, high state is baseline + Δ.
        let signal: Vec<f64> = signal.into_iter().map(|v| 0.04 - v).collect();
        let analysis = analyze(signal.clone());
        assert_eq!(
            analysis.measurements.len(),
            cycles,
            "each high must still be paired: {:?}",
            analysis.warnings
        );
        let mut worst_interpolated = 0.0_f64;
        let mut worst_global_mean = 0.0_f64;
        let global_reference = low_mean(&signal);
        for measurement in &analysis.measurements {
            assert_eq!(measurement.reference_mode, ReferenceMode::Interpolated);
            worst_interpolated =
                worst_interpolated.max((measurement.corrected_signal - TRUE_DELTA).abs());
            worst_global_mean = worst_global_mean
                .max((measurement.high_level - global_reference - TRUE_DELTA).abs());
        }
        // Interpolation tracks the drift; the fixed global mean does not.
        assert!(
            worst_interpolated < 2e-3,
            "interpolated error {worst_interpolated}"
        );
        assert!(
            worst_global_mean > 5.0 * worst_interpolated,
            "the control comparison must be clearly worse: global {worst_global_mean} vs local {worst_interpolated}"
        );
    }

    // ---------------------------------------------------------- §19 spike robustness

    #[test]
    fn positive_and_negative_spikes_do_not_break_segments_or_levels() {
        // Sections: P[0,150) B[150,230) P[230,310) B[310,390) P[390,470) B[470,550)
        //           P[550,690) B[690,770) P[770,920)
        let mut signal = repeating_waveform(4, 150, 80, 0.0012);
        let count = signal.len();
        // Interior spikes in both states and both polarities, plus transition spikes.
        for (position, delta) in [
            (180usize, 9.0),
            (260, -9.0),
            (340, 6.0),
            (420, -6.0),
            (151, 12.0),
            (311, -12.0),
        ] {
            signal[position % count] += delta;
        }
        let analysis = analyze(signal);
        assert_eq!(
            analysis.measurements.len(),
            4,
            "spikes must not fragment states: {:#?}",
            analysis.segments
        );
        for measurement in &analysis.measurements {
            assert_close(
                measurement.corrected_signal,
                DELTA,
                3e-3,
                "spike robustness Δ",
            );
        }
    }

    // ------------------------------------------------------- §20 clean step, no overshoot

    #[test]
    fn clean_step_without_any_overshoot_is_split_into_two_states() {
        // Deliberately no sample outside [Bottom, Platform]: the legacy detector's
        // "leave the amplitude window" assumption has nothing to work with here.
        let mut signal = vec![0.0005; 240];
        signal.extend(vec![0.035; 240]);
        signal.extend(vec![0.0005; 240]);
        signal.extend(vec![0.035; 240]);
        let analysis = analyze(signal);
        let kinds: Vec<SegmentKind> = analysis.segments.iter().map(|s| s.kind).collect();
        assert_eq!(
            kinds,
            vec![
                SegmentKind::Bottom,
                SegmentKind::Platform,
                SegmentKind::Bottom,
                SegmentKind::Platform
            ],
            "{:#?}",
            analysis.segments
        );
        assert_eq!(analysis.measurements.len(), 2);
        // The first high has two low neighbours; the final high only has a left low.
        assert_eq!(
            analysis.measurements[0].reference_mode,
            ReferenceMode::Interpolated
        );
        assert_eq!(
            analysis.measurements[1].reference_mode,
            ReferenceMode::LeftOnly
        );
        for measurement in &analysis.measurements {
            assert_close(measurement.corrected_signal, 0.0345, 1e-9, "clean step Δ");
        }
    }

    // ------------------------------------------------------------- §21 fragment merge

    #[test]
    fn short_artefacts_do_not_fragment_a_state() {
        let clean = repeating_waveform(3, 150, 80, 0.0012);
        let clean_count = analyze(clean.clone()).segments.len();

        let mut damaged = clean;
        // Two-sample spikes, the widest artefact the 5-wide centered median can prove
        // is an outlier rather than a narrow state.
        damaged[180] += 5.0;
        damaged[181] += 5.0;
        damaged[320] -= 5.0;
        damaged[321] -= 5.0;
        let analysis = analyze(damaged);

        assert_eq!(
            analysis.segments.len(),
            clean_count,
            "artefacts must not add segments: {:#?}",
            analysis.segments
        );
        assert_eq!(analysis.measurements.len(), 3);
    }

    #[test]
    fn a_wide_artefact_inside_a_platform_is_merged_back_into_one_state() {
        // Sections: P[0,150) B[150,230) P[230,380) B[380,460) P[460,610) ...
        let clean = repeating_waveform(3, 150, 80, 0.0012);
        let clean_count = analyze(clean.clone()).segments.len();

        let mut damaged = clean;
        // An 8-sample notch to an intermediate level. It is a genuine hole in the
        // stability mask (wider than the immediate bridge), so only the level-aware
        // merge step can put the Platform back together.
        for offset in 0..8 {
            damaged[350 + offset] = 0.02;
        }
        let analysis = analyze(damaged);
        assert_eq!(
            analysis.segments.len(),
            clean_count,
            "the notch must not survive as extra states: {:#?}",
            analysis.segments
        );
        let platforms = analysis
            .segments
            .iter()
            .filter(|segment| segment.kind == SegmentKind::Platform)
            .count();
        // Three cycles close with a final low: three highs, four lows.
        assert_eq!(platforms, 3, "{:#?}", analysis.segments);
        assert_eq!(analysis.measurements.len(), 3);
    }

    // -------------------------------------------------- §21/§9 missing region safety

    #[test]
    fn a_missing_region_never_shifts_later_pairings() {
        // Platform/Bottom alternating, then a long unusable stretch, then more cycles.
        let mut signal = sections_waveform(
            &[
                (PLATFORM, 150),
                (BOTTOM, 80),
                (PLATFORM, 150),
                (BOTTOM, 80),
                (PLATFORM, 150),
            ],
            0.0012,
        );
        let gap_start = signal.len();
        // A steep ramp is deliberately not a stable state.
        for offset in 0..400 {
            signal.push(offset as f64 * 0.0002);
        }
        let tail = gap_start + 400;
        let mut suffix = sections_waveform(
            &[
                (PLATFORM, 150),
                (BOTTOM, 80),
                (PLATFORM, 150),
                (BOTTOM, 80),
                (PLATFORM, 150),
            ],
            0.0012,
        );
        for (offset, value) in suffix.iter_mut().enumerate() {
            *value += pseudo_noise(tail + offset, 0.0012);
        }
        signal.extend(suffix);

        let analysis = analyze(signal);
        assert!(
            analysis.measurements.len() >= 4,
            "later droplets must survive a missing region: {:?}",
            analysis.warnings
        );
        // Every high must refer to low segments, never another high by parity.
        for measurement in &analysis.measurements {
            assert!(
                measurement.left_low_segment.is_some() || measurement.right_low_segment.is_some()
            );
        }
        // The droplets after the gap keep the correct Δ because each high looks up
        // its own neighbours instead of inheriting a global index offset.
        let correct = analysis
            .measurements
            .iter()
            .filter(|m| (m.corrected_signal - DELTA).abs() < 5e-3)
            .count();
        assert_eq!(
            correct,
            analysis.measurements.len(),
            "{:#?}",
            analysis.measurements
        );
    }

    // ------------------------------------------------------------- §11/§22 boundaries

    #[test]
    fn first_and_last_highs_fall_back_to_single_sided_references() {
        let signal = sections_waveform(
            &[
                (PLATFORM, 120),
                (BOTTOM, 150),
                (PLATFORM, 120),
                (BOTTOM, 150),
                (PLATFORM, 120),
            ],
            0.0012,
        );
        let analysis = analyze(signal);
        assert_eq!(analysis.measurements.len(), 3, "{:#?}", analysis.segments);
        assert_eq!(
            analysis.measurements[0].reference_mode,
            ReferenceMode::RightOnly
        );
        assert_eq!(
            analysis.measurements[1].reference_mode,
            ReferenceMode::Interpolated
        );
        assert_eq!(
            analysis.measurements[2].reference_mode,
            ReferenceMode::LeftOnly
        );
        assert!(
            analysis.measurements[0]
                .quality_flags
                .contains(&QualityFlag::SingleSidedReference)
        );
        assert!(
            analysis.measurements[2]
                .quality_flags
                .contains(&QualityFlag::SingleSidedReference)
        );
        assert_eq!(analysis.statistics.single_sided_count, 2);
        assert_eq!(analysis.statistics.interpolated_count, 1);
        // Single sided results are usable but must score lower than interpolated ones.
        assert!(
            analysis.measurements[0].confidence < analysis.measurements[1].confidence,
            "{:#?}",
            analysis.measurements
        );
        for measurement in &analysis.measurements {
            assert_close(measurement.corrected_signal, DELTA, 3e-3, "boundary Δ");
        }
    }

    #[test]
    fn single_sided_reference_can_be_disabled() {
        let signal = sections_waveform(
            &[
                (PLATFORM, 120),
                (BOTTOM, 150),
                (PLATFORM, 120),
                (BOTTOM, 150),
                (PLATFORM, 120),
            ],
            0.0012,
        );
        let analysis = analyze_with(
            signal,
            DropletParams {
                allow_single_sided_reference: false,
                ..DropletParams::default()
            },
        );
        assert_eq!(analysis.measurements.len(), 1);
        assert_eq!(
            analysis.measurements[0].reference_mode,
            ReferenceMode::Interpolated
        );
    }

    // --------------------------------------------------------- §12 large pairing gap

    #[test]
    fn a_platform_far_outside_the_typical_spacing_is_flagged_and_never_silently_used() {
        // Fourteen regular cycles, then one 600-sample stretch at an intermediate
        // level. That stretch is a stable structure that belongs to neither state, so
        // it is reported as Unknown and hides low references: a high nearby must
        // reach further for its baseline.
        let mut signal = repeating_waveform(14, 200, 200, 0.0012);
        for offset in 0..600 {
            signal[2400 + offset] = 0.018;
        }
        let analysis = analyze(signal);

        let flagged = analysis
            .measurements
            .iter()
            .filter(|m| m.quality_flags.contains(&QualityFlag::LargeReferenceGap))
            .count();
        assert!(
            flagged >= 1,
            "a distant reference must be flagged: {:#?}",
            analysis.measurements
        );
        // The unmodelled stretch must be visible as Unknown evidence, not swallowed.
        assert!(
            analysis
                .segments
                .iter()
                .any(|segment| segment.kind == SegmentKind::Unknown),
            "{:#?}",
            analysis.segments
        );
        // A flagged reference must also cost confidence, never be used silently.
        for measurement in &analysis.measurements {
            if measurement
                .quality_flags
                .contains(&QualityFlag::LargeReferenceGap)
            {
                assert!(measurement.confidence < 1.0);
            }
        }
    }

    // ------------------------------------------------------------- §23 unseparable

    #[test]
    fn flat_and_noise_only_signals_never_produce_droplets() {
        for signal in [
            vec![0.4; 4000],
            (0..4000)
                .map(|i| pseudo_noise(i, 0.02))
                .collect::<Vec<f64>>(),
        ] {
            let analysis = analyze(signal);
            assert!(
                analysis.measurements.is_empty(),
                "no droplets may be fabricated: {:#?}",
                analysis.measurements
            );
            assert!(
                !analysis.warnings.is_empty(),
                "an unseparable result must explain itself"
            );
        }
    }

    #[test]
    fn levels_closer_than_the_noise_are_reported_as_not_separable() {
        // 0.0005 apart while the noise sigma is roughly 0.0009.
        let signal = sections_waveform(&[(0.0010, 200), (0.0005, 200), (0.0010, 200)], 0.003);
        let analysis = analyze(signal);
        assert!(
            analysis.measurements.is_empty(),
            "no droplets may be fabricated: {:#?}",
            analysis.measurements
        );
        assert!(
            analysis
                .warnings
                .iter()
                .any(|warning| warning.contains("无法可靠分成"))
        );
    }

    // ---------------------------------------------------- §24 non-uniform time axis

    #[test]
    fn non_uniform_time_axis_is_used_for_interpolation() {
        let signal = sections_waveform(&[(BOTTOM, 120), (PLATFORM, 90), (0.0011, 120)], 0.0012);
        // Monotone but strongly non-uniform sampling.
        let time: Vec<f64> = (0..signal.len())
            .map(|index| index as f64 + (index * index) as f64 / 4000.0)
            .collect();
        let request = droplet_request(DropletParams::default());
        let (result, _) = analyze_dataset(&dataset_with_time(signal, time), &request, None);
        assert_eq!(result.droplet_measurements.len(), 1);
        let measurement = &result.droplet_measurements[0];
        assert!(result.has_real_time);

        let segments = &result.stable_segments;
        let left = segments
            .iter()
            .find(|segment| Some(segment.number) == measurement.left_low_segment)
            .expect("left platform");
        let right = segments
            .iter()
            .find(|segment| Some(segment.number) == measurement.right_low_segment)
            .expect("right platform");
        let expected = left.level
            + (right.level - left.level) * (measurement.center - left.center)
                / (right.center - left.center);
        assert_close(
            measurement.baseline_reference,
            expected,
            1e-12,
            "real-x reference",
        );

        // The index-based ratio is measurably different here, proving real x was used.
        let index_ratio = (measurement.center_index as f64 - left.center_index as f64)
            / (right.center_index as f64 - left.center_index as f64);
        let time_ratio = (measurement.center - left.center) / (right.center - left.center);
        assert!(
            (index_ratio - time_ratio).abs() > 1e-4,
            "the fixture must distinguish index from time: {index_ratio} vs {time_ratio}"
        );
    }

    #[test]
    fn a_degenerate_time_axis_falls_back_to_indices_without_dividing_by_zero() {
        let signal = sections_waveform(&[(BOTTOM, 120), (PLATFORM, 90), (BOTTOM, 120)], 0.0012);
        let flat_time = vec![5.0; signal.len()];
        let request = droplet_request(DropletParams::default());
        let (result, _) = analyze_dataset(&dataset_with_time(signal, flat_time), &request, None);
        assert_eq!(result.droplet_measurements.len(), 1);
        let measurement = &result.droplet_measurements[0];
        assert!(measurement.baseline_reference.is_finite());
        assert!(
            measurement
                .quality_flags
                .contains(&QualityFlag::IndexTimeFallback)
        );
        assert_close(measurement.corrected_signal, DELTA, 3e-3, "fallback Δ");
    }

    // -------------------------------------------------- §36 tiny / negative / scaling

    #[test]
    fn extremely_small_values_keep_their_relative_accuracy() {
        let scale = 1e-9;
        let signal: Vec<f64> = repeating_waveform(3, 140, 70, 0.0012)
            .into_iter()
            .map(|value| value * scale)
            .collect();
        let analysis = analyze(signal);
        assert_eq!(analysis.measurements.len(), 3);
        for measurement in &analysis.measurements {
            assert_close(
                measurement.corrected_signal / scale,
                DELTA,
                3e-3,
                "tiny-value Δ (rescaled)",
            );
        }
    }

    #[test]
    fn negative_levels_are_handled_without_sign_confusion() {
        // Bottom is the "largest" value in magnitude but the lower state: the model is
        // about ordering, not about absolute sign.
        let signal =
            sections_waveform(&[(-0.0841831, 150), (-0.05, 80), (-0.0841831, 150)], 0.0012);
        let analysis = analyze(signal);
        assert_eq!(analysis.measurements.len(), 1, "{:#?}", analysis.segments);
        assert_close(
            analysis.measurements[0].corrected_signal,
            0.0341831,
            3e-3,
            "negative-level Δ",
        );
        assert!(analysis.measurements[0].corrected_signal > 0.0);
    }

    // ------------------------------------------------------------- §3 slow transition

    #[test]
    fn a_slow_transition_never_becomes_a_third_state() {
        let mut signal = vec![BOTTOM; 200];
        for offset in 0..40 {
            signal.push(BOTTOM + (PLATFORM - BOTTOM) * offset as f64 / 39.0);
        }
        signal.extend(vec![PLATFORM; 200]);
        for offset in 0..40 {
            signal.push(PLATFORM - (PLATFORM - BOTTOM) * offset as f64 / 39.0);
        }
        signal.extend(vec![BOTTOM; 200]);
        let analysis = analyze(signal);
        assert!(!analysis.segments.is_empty());
        for segment in &analysis.segments {
            assert!(
                (segment.level - BOTTOM).abs() < 0.002 || (segment.level - PLATFORM).abs() < 0.002,
                "a transition must not be reported as a state: {segment:#?}"
            );
        }
        assert_eq!(analysis.measurements.len(), 1, "{:#?}", analysis.segments);
    }

    // ----------------------------------------------------------------- §26 caching

    #[test]
    fn droplet_detection_cache_is_reused_unless_the_detection_signal_changes() {
        let signal = repeating_waveform(3, 140, 70, 0.0012);
        let request = droplet_request(DropletParams::default());
        let (_, cache) = analyze_dataset(&dataset(signal.clone()), &request, None);
        assert_eq!(
            cache.detection,
            DetectionKey::Droplet {
                despike_window: 5,
                despike_sigma: 3.0
            }
        );

        // Segmentation-only parameters must not invalidate the heavy stage.
        for mutation in [
            (|p: &mut DropletParams| p.min_segment_length += 4) as fn(&mut DropletParams),
            |p: &mut DropletParams| p.stability_window += 8,
            |p: &mut DropletParams| p.edge_trim_fraction = 0.2,
            |p: &mut DropletParams| p.outlier_sigma = 4.0,
            |p: &mut DropletParams| p.reference_gap_factor = 5.0,
        ] {
            let mut changed = request.clone();
            mutation(&mut changed.droplet);
            let (result, next) = analyze_dataset(&dataset(signal.clone()), &changed, Some(&cache));
            assert!(
                result.used_cached_preprocess,
                "cache must survive segmentation parameters"
            );
            assert_eq!(next.detection, cache.detection);
        }

        // A detection-signal parameter must invalidate it.
        let mut changed = request.clone();
        changed.droplet.despike_window = 7;
        let (result, _) = analyze_dataset(&dataset(signal.clone()), &changed, Some(&cache));
        assert!(!result.used_cached_preprocess);

        let mut changed = request.clone();
        changed.droplet.despike_sigma = 5.0;
        let (result, _) = analyze_dataset(&dataset(signal.clone()), &changed, Some(&cache));
        assert!(!result.used_cached_preprocess);

        // Smoothing belongs to the detection signal too.
        let mut changed = request.clone();
        changed.preprocess.smooth_window = 21;
        let (result, _) = analyze_dataset(&dataset(signal), &changed, Some(&cache));
        assert!(!result.used_cached_preprocess);
    }

    // ------------------------------------------------------------ §15 suggestions

    #[test]
    fn droplet_suggestion_derives_parameters_or_refuses_explicitly() {
        let signal = repeating_waveform(4, 140, 70, 0.0012);
        let suggestion = suggest_droplet_parameters(&signal, &PreprocessParams::default());
        assert!(suggestion.ok, "{}", suggestion.message);
        let params = suggestion.droplet.expect("droplet params");
        assert!(params.min_segment_length >= 4);
        assert!(params.max_segment_length >= params.min_segment_length);
        assert!(params.stability_window % 2 == 1 && params.stability_window >= 5);
        assert!(suggestion.plateau.is_none());

        for flat in [
            vec![0.4; 4000],
            (0..4000).map(|i| pseudo_noise(i, 0.02)).collect(),
        ] {
            let suggestion = suggest_droplet_parameters(&flat, &PreprocessParams::default());
            assert!(!suggestion.ok, "flat/noise data must not yield parameters");
            assert!(suggestion.droplet.is_none());
        }
    }

    #[test]
    fn normalized_parameters_never_violate_the_despike_window_constraint() {
        let normalized = normalize_droplet_params(&DropletParams {
            min_segment_length: 4,
            max_segment_length: 2,
            stability_window: 10,
            edge_trim_fraction: 5.0,
            outlier_sigma: f64::NAN,
            despike_window: 21,
            despike_sigma: -3.0,
            noise_factor: 0.0,
            slope_factor: f64::INFINITY,
            cluster_separation_factor: -1.0,
            reference_gap_factor: 0.0,
            ..DropletParams::default()
        });
        assert_eq!(normalized.stability_window, 11);
        assert!(normalized.despike_window <= normalized.min_segment_length.max(3));
        assert_eq!(normalized.despike_window % 2, 1);
        assert!(normalized.max_segment_length >= normalized.min_segment_length);
        assert!(normalized.edge_trim_fraction <= 0.45);
        assert!(normalized.outlier_sigma.is_finite() && normalized.outlier_sigma >= 1.0);
        assert!(normalized.noise_factor >= 2.0);
        assert!(normalized.slope_factor.is_finite() && normalized.slope_factor >= 1.0);
        assert!(normalized.cluster_separation_factor >= 0.5);
        assert!(normalized.reference_gap_factor >= 1.0);
    }

    #[test]
    fn high_platform_lengths_include_unpaired_highs_and_exclude_other_states() {
        let mut segments = pairing_fixture(
            &[
                (SegmentKind::Platform, 0.3),
                (SegmentKind::Bottom, 0.0),
                (SegmentKind::Unknown, 0.1),
                (SegmentKind::Platform, 0.5),
            ],
            &[10.0, 20.0, 30.0, 40.0],
        );
        for (segment, length) in segments.iter_mut().zip([10, 800, 900, 30]) {
            segment.length = length;
            segment.effective_length = 3;
        }
        let stats = droplet_statistics(&[], &segments);
        assert_eq!(stats.droplet_count, 0);
        assert_eq!(stats.mean_length, Some(20.0));
        assert_eq!(stats.length_standard_deviation, Some(10.0));
        assert_eq!(stats.length_rsd, Some(50.0));
        let single = droplet_statistics(&[], &segments[..1]);
        assert_eq!(single.mean_length, Some(10.0));
        assert_eq!(single.length_rsd, Some(0.0));
        let empty = droplet_statistics(&[], &segments[1..3]);
        assert_eq!(empty.mean_length, None);
        assert_eq!(empty.length_standard_deviation, None);
        assert_eq!(empty.length_rsd, None);
    }

    fn pairing_fixture(levels: &[(SegmentKind, f64)], x: &[f64]) -> Vec<StableSegment> {
        levels
            .iter()
            .enumerate()
            .map(|(i, (kind, level))| StableSegment {
                number: i + 1,
                start_index: i,
                end_index: i,
                center_index: i,
                start: x[i],
                end: x[i],
                center: x[i],
                level: *level,
                standard_deviation: 0.0,
                mad: 0.0,
                slope: 0.0,
                length: 1,
                effective_length: 1,
                kind: *kind,
                confidence: 1.0,
            })
            .collect()
    }

    #[test]
    fn asymmetric_highs_use_their_own_low_baselines_and_wire_ids() {
        let x = [0.0, 10.0, 30.0, 50.0, 90.0];
        let segments = pairing_fixture(
            &[
                (SegmentKind::Bottom, 2.0),
                (SegmentKind::Platform, 20.0),
                (SegmentKind::Bottom, 5.0),
                (SegmentKind::Platform, 30.0),
                (SegmentKind::Bottom, 8.0),
            ],
            &x,
        );
        let (m, warnings, skipped) =
            build_measurements(&segments, &x, &DropletParams::default(), 0.01, true, 1e-12);
        assert!(warnings.is_empty());
        assert_eq!(skipped, 0);
        assert_eq!(m.len(), 2);
        for (measurement, (high, left, right, baseline, delta)) in
            m.iter().zip([(2, 1, 3, 3.0, 17.0), (4, 3, 5, 6.0, 24.0)])
        {
            assert_eq!(measurement.high_segment, high);
            assert_eq!(measurement.left_low_segment, Some(left));
            assert_eq!(measurement.right_low_segment, Some(right));
            assert_eq!(measurement.reference_mode, ReferenceMode::Interpolated);
            assert_close(
                measurement.baseline_reference,
                baseline,
                1e-12,
                "asymmetric baseline",
            );
            assert_close(
                measurement.corrected_signal,
                delta,
                1e-12,
                "asymmetric delta",
            );
        }
        let stats = droplet_statistics(&m, &segments);
        assert_eq!(stats.mean_high, Some(25.0));
        assert_eq!(stats.mean_baseline, Some(4.5));
        assert_eq!(stats.mean_corrected_signal, Some(20.5));
        let wire = serde_json::to_value(&m[0]).unwrap();
        assert_eq!(wire["highSegment"], 2);
        assert_eq!(wire["leftLowSegment"], 1);
        assert_eq!(wire["baselineReference"], 3.0);
        assert!(wire.get("bottomSegment").is_none());
        assert!(wire.get("platformReference").is_none());
    }

    #[test]
    fn high_without_low_is_detected_but_never_fabricates_a_baseline() {
        let x = [0.0, 1.0];
        let segments = pairing_fixture(
            &[(SegmentKind::Platform, 20.0), (SegmentKind::Unknown, 10.0)],
            &x,
        );
        let (m, warnings, skipped) =
            build_measurements(&segments, &x, &DropletParams::default(), 0.01, true, 1e-12);
        assert!(m.is_empty());
        assert_eq!(skipped, 1);
        assert!(
            warnings
                .iter()
                .any(|w| w.contains("高平台缺少可用的低平台基线"))
        );
    }

    #[test]
    fn high_outside_real_time_bracket_uses_flagged_index_interpolation() {
        let x = [0.0, 30.0, 20.0];
        let segments = pairing_fixture(
            &[
                (SegmentKind::Bottom, 2.0),
                (SegmentKind::Platform, 20.0),
                (SegmentKind::Bottom, 6.0),
            ],
            &x,
        );
        let (m, _, _) =
            build_measurements(&segments, &x, &DropletParams::default(), 0.01, true, 1e-12);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].baseline_reference, 4.0);
        assert!(m[0].quality_flags.contains(&QualityFlag::IndexTimeFallback));
    }

    #[test]
    fn low_baselines_beyond_hard_gap_are_not_used() {
        let x = [0.0, 10.0, 20.0, 30.0, 40.0, 200.0];
        let segments = pairing_fixture(
            &[
                (SegmentKind::Bottom, 2.0),
                (SegmentKind::Unknown, 3.0),
                (SegmentKind::Unknown, 3.0),
                (SegmentKind::Unknown, 3.0),
                (SegmentKind::Unknown, 3.0),
                (SegmentKind::Platform, 20.0),
            ],
            &x,
        );
        let (m, _, skipped) =
            build_measurements(&segments, &x, &DropletParams::default(), 0.01, true, 1e-12);
        assert!(m.is_empty());
        assert_eq!(skipped, 1);
    }

    // ------------------------------------------------------------------- §37 scale

    #[test]
    #[ignore = "manual release-mode performance measurement"]
    fn droplet_large_signal_benchmark() {
        for count in [200_000usize, 500_000] {
            let cycle = 1500;
            let data = dataset(
                (0..count)
                    .map(|index| {
                        let phase = index % cycle;
                        let level = if phase < 900 { PLATFORM } else { BOTTOM };
                        level + pseudo_noise(index, 0.0012)
                    })
                    .collect(),
            );
            let request = droplet_request(DropletParams::default());
            let start = std::time::Instant::now();
            let (result, cache) = analyze_dataset(&data, &request, None);
            let first = start.elapsed();
            let start = std::time::Instant::now();
            let _ = analyze_dataset(&data, &request, Some(&cache));
            let cached = start.elapsed();
            println!(
                "points={count} segments={} droplets={} first={first:?} cached={cached:?}",
                result.stable_segments.len(),
                result.droplet_measurements.len()
            );
            assert!(!result.droplet_measurements.is_empty());
        }
    }
}
