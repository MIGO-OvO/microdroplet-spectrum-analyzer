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
