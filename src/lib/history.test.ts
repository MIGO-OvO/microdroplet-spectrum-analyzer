import { describe, expect, it } from "vitest";

import { currentAnalysisRequest, DEFAULT_REQUEST } from "../types";
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  appendHistory,
  createHistoryEntry,
  historyTable,
  historyConcentrations,
  loadHistory,
  parseHistory,
  saveHistory,
} from "./history";
import { SAMPLE_DROPLET_RESULT, SAMPLE_RESULT, SAMPLE_SUMMARY } from "./sample";
import { newCurve, type CalibrationCurve } from "./calibration";

const origin = { path: "D:/data/standard-3.csv", signalColumn: 1, timeColumn: 0 };
const legacyRequest = { ...DEFAULT_REQUEST, mode: "plateau" as const };

function plateauEntry() {
  return createHistoryEntry({
    result: SAMPLE_RESULT, summary: SAMPLE_SUMMARY, request: legacyRequest,
    origin, at: "2026-10-01T08:00:00.000Z",
  });
}

describe("processing history records", () => {
  it("records the measured response, count and reload origin of a plateau run", () => {
    const entry = plateauEntry();
    expect(entry.mode).toBe("plateau");
    expect(entry.response).toBe(SAMPLE_RESULT.statistics.meanHeight);
    expect(entry.responseLabel).toBe("平台平均高度");
    expect(entry.count).toBe(SAMPLE_RESULT.statistics.featureCount);
    expect(entry.fileName).toBe(SAMPLE_SUMMARY.fileName);
    expect(entry.filePath).toBe(origin.path);
    expect(entry.signalColumn).toBe(1);
    expect(entry.timeColumn).toBe(0);
    expect(entry.recordedAt).toBe("2026-10-01T08:00:00.000Z");
    expect(entry.source).toBe(SAMPLE_SUMMARY.fileName);
    expect(entry.note).toBe("");
    expect(entry.parameters).toEqual(legacyRequest);
  });

  it("uses the corrected Δ of a droplet run instead of a plateau height", () => {
    const entry = createHistoryEntry({
      result: SAMPLE_DROPLET_RESULT, summary: SAMPLE_SUMMARY,
      request: { ...DEFAULT_REQUEST, mode: "droplet" }, origin: null,
    });
    expect(entry.mode).toBe("droplet");
    expect(entry.response).toBe(SAMPLE_DROPLET_RESULT.dropletStatistics.meanCorrectedSignal);
    expect(entry.responseLabel).toBe("高平台 − 低平台基线 Δ");
    expect(entry.count).toBe(SAMPLE_DROPLET_RESULT.dropletMeasurements.length);
    expect(entry.filePath).toBeNull();
    expect(entry.signalColumn).toBeNull();
    expect(entry.meanLength).toBe(SAMPLE_DROPLET_RESULT.dropletStatistics.meanLength);
    expect(entry.lengthStandardDeviation).toBe(SAMPLE_DROPLET_RESULT.dropletStatistics.lengthStandardDeviation);
    expect(entry.lengthRsd).toBe(SAMPLE_DROPLET_RESULT.dropletStatistics.lengthRsd);
  });

  it("reloads pre-droplet parameters through the current engine and preserves the stored response", () => {
    const old = JSON.parse(JSON.stringify(plateauEntry()));
    delete old.parameters.droplet;
    old.parameters.xRange = { min: 100, max: 500 };
    old.parameters.preprocess.manualBaseline = -0.02;
    const restored = parseHistory(JSON.stringify({ version: 1, entries: [old] })).entries[0];
    expect(restored.parameters).toEqual(old.parameters);
    const active = currentAnalysisRequest(restored.parameters!);
    expect(active.mode).toBe("droplet");
    expect(active.droplet).toEqual(DEFAULT_REQUEST.droplet);
    expect(active.xRange).toEqual({ min: 100, max: 500 });
    expect(active.preprocess.manualBaseline).toBe(-0.02);
    active.preprocess.manualBaseline = 1;
    expect(restored.parameters?.preprocess.manualBaseline).toBe(-0.02);
    expect(restored.mode).toBe("plateau");
    expect(restored.response).toBe(SAMPLE_RESULT.statistics.meanHeight);
    expect(restored.responseLabel).toBe("平台平均高度");
    const manual = currentAnalysisRequest({ ...DEFAULT_REQUEST, droplet: { ...DEFAULT_REQUEST.droplet,
      amplitudeBands: { lowMin: -0.04, lowMax: -0.03, highMin: -0.02, highMax: 0.03 } } });
    expect(manual.droplet.amplitudeBands?.lowMin).toBe(-0.04);
  });

  it("keeps the operator's source label when the record is normalized again", () => {
    const entry = { ...plateauEntry(), source: "第 3 批 · 样品 A", note: "更换毛细管后首次测量" };
    const normalized = parseHistory(JSON.stringify({ version: 1, entries: [entry] })).entries[0];
    expect(normalized.source).toBe("第 3 批 · 样品 A");
    expect(normalized.note).toBe("更换毛细管后首次测量");
    expect(normalized).toEqual(entry);
  });

  it("leaves missing historical length statistics blank and preserves the recorded response definition", () => {
    const old = JSON.parse(JSON.stringify(plateauEntry()));
    delete old.meanLength;
    delete old.lengthStandardDeviation;
    delete old.lengthRsd;
    delete old.responseDefinition;
    old.mode = "droplet";
    old.responseLabel = "旧版低平台中心 Δ";
    const restored = parseHistory(JSON.stringify({ version: 1, entries: [old] })).entries[0];
    expect(restored.meanLength).toBeNull();
    expect(restored.lengthStandardDeviation).toBeNull();
    expect(restored.lengthRsd).toBeNull();
    expect(restored.response).toBe(old.response);
    expect(restored.responseDefinition).toBe("legacyLowCenteredDelta");
  });

  it("skips unusable records instead of failing the whole library", () => {
    const good = plateauEntry();
    const text = JSON.stringify({
      version: 1,
      entries: [
        good,
        { id: "broken", fileName: "x.csv", mode: "unknown" },
        { ...good, id: "no-mode", mode: undefined },
        { ...good, id: "misplaced-column", signalColumn: "one" },
      ],
    });
    const parsed = parseHistory(text);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.skipped).toBe(2);
    expect(parsed.entries[1].signalColumn).toBeNull();
  });

  it("rejects a library with an unsupported envelope", () => {
    expect(() => parseHistory(JSON.stringify({ version: 2, entries: [] }))).toThrow("格式或版本不受支持");
    expect(() => parseHistory(JSON.stringify({ version: 1 }))).toThrow("格式或版本不受支持");
  });
});

