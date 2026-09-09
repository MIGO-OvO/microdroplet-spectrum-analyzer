import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  AnalysisRequest,
  AnalysisResponse,
  DatasetSummary,
  FileInspection,
  ParameterSuggestion,
  PreprocessParams,
  PlotSeries,
} from "../types";

export const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export async function chooseDataFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择实验数据文件",
    filters: [{ name: "实验数据", extensions: ["csv", "xlsx", "xls"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export function inspectDataFile(path: string): Promise<FileInspection> {
  return invoke<FileInspection>("inspect_data_file", { request: { path } });
}

export function loadDataFile(
  path: string,
  dataColumnIndex: number,
  timeColumnIndex: number | null,
): Promise<DatasetSummary> {
  return invoke<DatasetSummary>("load_data_file", {
    request: { path, dataColumnIndex, timeColumnIndex },
  });
}

export function runAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  return invoke<AnalysisResponse>("analyze_signal", { request });
}

export function suggestParameters(
  preprocess: PreprocessParams,
): Promise<ParameterSuggestion> {
  return invoke<ParameterSuggestion>("suggest_plateau_parameters", {
    request: { preprocess },
  });
}

function safeStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_") || "analysis";
}

export async function chooseResultsPath(fileName: string): Promise<string | null> {
  return save({
    title: "导出分析数据",
    defaultPath: `${safeStem(fileName)}_results.xlsx`,
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
  });
}

export async function chooseChartPath(fileName: string): Promise<string | null> {
  return save({
    title: "导出分析图表",
    defaultPath: `${safeStem(fileName)}_chart.png`,
    filters: [
      { name: "PNG 图像", extensions: ["png"] },
      { name: "SVG 矢量图", extensions: ["svg"] },
    ],
  });
}

export function exportResults(path: string): Promise<{ path: string }> {
  return invoke("export_results", { request: { path } });
}

export function exportChart(path: string): Promise<{ path: string }> {
  return invoke("export_chart", { request: { path } });
}

export function loadPlotView(resultId: number, xMin: number, xMax: number): Promise<PlotSeries> {
  return invoke("plot_view", { resultId, xMin, xMax });
}
