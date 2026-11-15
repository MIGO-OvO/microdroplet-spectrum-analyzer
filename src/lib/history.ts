import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import type { AnalysisMode, AnalysisRequest, AnalysisResponse, DatasetSummary } from "../types";
import { isTauriRuntime } from "./bridge";
import {
  RESPONSE_DEFINITION_LABELS,
  analysisResponse,
  calibrationDefinition,
  calculateConcentration,
  fitCalibration,
  responseDefinitionForMode,
  type CalibrationCurve,
  type ResponseDefinition,
} from "./calibration";
import { errorMessage } from "./format";
import { tableCsv, type ExportCell } from "./calibration-export";

export const HISTORY_KEY = "microdroplet.history.v1";
/** Newest first; older records beyond this bound are dropped from the library. */
export const HISTORY_LIMIT = 300;

/** Original file position of a processed dataset, needed to reload it later. */
export interface HistoryOrigin {
  path: string;
  signalColumn: number;
  timeColumn: number | null;
}

/**
 * One processed dataset, as recorded by the application.
 *
 * Only values that were actually produced by an analysis are stored; nothing is
 * inferred later. `source` and `note` belong to the operator and are the only
 * fields meant to be edited after recording.
 */
export interface HistoryEntry {
  id: string;
  recordedAt: string;
  fileName: string;
  filePath: string | null;
  signalColumn: number | null;
  timeColumn: number | null;
  mode: AnalysisMode;
  /** Operator-supplied data origin, e.g. batch or sample identifier. */
  source: string;
  note: string;
  pointCount: number;
  droppedRows: number;
  /** Response the work curve substitutes: mean plateau height, or mean corrected Δ. */
  response: number | null;
  responseLabel: string;
  responseDefinition?: ResponseDefinition | null;
  /** Detected plateaus, or droplet measurements in droplet mode. */
  count: number;
  rsd: number | null;
  meanLength: number | null;
  lengthStandardDeviation: number | null;
  lengthRsd: number | null;
  warnings: number;
  parameters: AnalysisRequest | null;
}

