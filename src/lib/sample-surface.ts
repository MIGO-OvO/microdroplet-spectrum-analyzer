import type { SamplingRecord } from "../types";
import { samplePosition, surfaceEligible } from "./sampling";

export type Position = { lat: number; lng: number };
export type LayerMode = "points" | "heat" | "contours";
type Range = { min: number; max: number; unit: string };
type Cell = { northwest: Position; southeast: Position; color: string };
type Contour = { value: number; color: string; segments: [Position, Position][] };
type Location = { x: number; y: number; value: number };

export interface MapLayers {
  points: { id: number; position: Position; color: string; simulated: boolean }[];
  range: Range | null;
  cells: Cell[];
  contours: Contour[];
  message: string;
}

const STOPS = [[68, 34, 138], [44, 111, 172], [32, 163, 151], [126, 199, 94], [251, 221, 88]];
export const concentrationGradient = `linear-gradient(to right, ${STOPS.map(rgb => `rgb(${rgb.join(",")})`).join(",")})`;

function color(value: number, { min, max }: Range) {
  const t = (min === max ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)))) * (STOPS.length - 1);
  const i = Math.min(Math.floor(t), STOPS.length - 2);
  return `rgb(${STOPS[i].map((channel, j) => Math.round(channel + (STOPS[i + 1][j] - channel) * (t - i))).join(",")})`;
}

const turn = (a: Location, b: Location, c: Location) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function convexHull(locations: Location[]) {
  function half(points: Location[]) {
    const edge: Location[] = [];
    for (const point of points) {
      while (edge.length >= 2 && turn(edge[edge.length - 2], edge[edge.length - 1], point) <= 0) edge.pop();
      edge.push(point);
    }
    return edge.slice(0, -1);
  }
  const sorted = locations.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  return [...half(sorted), ...half(sorted.reverse())];
}

function interpolate(x: number, y: number, locations: Location[]) {
  let weighted = 0;
  let total = 0;
  for (const point of locations) {
    const d2 = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (d2 < 1e-10) return point.value;
    const weight = 1 / d2;
    weighted += weight * point.value;
    total += weight;
  }
  return weighted / total;
}

function traceContour(corners: Position[], values: number[], contour: Contour) {
  const edges: Position[] = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    if ((values[i] >= contour.value) === (values[next] >= contour.value)) continue;
    const t = (contour.value - values[i]) / (values[next] - values[i]);
    edges.push({
      lat: corners[i].lat + t * (corners[next].lat - corners[i].lat),
      lng: corners[i].lng + t * (corners[next].lng - corners[i].lng),
    });
  }
  if (edges.length === 2) contour.segments.push([edges[0], edges[1]]);
  if (edges.length === 4) {
    const center = values.reduce((sum, value) => sum + value, 0) / 4;
    if ((center >= contour.value) === (values[0] >= contour.value)) {
      contour.segments.push([edges[0], edges[1]], [edges[2], edges[3]]);
    } else {
      contour.segments.push([edges[0], edges[3]], [edges[1], edges[2]]);
    }
  }
}

export function buildMapLayers(records: SamplingRecord[]): MapLayers {
  const samples = records.flatMap(record => {
    const position = samplePosition(record);
    return position ? [{ record, position }] : [];
  });
  const valid = samples.filter(({ record }) => surfaceEligible(record));
  const variants = new Set(valid.map(({ record }) => JSON.stringify([
    record.analyte, record.concentration?.unit, record.concentration?.curve?.id, record.concentration?.curve?.updatedAt,
  ])));
  const values = valid.map(({ record }) => record.concentration!.value);
  const range = values.length && variants.size === 1 ? {
    min: Math.min(...values), max: Math.max(...values), unit: valid[0].record.concentration!.unit,
  } : null;
  const points = samples.map(({ record, position }) => ({
    id: record.id,
    position,
    color: range && surfaceEligible(record) ? color(record.concentration!.value, range) : "#327da4",
    simulated: record.source.metadata?.simulated ?? false,
  }));
  const empty = { points, range, cells: [], contours: [] };
  if (variants.size > 1) return { ...empty, message: "选择污染物、单位和浓度来源一致的样本。" };
  if (!range || valid.length < 3) return { ...empty, message: "至少选取 3 个分散且带有效浓度的实测点。" };

  const latitudes = valid.map(({ position }) => position.lat);
  const longitudes = valid.map(({ position }) => position.lng);
  const north = Math.max(...latitudes), south = Math.min(...latitudes);
  const west = Math.min(...longitudes), east = Math.max(...longitudes);
  if (east - west >= 180) return { ...empty, message: "为同一水域选择样本。" };
  const longitudeScale = 111_320 * Math.cos((north + south) * Math.PI / 360);
  const latitudeScale = 110_540;
  const byLocation = new Map<string, Location & { count: number }>();
  valid.forEach(({ position }, index) => {
    const key = `${position.lat},${position.lng}`;
    const point = byLocation.get(key);
    if (point) { point.count++; point.value += (values[index] - point.value) / point.count; }
    else byLocation.set(key, { x: (position.lng - west) * longitudeScale,
      y: (north - position.lat) * latitudeScale, value: values[index], count: 1 });
  });
  const locations = [...byLocation.values()];
  const hull = convexHull(locations);
  if (hull.length < 3) return { ...empty, message: "所选点位的二维覆盖不足。" };

  const divisions = 48;
  const northWest = (row: number, column: number) => ({
    lat: north - (north - south) * row / divisions, lng: west + (east - west) * column / divisions,
  });
  const grid = Array.from({ length: divisions + 1 }, (_, row) => Array.from({ length: divisions + 1 }, (_, column) => {
    const position = northWest(row, column);
    const x = (position.lng - west) * longitudeScale;
    const y = (north - position.lat) * latitudeScale;
    const cell = { x, y, value: 0 };
    return hull.every((a, i) => turn(a, hull[(i + 1) % hull.length], cell) >= -1e-6) ? interpolate(x, y, locations) : NaN;
  }));
  const contours: Contour[] = range.min === range.max ? [] : Array.from({ length: 5 }, (_, i) => {
    const value = range.min + (range.max - range.min) * (i + 1) / 6;
    return { value, color: color(value, range), segments: [] };
  });
  const cells: Cell[] = [];
  for (let row = 0; row < divisions; row++) {
    for (let column = 0; column < divisions; column++) {
      const value = [grid[row][column], grid[row][column + 1], grid[row + 1][column + 1], grid[row + 1][column]];
      if (!value.every(Number.isFinite)) continue;
      const northwest = northWest(row, column), southeast = northWest(row + 1, column + 1);
      cells.push({ northwest, southeast, color: color(value.reduce((sum, v) => sum + v, 0) / 4, range) });
      const corners = [northwest, northWest(row, column + 1), southeast, northWest(row + 1, column)];
      for (const contour of contours) traceContour(corners, value, contour);
    }
  }
  return { points, range, cells, contours, message: cells.length ? "" : "所选点位的二维覆盖不足。" };
}
