import type {
  AnalysisResponse,
  DatasetSummary,
  DropletMeasurement,
  DropletStatistics,
  StableSegment,
} from "../types";

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
  stableSegments: [],
  dropletMeasurements: [],
  dropletStatistics: {
    dropletCount: 0,
    meanCorrectedSignal: null,
    minCorrectedSignal: null,
    maxCorrectedSignal: null,
    standardDeviation: null,
    rsd: null,
    meanBottom: null,
    meanPlatformReference: null,
    interpolatedCount: 0,
    singleSidedCount: 0,
    lowConfidenceCount: 0,
    unknownSegmentCount: 0,
  },
  usedCachedPreprocess: false,
  warnings: [],
};

// ------------------------------------------------------------- droplet demo
//
// A synthetic dual-state record for the browser preview: Platform and Bottom
// alternate while the whole baseline drifts, so the corrected Δ can only be
// recovered by a *local* reference. Every number below is derived from the same
// interpolation rule the backend uses, so the preview shows the real shape of the
// output rather than a decorative pastiche.

const TRUE_DELTA = 0.0339;
const dropletSections: Array<{ kind: "platform" | "bottom"; length: number }> = [];
for (let cycle = 0; cycle < 7; cycle += 1) {
  dropletSections.push({ kind: "platform", length: 150 });
  dropletSections.push({ kind: "bottom", length: 80 });
}
dropletSections.push({ kind: "platform", length: 75 });

const dropletPointCount = dropletSections.reduce((sum, section) => sum + section.length, 0);
const dropletDrift = (index: number) => 0.0305 + 0.004 * (index / (dropletPointCount - 1)) + Math.sin(index / 260) * 0.0009;

const dropletOriginal: number[] = [];
for (const section of dropletSections) {
  const sectionStart = dropletOriginal.length;
  for (let offset = 0; offset < section.length; offset += 1) {
    const index = sectionStart + offset;
    const platform = dropletDrift(index);
    const level = section.kind === "platform" ? platform : platform - TRUE_DELTA;
    dropletOriginal.push(level + seededNoise(index + 900));
  }
}

const dropletBounds: Array<{ kind: "platform" | "bottom"; start: number; end: number }> = [];
{
  let cursor = 0;
  for (const section of dropletSections) {
    // The detector loses a few samples at every boundary, so the reported ranges
    // are slightly inside the drawn sections — exactly as in the Rust engine.
    dropletBounds.push({
      kind: section.kind,
      start: cursor + 4,
      end: cursor + section.length - 5,
    });
    cursor += section.length;
  }
}

function sectionLevel(start: number, end: number) {
  let total = 0;
  for (let index = start; index <= end; index += 1) total += dropletOriginal[index];
  return total / (end - start + 1);
}

const dropletStableSegments: StableSegment[] = dropletBounds.map((bounds, index) => ({
  number: index + 1,
  startIndex: bounds.start,
  endIndex: bounds.end,
  centerIndex: Math.floor((bounds.start + bounds.end) / 2),
  start: bounds.start,
  end: bounds.end,
  center: Math.floor((bounds.start + bounds.end) / 2),
  level: sectionLevel(bounds.start, bounds.end),
  standardDeviation: 0.009 + index * 0.0001,
  mad: 0.011,
  slope: (index % 2 === 0 ? -1 : 1) * 2.2e-5,
  length: bounds.end - bounds.start + 1,
  effectiveLength: bounds.end - bounds.start - 7,
  kind: bounds.kind,
  confidence: 0.38,
}));

const dropletMeasurements: DropletMeasurement[] = [];
for (let index = 1; index < dropletStableSegments.length; index += 1) {
  const segment = dropletStableSegments[index];
  if (segment.kind !== "bottom") continue;
  const left = dropletStableSegments[index - 1];
  const right = dropletStableSegments[index + 1] ?? null;
  const reference = right
    ? left.level + (right.level - left.level) * ((segment.center - left.center) / (right.center - left.center))
    : left.level;
  dropletMeasurements.push({
    number: dropletMeasurements.length + 1,
    bottomSegment: segment.number,
    leftPlatformSegment: left.number,
    rightPlatformSegment: right?.number ?? null,
    centerIndex: segment.centerIndex,
    center: segment.center,
    bottomLevel: segment.level,
    leftPlatformLevel: left.level,
    rightPlatformLevel: right?.level ?? null,
    platformReference: reference,
    correctedSignal: reference - segment.level,
    referenceMode: right ? "interpolated" : "leftOnly",
    confidence: right ? 0.38 : 0.23,
    qualityFlags: right
      ? ["lowClassificationConfidence"]
      : ["singleSidedReference", "lowClassificationConfidence"],
  });
}

const correctedValues = dropletMeasurements.map((measurement) => measurement.correctedSignal);
const meanCorrected = correctedValues.reduce((sum, value) => sum + value, 0) / correctedValues.length;
const correctedDeviation = Math.sqrt(
  correctedValues.reduce((sum, value) => sum + (value - meanCorrected) ** 2, 0) / correctedValues.length,
);

const dropletStatistics: DropletStatistics = {
  dropletCount: dropletMeasurements.length,
  meanCorrectedSignal: meanCorrected,
  minCorrectedSignal: Math.min(...correctedValues),
  maxCorrectedSignal: Math.max(...correctedValues),
  standardDeviation: correctedDeviation,
  rsd: (correctedDeviation / meanCorrected) * 100,
  meanBottom:
    dropletMeasurements.reduce((sum, measurement) => sum + measurement.bottomLevel, 0) /
    dropletMeasurements.length,
  meanPlatformReference:
    dropletMeasurements.reduce((sum, measurement) => sum + measurement.platformReference, 0) /
    dropletMeasurements.length,
  interpolatedCount: dropletMeasurements.filter((measurement) => measurement.referenceMode === "interpolated").length,
  singleSidedCount: dropletMeasurements.filter((measurement) => measurement.referenceMode !== "interpolated").length,
  lowConfidenceCount: dropletMeasurements.filter((measurement) => measurement.confidence < 0.5).length,
  unknownSegmentCount: 0,
};

export const SAMPLE_DROPLET_RESULT: AnalysisResponse = {
  mode: "droplet",
  resultId: 0,
  plot: {
    x: Array.from({ length: dropletPointCount }, (_, index) => index),
    original: dropletOriginal,
    processed: dropletOriginal,
  },
  plateauFeatures: [],
  statistics: {
    featureCount: 0,
    meanHeight: null,
    maxHeight: null,
    minHeight: null,
    standardDeviation: null,
    rsd: null,
    meanLength: null,
    lengthStandardDeviation: null,
  },
  stableSegments: dropletStableSegments,
  dropletMeasurements,
  dropletStatistics,
  usedCachedPreprocess: false,
  warnings: [],
};
