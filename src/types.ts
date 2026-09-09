export type AnalysisMode = "plateau";
export type FilterMode = "clip_smooth" | "median_smooth";

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

export interface AnalysisRequest {
  mode: AnalysisMode;
  preprocess: PreprocessParams;
  plateau: PlateauParams;
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
  usedCachedPreprocess: boolean;
  warnings: string[];
}

export interface ParameterSuggestion {
  ok: boolean;
  message: string;
  plateau: PlateauParams | null;
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
};