const curve: CalibrationCurve = { ...newCurve(), name: "浓度曲线", unit: "μmol/L", points: [0, 1, 2].map(x => ({
  id: `point-${x}`, concentration: x, response: 2 * x + 1, weight: 1,
  source: `standard-${x}.csv`, capturedAt: "2026-11-15", parameters: legacyRequest,
})) };

describe("history concentration calculation", () => {
  it("uses saved responses immediately and recalculates when the selected curve changes", () => {
    const entry = { ...plateauEntry(), response: 5 };
    const snapshot = structuredClone(entry);
    const first = historyConcentrations([entry], curve)[0];
    expect(first.value).toBeCloseTo(2);
    expect(first.notices).toEqual([]);
    const second = historyConcentrations([entry], { ...curve, points: curve.points.map(p => ({ ...p, response: p.concentration * 4 + 1 })) })[0];
    expect(second.value).toBeCloseTo(1);
    expect(entry).toEqual(snapshot);
    expect(historyConcentrations([entry])[0].value).toBeNull();
  });

  it("keeps extrapolated and negative values, and identifies incompatible definitions", () => {
    const entry = { ...plateauEntry(), mode: "droplet" as const, response: -1,
      responseDefinition: "highMinusLowBaselineV1" as const };
    const calculated = historyConcentrations([entry], curve)[0];
    expect(calculated.value).toBeCloseTo(-1);
    expect(calculated.notices).toContain("负浓度");
    expect(calculated.notices).toContain("超出标定范围");
    expect(calculated.notices).toContain("响应定义不同");
    const legacyCurve = { ...curve, points: curve.points.map(p => ({ ...p, parameters: DEFAULT_REQUEST })) };
    const legacyEntry = { ...entry, response: 3, responseDefinition: "legacyLowCenteredDelta" as const, parameters: DEFAULT_REQUEST };
    expect(historyConcentrations([legacyEntry], legacyCurve)[0].notices).toEqual([]);
  });

  it("does not turn missing responses or invalid equations into zero concentrations", () => {
    expect(historyConcentrations([{ ...plateauEntry(), response: null }], curve)[0]).toMatchObject({ value: null, error: "该记录没有可用响应" });
    const flat = { ...curve, points: curve.points.map(p => ({ ...p, response: 1 })) };
    expect(historyConcentrations([plateauEntry()], flat)[0].error).toContain("斜率为零");
    const incomplete = historyConcentrations([plateauEntry()], { ...curve, points: [] })[0];
    expect(incomplete.value).toBeNull();
    expect(incomplete.error).toContain("至少添加两个");
  });

  it("does not assign a current response definition to a legacy record that never saved one", () => {
    const old = JSON.parse(JSON.stringify(plateauEntry()));
    old.mode = "droplet";
    old.response = 3;
    delete old.responseLabel;
    delete old.responseDefinition;
    const restored = parseHistory(JSON.stringify({ version: 1, entries: [old] })).entries[0];
    expect(restored.responseLabel).toBe("未记录响应定义");
    expect(restored.responseDefinition).toBeNull();
    const calculated = historyConcentrations([restored], curve)[0];
    expect(calculated.value).toBeCloseTo(1);
    expect(calculated.notices).toContain("响应定义未记录");
  });

  it("exports concentrations, the equation and length statistics in the same rows", () => {
    const entry = { ...plateauEntry(), response: 5 };
    const table = historyTable([entry], curve);
    const column = (label: string) => table[1][table[0].indexOf(label)];
    expect(table[1]).toHaveLength(table[0].length);
    expect(column("浓度")).toBeCloseTo(2);
    expect(column("浓度单位")).toBe("μmol/L");
    expect(column("工作曲线")).toBe("浓度曲线");
    expect(column("曲线斜率")).toBeCloseTo(2);
    expect(column("曲线截距")).toBeCloseTo(1);
    expect(column("平均高平台长度（点）")).toBe(entry.meanLength);
    expect(column("高平台长度 RSD (%)")).toBe(entry.lengthRsd);
  });
});

