import type { SampleMetadata, SamplingRecord } from "../types";

export function positionLabel(sample?: SampleMetadata | null) {
  if (sample?.invalidPosition) return "坐标无效或不一致";
  if (sample?.latitude == null || sample.longitude == null) return "无采样坐标";
  return `${sample.latitude.toFixed(6)}, ${sample.longitude.toFixed(6)}${sample.simulated ? " · 模拟" : ""}`;
}

export function samplePosition(record: SamplingRecord) {
  const sample = record.source.metadata;
  if (sample?.invalidPosition || sample?.latitude == null || sample.longitude == null) return null;
  return { lat: sample.latitude, lng: sample.longitude };
}

export function surfaceEligible(record: SamplingRecord) {
  const sample = record.source.metadata;
  const concentration = record.concentration;
  return !!samplePosition(record) && !sample?.simulated
    && (!sample?.outcome || ["unknown", "succeeded"].includes(sample.outcome))
    && concentration != null && concentration.value >= 0 && concentration.notices.length === 0;
}
