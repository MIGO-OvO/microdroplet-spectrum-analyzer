import type { SampleCoordinates, SampleMetadata, SamplingRecord } from "../types";

export type CoordinateDraft = { latitude: string; longitude: string };
export type SampleCoordinatesByWindow = Record<string, SampleCoordinates | null>;

export function coordinateDraft(coordinates?: SampleCoordinates | null): CoordinateDraft {
  return { latitude: coordinates?.latitude.toString() ?? "", longitude: coordinates?.longitude.toString() ?? "" };
}

export function readCoordinateDraft(draft: CoordinateDraft): SampleCoordinates | null | string {
  const lat = draft.latitude.trim(), lng = draft.longitude.trim();
  if (!lat && !lng) return null;
  if (!lat || !lng) return "请同时填写纬度和经度。";
  const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const latitude = Number(lat), longitude = Number(lng);
  if (!decimal.test(lat) || !decimal.test(lng) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return "纬度须在 −90° 到 90°，经度须在 −180° 到 180°。";
  }
  return { latitude, longitude };
}

function fileCoordinates(sample?: SampleMetadata | null): SampleCoordinates | null {
  if (sample?.invalidPosition || sample?.latitude == null || sample.longitude == null) return null;
  return { latitude: sample.latitude, longitude: sample.longitude };
}

export function positionLabel(sample?: SampleMetadata | null, manual?: SampleCoordinates | null) {
  const coordinates = manual ?? fileCoordinates(sample);
  if (!coordinates) return sample?.invalidPosition ? "坐标无效或不一致" : "无采样坐标";
  const { latitude, longitude } = coordinates;
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}${manual ? " · 手动" : ""}${sample?.simulated ? " · 模拟" : ""}`;
}

export function samplePosition(record: SamplingRecord) {
  const coordinates = record.manualCoordinates ?? fileCoordinates(record.source.metadata);
  return coordinates ? { lat: coordinates.latitude, lng: coordinates.longitude } : null;
}

export function surfaceEligible(record: SamplingRecord) {
  const sample = record.source.metadata;
  const concentration = record.concentration;
  return !!samplePosition(record) && !sample?.simulated
    && (!sample?.outcome || ["unknown", "succeeded"].includes(sample.outcome))
    && concentration != null && concentration.value >= 0 && concentration.notices.length === 0;
}
