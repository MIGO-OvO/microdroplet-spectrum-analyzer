export type AnalysisMode = "plateau" | "droplet";
export type FilterMode = "clip_smooth" | "median_smooth";

/** Whether a stable segment is the upper state, the lower state, or unassigned. */
export type SegmentKind = "unknown" | "platform" | "bottom";

/** How `platformReference` was obtained for one droplet. */
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
}

export interface DatasetSummary {
  fileName: string;
  pointCount: number;
  droppedRows: number;
  hasRealTime: boolean;
  columns: ColumnInfo[];
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

/** One droplet: a Bottom segment plus its locally interpolated Platform reference. */
export interface DropletMeasurement {
  number: number;
  bottomSegment: number;
  leftPlatformSegment: number | null;
  rightPlatformSegment: number | null;
  centerIndex: number;
  center: number;
  bottomLevel: number;
  leftPlatformLevel: number | null;
  rightPlatformLevel: number | null;
  platformReference: number;
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
  meanBottom: number | null;
  meanPlatformReference: number | null;
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

export interface ParameterSuggestion {
  ok: boolean;
  message: string;
  plateau: PlateauParams | null;
  droplet: DropletParams | null;
}

export const DEFAULT_REQUEST: AnalysisRequest = {
  mode: "plateau",
  preprocess: {
    filterMode: "clip_smooth",
    medianWindow: 5,
    smoothWindow: 11,
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
    minSegmentLength: 8,
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