describe("processing history storage", () => {
  it("round-trips through the local store", () => {
    const entries = [plateauEntry()];
    const store = new Map<string, string>();
    saveHistory(entries, (key, value) => { store.set(key, value); });
    expect(store.has(HISTORY_KEY)).toBe(true);
    expect(loadHistory(key => store.get(key) ?? null)).toEqual({ entries, error: "" });
  });

  it("reports a corrupted store without clearing it", () => {
    const restored = loadHistory(() => "{not json");
    expect(restored.entries).toEqual([]);
    expect(restored.error).toContain("历史记录无法读取");
  });

  it("warns when the store contained records that could not be read", () => {
    const saved = JSON.stringify({ version: 1, entries: [plateauEntry(), { id: "x", fileName: "y", mode: "bad" }] });
    const restored = loadHistory(() => saved);
    expect(restored.entries).toHaveLength(1);
    expect(restored.error).toContain("1 条记录无法识别");
  });

  it("keeps the newest records and enforces the storage bound", () => {
    const base = plateauEntry();
    const filled = Array.from({ length: HISTORY_LIMIT }, (_, index) => ({ ...base, id: `entry-${index}` }));
    const appended = appendHistory(filled, { ...base, id: "newest" });
    expect(appended).toHaveLength(HISTORY_LIMIT);
    expect(appended[0].id).toBe("newest");
    expect(appended.at(-1)?.id).toBe(`entry-${HISTORY_LIMIT - 2}`);
  });
});

describe("processing history export", () => {
  it("exports one rectangular row per record", () => {
    const entry = { ...plateauEntry(), source: "第 3 批 · 样品 A" };
    const table = historyTable([entry]);
    expect(table[0][0]).toBe("记录时间");
    expect(table[0]).toContain("数据来源");
    expect(table).toHaveLength(2);
    expect(table[1][1]).toBe(SAMPLE_SUMMARY.fileName);
    expect(table[1][3]).toBe("第 3 批 · 样品 A");
    expect(table[1]).toContain(entry.response);
  });
});
