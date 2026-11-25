/** Plateau identifies saved results and calibration points; new analyses use droplet. */
export type AnalysisMode = "plateau" | "droplet";
export type FilterMode = "clip_smooth" | "median_smooth";

/** Whether a stable segment is the upper state, the lower state, or unassigned. */
export type SegmentKind = "unknown" | "platform" | "bottom";

/** How `baselineReference` was obtained for one droplet. */
export type ReferenceMode = "interpolated" | "leftOnly" | "rightOnly" | "none";

/**
 * Machine-readable quality markers. Kept as a union of string literals rather than
 * a free-form message so the table, the chart tooltip and the exporter can filter
 * and translate them.
 */
export type QualityFlag =
  | "lowClassificationConfidence"
  | "singleSidedReference"
  | "largeReferenceGap"
  | "noisyBottom"
  | "noisyPlatform"
  | "nearbyUnknownSegment"
  | "indexTimeFallback";

export interface PreprocessParams {
  filterMode: FilterMode;
  medianWindow: number;
  smoothWindow: number;
  smoothOrder: number;
  clippingPercentile: number;
  manualBaseline: number;
}

export interface PlateauParams {
  thresholdLow: number;
  thresholdHigh: number;
  minLength: number;
  maxLength: number;
  deviationThreshold: number;
}

/**
 * Dual-state droplet parameters. `minSegmentLength`, `stabilityWindow` and
 * `edgeTrimFraction` steer *detection*; the remaining fields are advanced
 * tolerances with sensible defaults. None of them changes how a level is measured:
 * every physical number still comes from the raw signal.
 */
export interface DropletParams {
  amplitudeBands?: AmplitudeBands | null;
  minSegmentLength: number;
  maxSegmentLength: number;
  stabilityWindow: number;
  edgeTrimFraction: number;
  outlierSigma: number;
  allowSingleSidedReference: boolean;
  despikeWindow: number;
  despikeSigma: number;
  noiseFactor: number;
  slopeFactor: number;
  clusterSeparationFactor: number;
  referenceGapFactor: number;
}

export interface AmplitudeBands {
  lowMin: number;
  lowMax: number;
  highMin: number;
  highMax: number;
}
export interface XRange { min: number | null; max: number | null }

export interface AnalysisRequest {
  xRange?: XRange | null;
  mode: AnalysisMode;
  preprocess: PreprocessParams;
  plateau: PlateauParams;
  droplet: DropletParams;
}

export interface ColumnInfo {
  index: number;
  name: string;
}

export interface FileInspection {
  fileName: string;
  rowCount: number;
  columns: ColumnInfo[];
  samples?: SampleMetadata[];
  suggestedSignalColumn?: number | null;
  suggestedTimeColumn?: number | null;
}

export interface DatasetSummary {
  fileName: string;
  pointCount: number;
  droppedRows: number;
  hasRealTime: boolean;
  columns: ColumnInfo[];
  sample?: SampleMetadata | null;
}

export interface SampleCoordinates {
  latitude: number;
  longitude: number;
}

export interface SampleMetadata {
  key: string;
  sampleId: string | null;
  missionId: string | null;
  sampleName: string | null;
  startedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  positionSource: string | null;
  simulated: boolean;
  outcome: string | null;
  invalidPosition: boolean;
  rowCount: number;
}

interface SampleConcentration {
  value: number;
  unit: string;
  curve: { id: string; name: string; updatedAt: string; slope: number; intercept: number } | null;
  notices: string[];
}

export interface SaveSampleRequest {
  resultId: number;
  replaceExisting: boolean;
  name: string;
  analyte: string;
  concentration: SampleConcentration | null;
  manualCoordinates?: SampleCoordinates | null;
}

export interface SamplingRecord extends Omit<SaveSampleRequest, "resultId" | "replaceExisting"> {
  id: number;
  savedAt: string;
  source: {
    path: string;
    fileName: string;
    signalColumn: number;
    timeColumn: number | null;
    metadata: SampleMetadata | null;
  };
  response: number | null;
  detectionCount: number;
  pointCount: number;
  parameters: AnalysisRequest;
  warnings: string[];
}

export interface PlateauFeature {
  number: number;
  centerIndex: number;
  center: number;
  start: number;
  end: number;
  height: number;
  length: number;
  standardDeviation: number;
}

