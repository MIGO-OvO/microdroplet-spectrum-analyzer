import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CalibrationSample, type SampleOutcome } from "./CalibrationSample";
import { HistoryPanel } from "./HistoryPanel";
import { newCurve, type CalibrationCurve } from "../lib/calibration";
import type { HistoryEntry } from "../lib/history";

const noop = () => {};

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "qa-1", recordedAt: "2026-10-01T08:00:00.000Z", fileName: "sample-3.csv",
    filePath: "D:/data/sample-3.csv", signalColumn: 1, timeColumn: 0, mode: "droplet",
    source: "第 3 批 · 样品 A", note: "更换毛细管后首次测量", pointCount: 120000, droppedRows: 0,
    response: 0.0339, responseLabel: "高平台 − 低平台基线 Δ", count: 7, rsd: 2.4, warnings: 0,
    meanLength: 20, lengthStandardDeviation: 10, lengthRsd: 50,
    parameters: null, ...overrides,
  };
}

function history(entries: HistoryEntry[], error = "") {
  return renderToStaticMarkup(<HistoryPanel active entries={entries} error={error} canRecord
    curves={[]} onSelectCurve={noop}
    currentFileName="sample-3.csv" onRecord={noop} onReload={noop} onReuseParameters={noop}
    onUpdate={noop} onRemove={noop} onClear={noop} onResetStorage={noop} onExport={noop} />);
}

const curve: CalibrationCurve = { ...newCurve(), name: "QA 曲线", unit: "μmol/L" };

function lookup(outcome: SampleOutcome) {
  return renderToStaticMarkup(<CalibrationSample variant="strip" curves={[curve]} curve={curve} selected={curve.id}
    onSelect={noop} baseline="0" onBaseline={noop} sampleName="sample-3.csv" sampleResponse={0.0339}
    outcome={outcome} busy={false} onExport={noop} onOpen={noop} />);
}

const outcome = (overrides: Partial<SampleOutcome> = {}): SampleOutcome => ({
  value: 12.5, extrapolated: false, error: "", notices: [], matched: true,
  curveDefinition: "highMinusLowBaselineV1", sampleDefinition: "highMinusLowBaselineV1", ...overrides,
});

describe("history tab", () => {
  it("explains how records are created when the library is empty", () => {
    const html = history([]);
    expect(html).toContain("还没有处理记录");
    expect(html).toContain("记录当前结果");
    expect(html).toContain("当前文件：sample-3.csv");
  });

  it("exposes editable source and note fields next to read-only measurements", () => {
    const html = history([entry()]);
    expect(html).toContain('aria-label="sample-3.csv 的数据来源"');
    expect(html).toContain('value="第 3 批 · 样品 A"');
    expect(html).toContain('aria-label="sample-3.csv 的备注"');
    expect(html).toContain("液滴双电平分析");
    expect(html).toContain("0.0339");
    expect(html).toContain("重新载入");
    expect(html).toContain("复用参数");
  });

  it("reports a storage problem without hiding the existing rows", () => {
    const html = history([entry()], "历史记录无法读取");
    expect(html).toContain("历史记录无法读取");
    expect(html).toContain("重置历史存储");
    expect(html).toContain("sample-3.csv");
  });

  it("shows concentrations in the history table as soon as a saved curve is selected", () => {
    const selected: CalibrationCurve = { ...curve, points: [0, 1, 2].map(x => ({
      id: `p-${x}`, concentration: x, response: 0.01 + x * 0.002, weight: 1,
      source: `standard-${x}.csv`, capturedAt: "2026-11-15", parameters: null,
    })) };
    const html = renderToStaticMarkup(<HistoryPanel active entries={[entry({ response: 0.013 })]} error="" canRecord
      curves={[selected]} curve={selected} onSelectCurve={noop} currentFileName="sample-3.csv"
      onRecord={noop} onReload={noop} onReuseParameters={noop} onUpdate={noop} onRemove={noop}
      onClear={noop} onResetStorage={noop} onExport={noop} />);
    expect(html).toContain("浓度（μmol/L）");
    expect(html).toContain("1.5");
    expect(html).toContain("响应定义不同");
    expect(html).toContain("平均高平台长度（点）");
    expect(html).toContain("长度 RSD (%)");
  });
});

describe("sample concentration read-out", () => {
  it("computes a value and marks a cross-definition substitution as a reference", () => {
    const html = lookup(outcome({
      matched: false, curveDefinition: "plateauHeight", sampleDefinition: "highMinusLowBaselineV1",
      notices: ["曲线按「平台平均高度」建立，本次数据为「高平台 − 低平台基线 Δ」。已按当前响应代入计算，但两者定义不同，浓度仅作快速参考，不能直接作为定量结论。"],
    }));
    expect(html).toContain("浓度：12.5 μmol/L");
    expect(html).toContain("定义不同 · 仅作参考");
    expect(html).toContain("曲线响应：平台平均高度");
    expect(html).toContain("本次数据：高平台 − 低平台基线 Δ");
    expect(html).toContain("仅作快速参考");
    expect(html).toContain("sample-value reference");
  });

  it("presents a matched curve without any warning", () => {
    const html = lookup(outcome());
    expect(html).toContain("定义一致");
    expect(html).not.toContain("sample-notice");
    expect(html).not.toContain("仅作参考");
  });

  it("shows the reason when a curve cannot be fitted yet", () => {
    const html = lookup(outcome({ value: null, error: "至少添加两个不同浓度的标定点才能拟合。" }));
    expect(html).toContain("至少添加两个不同浓度的标定点才能拟合");
    expect(html).not.toContain("定义一致");
  });
});
