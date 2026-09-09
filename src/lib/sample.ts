import type { AnalysisResponse, DatasetSummary } from "../types";

function seededNoise(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 0.028;
}

const pointCount = 1800;
const x = Array.from({ length: pointCount }, (_, index) => index);
const levels = [
  { start: 175, end: 330, height: 0.31 },
  { start: 480, end: 650, height: 0.43 },
  { start: 805, end: 995, height: 0.37 },
  { start: 1180, end: 1355, height: 0.48 },
  { start: 1510, end: 1680, height: 0.34 },
];
const original = x.map((index) => {
  const plateau = levels.find((level) => index >= level.start && index <= level.end);
  const transition = plateau ? plateau.height : 0.018;
  return transition + seededNoise(index) + Math.sin(index / 29) * 0.006;
});
const processed = x.map((index) => {
  const from = Math.max(0, index - 4);
  const to = Math.min(pointCount, index + 5);
  const average = original.slice(from, to).reduce((sum, value) => sum + value, 0) / (to - from);
  return average;
});

export const SAMPLE_SUMMARY: DatasetSummary = {
  fileName: "合成演示数据（仅界面预览）",
  pointCount,
  droppedRows: 0,
  hasRealTime: false,
  columns: [
    { index: 0, name: "数据点" },
    { index: 1, name: "信号强度" },
  ],
};

export const SAMPLE_RESULT: AnalysisResponse = {
  mode: "plateau",
  resultId: 0,
  plot: { x, original, processed },
  plateauFeatures: levels.map((level, index) => ({
    number: index + 1,
    centerIndex: Math.floor((level.start + level.end) / 2),
    center: Math.floor((level.start + level.end) / 2),
    start: level.start,
    end: level.end,
    height: level.height,
    length: level.end - level.start + 1,
    standardDeviation: 0.006 + index * 0.0004,
  })),
  statistics: {
    featureCount: 5,
    meanHeight: 0.386,
    maxHeight: 0.48,
    minHeight: 0.31,
    standardDeviation: 0.0612,
    rsd: 15.85,
    meanLength: 172.2,
    lengthStandardDeviation: 11.6,
  },
  usedCachedPreprocess: false,
  warnings: [],
};