export interface HistoryLibrary {
  version: 1;
  entries: HistoryEntry[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integerOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

function validRequest(value: unknown): value is AnalysisRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as AnalysisRequest;
  return ["plateau", "droplet"].includes(request.mode)
    && !!request.preprocess && !!request.plateau
    && (request.mode === "plateau" || !!request.droplet);
}

/** Build a record from a finished analysis. Never mutates its inputs. */
export function createHistoryEntry(input: {
  result: AnalysisResponse;
  summary: DatasetSummary;
  request: AnalysisRequest;
  origin: HistoryOrigin | null;
  at?: string;
}): HistoryEntry {
  const { result, summary, request, origin } = input;
  const droplet = result.mode === "droplet";
  return {
    id: crypto.randomUUID(),
    recordedAt: input.at ?? new Date().toISOString(),
    fileName: summary.fileName,
    filePath: origin?.path ?? null,
    signalColumn: origin?.signalColumn ?? null,
    timeColumn: origin?.timeColumn ?? null,
    mode: result.mode,
    source: summary.fileName,
    note: "",
    pointCount: summary.pointCount,
    droppedRows: summary.droppedRows,
    response: analysisResponse(result),
    responseLabel: RESPONSE_DEFINITION_LABELS[responseDefinitionForMode(result.mode)],
    responseDefinition: responseDefinitionForMode(result.mode),
    count: droplet ? result.dropletMeasurements.length : result.statistics.featureCount,
    rsd: droplet ? result.dropletStatistics.rsd : result.statistics.rsd,
    meanLength: droplet ? result.dropletStatistics.meanLength : result.statistics.meanLength,
    lengthStandardDeviation: droplet ? result.dropletStatistics.lengthStandardDeviation : result.statistics.lengthStandardDeviation,
    lengthRsd: droplet ? result.dropletStatistics.lengthRsd
      : result.statistics.meanLength && result.statistics.lengthStandardDeviation != null
        ? result.statistics.lengthStandardDeviation / result.statistics.meanLength * 100 : null,
    warnings: result.warnings.length,
    parameters: structuredClone(request),
  };
}

/** Normalize one stored record; returns null when the record is unusable. */
export function normalizeEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.fileName !== "string") return null;
  if (raw.mode !== "plateau" && raw.mode !== "droplet") return null;
  const mode: AnalysisMode = raw.mode;
  return {
    id: raw.id,
    recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : new Date(0).toISOString(),
    fileName: raw.fileName,
    filePath: typeof raw.filePath === "string" ? raw.filePath : null,
    signalColumn: integerOrNull(raw.signalColumn),
    timeColumn: integerOrNull(raw.timeColumn),
    mode,
    source: typeof raw.source === "string" ? raw.source : "",
    note: typeof raw.note === "string" ? raw.note : "",
    pointCount: finite(raw.pointCount) ? raw.pointCount : 0,
    droppedRows: finite(raw.droppedRows) ? raw.droppedRows : 0,
    response: finite(raw.response) ? raw.response : null,
    responseLabel: typeof raw.responseLabel === "string" && raw.responseLabel
      ? raw.responseLabel : mode === "plateau" ? RESPONSE_DEFINITION_LABELS.plateauHeight : "未记录响应定义",
    responseDefinition: typeof raw.responseDefinition === "string" && Object.hasOwn(RESPONSE_DEFINITION_LABELS, raw.responseDefinition)
      ? raw.responseDefinition as ResponseDefinition
      : (Object.entries(RESPONSE_DEFINITION_LABELS).find(([, label]) => label === raw.responseLabel)?.[0] as ResponseDefinition | undefined)
        ?? (mode === "plateau" ? "plateauHeight" : null),
    count: finite(raw.count) ? raw.count : 0,
    rsd: finite(raw.rsd) ? raw.rsd : null,
    meanLength: finite(raw.meanLength) ? raw.meanLength : null,
    lengthStandardDeviation: finite(raw.lengthStandardDeviation) ? raw.lengthStandardDeviation : null,
    lengthRsd: finite(raw.lengthRsd) ? raw.lengthRsd : null,
    warnings: finite(raw.warnings) ? raw.warnings : 0,
    parameters: validRequest(raw.parameters) ? raw.parameters : null,
  };
}

/** Parse a stored library. Malformed entries are skipped, never silently repaired. */
export function parseHistory(text: string): { entries: HistoryEntry[]; skipped: number } {
  const data = JSON.parse(text);
  if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error("历史记录文件格式或版本不受支持。");
  const seen = new Set<string>();
  const entries: HistoryEntry[] = [];
  let skipped = 0;
  for (const raw of data.entries.slice(0, HISTORY_LIMIT)) {
    const entry = normalizeEntry(raw);
    if (!entry || seen.has(entry.id)) { skipped += 1; continue; }
    seen.add(entry.id);
    entries.push(entry);
  }
  return { entries, skipped };
}

/**
 * Read the local library. A corrupted store is reported, not overwritten: the caller
 * decides whether to reset it, so recorded work is never destroyed by a parse error.
 */
export function loadHistory(
  read: (key: string) => string | null = key => localStorage.getItem(key),
): { entries: HistoryEntry[]; error: string } {
  try {
    const saved = read(HISTORY_KEY);
    if (!saved) return { entries: [], error: "" };
    const parsed = parseHistory(saved);
    return {
      entries: parsed.entries,
      error: parsed.skipped
        ? `本地历史中有 ${parsed.skipped} 条记录无法识别；为避免覆盖原存储，已暂停写入。请先重置历史存储再继续记录。`
        : "",
    };
  } catch (error) {
    return { entries: [], error: `历史记录无法读取，已暂停写入以免覆盖原数据：${String(error)}` };
  }
}

export function saveHistory(entries: HistoryEntry[], write: (key: string, value: string) => void = (key, value) => localStorage.setItem(key, value)) {
  const payload: HistoryLibrary = { version: 1, entries: entries.slice(0, HISTORY_LIMIT) };
  write(HISTORY_KEY, JSON.stringify(payload));
}

/** Prepend a record and enforce the storage bound. */
export function appendHistory(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries].slice(0, HISTORY_LIMIT);
}