/** One stable region of the detection signal, with its raw-signal level. */
export interface StableSegment {
  number: number;
  startIndex: number;
  endIndex: number;
  centerIndex: number;
  start: number;
  end: number;
  center: number;
  /** Robust level measured on the raw interior, never on the smoothed signal. */
  level: number;
  standardDeviation: number;
  mad: number;
  slope: number;
  length: number;
  effectiveLength: number;
  kind: SegmentKind;
  confidence: number;
}

/** One droplet: a high segment minus the low baseline at its own center. */
export interface DropletMeasurement {
  number: number;
  highSegment: number;
  leftLowSegment: number | null;
  rightLowSegment: number | null;
  centerIndex: number;
  center: number;
  highLevel: number;
  leftLowLevel: number | null;
  rightLowLevel: number | null;
  baselineReference: number;
  correctedSignal: number;
  referenceMode: ReferenceMode;
  confidence: number;
  qualityFlags: QualityFlag[];
}

export interface DropletStatistics {
  dropletCount: number;
  meanCorrectedSignal: number | null;
  minCorrectedSignal: number | null;
  maxCorrectedSignal: number | null;
  standardDeviation: number | null;
  rsd: number | null;
  meanHigh: number | null;
  meanBaseline: number | null;
  /** Full detected high-platform lengths, in samples, including unpaired highs. */
  meanLength: number | null;
  lengthStandardDeviation: number | null;
  lengthRsd: number | null;
  interpolatedCount: number;
  singleSidedCount: number;
  lowConfidenceCount: number;
  unknownSegmentCount: number;
}

export interface AnalysisStatistics {
  featureCount: number;
  meanHeight: number | null;
  maxHeight: number | null;
  minHeight: number | null;
  standardDeviation: number | null;
  rsd: number | null;
  meanLength: number | null;
  lengthStandardDeviation: number | null;
}

export interface PlotSeries {
  x: number[];
  original: number[];
  processed: number[];
}

export interface AnalysisResponse {
  resultId: number;
  mode: AnalysisMode;
  plot: PlotSeries;
  plateauFeatures: PlateauFeature[];
  statistics: AnalysisStatistics;
  stableSegments: StableSegment[];
  dropletMeasurements: DropletMeasurement[];
  dropletStatistics: DropletStatistics;
  usedCachedPreprocess: boolean;
  warnings: string[];
}

export const DEFAULT_REQUEST: AnalysisRequest = {
  mode: "droplet",
  preprocess: {
    filterMode: "clip_smooth",
    medianWindow: 5,
    smoothWindow: 51,
    smoothOrder: 3,
    clippingPercentile: 98,
    manualBaseline: 0,
  },
  plateau: {
    thresholdLow: 0.1,
    thresholdHigh: 0.5,
    minLength: 5,
    maxLength: 1000,
    deviationThreshold: 20,
  },
  droplet: {
    amplitudeBands: { lowMin: -0.07, lowMax: 0.01, highMin: 0.1, highMax: 0.5 },
    minSegmentLength: 150,
    maxSegmentLength: 0,
    stabilityWindow: 15,
    edgeTrimFraction: 0.08,
    outlierSigma: 3,
    allowSingleSidedReference: true,
    despikeWindow: 5,
    despikeSigma: 3,
    noiseFactor: 6,
    slopeFactor: 3,
    clusterSeparationFactor: 2.5,
    referenceGapFactor: 3,
  },
};

/** Restore parameters for a new run without changing the saved record or curve. */
export function currentAnalysisRequest(saved: AnalysisRequest): AnalysisRequest {
  const request = structuredClone(saved);
  const droplet = { ...structuredClone(DEFAULT_REQUEST.droplet), ...request.droplet };
  if (!request.droplet?.amplitudeBands) {
    droplet.amplitudeBands = structuredClone(DEFAULT_REQUEST.droplet.amplitudeBands);
    droplet.maxSegmentLength = 0;
  }
  return {
    ...request,
    mode: "droplet",
    preprocess: { ...DEFAULT_REQUEST.preprocess, ...request.preprocess },
    plateau: { ...DEFAULT_REQUEST.plateau, ...request.plateau },
    droplet,
  };
}
