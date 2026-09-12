import type { QualityFlag, ReferenceMode, SegmentKind } from "../types";

export function formatMeasurement(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.001) || magnitude >= 100_000) {
    return value.toExponential(3);
  }
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatPointCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export interface AxisTicks {
  values: number[];
  fractionDigits: number;
}

export function buildAxisTicks(
  minimum: number,
  maximum: number,
  maxIntervals = 6,
  integerOnly = false,
): AxisTicks {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return { values: [minimum], fractionDigits: integerOnly ? 0 : 3 };
  }

  const rawStep = (maximum - minimum) / Math.max(1, maxIntervals);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = integerOnly ? Math.max(1, factor * magnitude) : factor * magnitude;
  const fractionDigits = integerOnly
    ? 0
    : Math.min(8, Math.max(0, -Math.floor(Math.log10(step))));
  const epsilon = step * 1e-9;
  const first = Math.ceil((minimum - epsilon) / step) * step;
  const values: number[] = [];

  for (let value = first; value <= maximum + epsilon; value += step) {
    const normalizedValue = integerOnly
      ? Math.round(value)
      : Number(value.toFixed(fractionDigits + 2));
    values.push(Object.is(normalizedValue, -0) ? 0 : normalizedValue);
  }

  return { values, fractionDigits };
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "发生未知错误，请重试。";
}

/**
 * Display labels for the droplet vocabulary.
 *
 * The backend sends stable machine strings; the mapping to Chinese lives here so
 * the table, the tooltip, the summary and the chart all say the same thing.
 */
const SEGMENT_KIND_LABELS: Record<SegmentKind, string> = {
  platform: "Platform（高电平）",
  bottom: "Bottom（低电平）",
  unknown: "Unknown（未分类）",
};

const REFERENCE_MODE_LABELS: Record<ReferenceMode, string> = {
  interpolated: "双侧插值",
  leftOnly: "仅左侧平台",
  rightOnly: "仅右侧平台",
  none: "无参考",
};

const QUALITY_FLAG_LABELS: Record<QualityFlag, string> = {
  lowClassificationConfidence: "分类置信度偏低",
  singleSidedReference: "单侧参考",
  largeReferenceGap: "参考间隔过大",
  noisyBottom: "Bottom 噪声偏高",
  noisyPlatform: "Platform 噪声偏高",
  nearbyUnknownSegment: "参考区间含未分类段",
  indexTimeFallback: "改用序号插值",
};

export function formatSegmentKind(kind: SegmentKind): string {
  return SEGMENT_KIND_LABELS[kind] ?? kind;
}

export function formatReferenceMode(mode: ReferenceMode): string {
  return REFERENCE_MODE_LABELS[mode] ?? mode;
}

export function formatQualityFlag(flag: QualityFlag): string {
  return QUALITY_FLAG_LABELS[flag] ?? flag;
}