export interface HistoryConcentration {
  value: number | null;
  slope: number | null;
  intercept: number | null;
  notices: string[];
  error: string;
}

/** Recalculate from recorded responses using one fitted, saved curve. */
export function historyConcentrations(entries: HistoryEntry[], curve?: CalibrationCurve): HistoryConcentration[] {
  const empty: HistoryConcentration = { value: null, slope: null, intercept: null, notices: [], error: "" };
  if (!curve) return entries.map(() => empty);
  let fit, curveDefinition;
  try { fit = fitCalibration(curve); curveDefinition = calibrationDefinition(curve); }
  catch (error) { return entries.map(() => ({ ...empty, error: errorMessage(error) })); }
  const equation = { slope: fit.slope, intercept: fit.intercept };
  const parameterSnapshots = new Set(curve.points.map(point => point.parameters ? JSON.stringify(point.parameters) : null));
  return entries.map(entry => {
    if (entry.response == null) return { ...empty, ...equation, error: "该记录没有可用响应" };
    try {
      const definition = entry.responseDefinition === undefined
        ? Object.entries(RESPONSE_DEFINITION_LABELS).find(([, label]) => label === entry.responseLabel)?.[0]
        : entry.responseDefinition;
      const concentration = calculateConcentration(fit, entry.response);
      const notices: string[] = [];
      if (!definition) notices.push("响应定义未记录");
      else if (definition !== curveDefinition) notices.push("响应定义不同");
      if (concentration.extrapolated) notices.push("超出标定范围");
      if (concentration.value < 0) notices.push("负浓度");
      if (!entry.parameters || parameterSnapshots.has(null)) notices.push("处理参数未记录");
      else if (parameterSnapshots.size > 1 || !parameterSnapshots.has(JSON.stringify(entry.parameters))) notices.push("处理参数不同");
      return { ...equation, value: concentration.value, notices, error: "" };
    } catch (error) { return { ...empty, ...equation, error: errorMessage(error) }; }
  });
}

export function historyTable(entries: HistoryEntry[], curve?: CalibrationCurve): ExportCell[][] {
  const concentrations = historyConcentrations(entries, curve);
  return [
    ["记录时间", "文件名", "文件路径", "数据来源", "备注", "分析模式", "数据点数", "忽略行数", "响应定义", "响应值", "检测数", "RSD (%)", "警告数", "处理参数",
      "平均高平台长度（点）", "高平台长度标准差（点，总体）", "高平台长度 RSD (%)", "工作曲线", "曲线 ID", "曲线更新时间", "曲线斜率", "曲线截距", "浓度", "浓度单位", "浓度状态"],
    ...entries.map((entry, index) => [
      entry.recordedAt, entry.fileName, entry.filePath, entry.source, entry.note,
      entry.mode === "droplet" ? "液滴双电平分析" : "平台检测",
      entry.pointCount, entry.droppedRows, entry.responseLabel, entry.response,
      entry.count, entry.rsd, entry.warnings,
      entry.parameters ? JSON.stringify(entry.parameters) : "",
      entry.meanLength ?? null, entry.lengthStandardDeviation ?? null, entry.lengthRsd ?? null,
      curve?.name ?? "", curve?.id ?? "", curve?.updatedAt ?? "", concentrations[index].slope, concentrations[index].intercept,
      concentrations[index].value, curve?.unit ?? "", concentrations[index].error || concentrations[index].notices.join("；"),
    ]),
  ];
}

/** Save the library as a UTF-8 CSV; desktop uses the native dialog. */
export async function exportHistoryCsv(entries: HistoryEntry[], curve?: CalibrationCurve): Promise<boolean> {
  const contents = tableCsv(historyTable(entries, curve));
  const stem = `处理历史_${new Date().toISOString().slice(0, 10)}`;
  if (isTauriRuntime()) {
    const path = await save({
      title: "导出处理历史",
      defaultPath: `${stem}.csv`,
      filters: [{ name: "CSV 表格", extensions: ["csv"] }],
    });
    if (!path) return false;
    await invoke("write_calibration_artifact", {
      path, contents: Array.from(new TextEncoder().encode(contents)), table: null,
    });
    return true;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${stem}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
