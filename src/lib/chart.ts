import type { AmplitudeBands } from "../types";

export const AMPLITUDE_BOUNDARIES = [
  ["lowMin", "低平台下限"], ["lowMax", "低平台上限"],
  ["highMin", "高平台下限"], ["highMax", "高平台上限"],
] as const;

/** Keep all four limits ordered when a pointer or arrow key moves one boundary. */
export function moveAmplitudeBoundary(bands: AmplitudeBands, key: keyof AmplitudeBands, value: number): AmplitudeBands {
  const index = AMPLITUDE_BOUNDARIES.findIndex(([boundary]) => boundary === key);
  const gap = Math.max((bands.highMax - bands.lowMin) * 1e-6,
    Math.max(...Object.values(bands).map(Math.abs)) * Number.EPSILON * 8, Number.MIN_VALUE);
  const lower = index > 0 ? Math.min(bands[key], bands[AMPLITUDE_BOUNDARIES[index - 1][0]] + gap) : -Infinity;
  const upper = index < 3 ? Math.max(bands[key], bands[AMPLITUDE_BOUNDARIES[index + 1][0]] - gap) : Infinity;
  return { ...bands, [key]: Math.max(lower, Math.min(upper, Number(value.toPrecision(8)))) };
}

export function clampRange(start: number, end: number): [number, number] {
  const span = Math.min(1, Math.max(0.00001, end - start));
  const nextStart = Math.max(0, Math.min(1 - span, start));
  return [nextStart, nextStart + span];
}

export function nearestIndex(values: number[], target: number, start = 0, end = values.length - 1) {
  let low = start;
  let high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  if (low <= start) return start;
  return Math.abs(values[low] - target) < Math.abs(values[low - 1] - target) ? low : low - 1;
}

export function xBounds(x: number[], range: [number, number]): [number, number] {
  const first = x[0];
  const span = x[x.length - 1] - first;
  return [first + range[0] * span, first + range[1] * span];
}
