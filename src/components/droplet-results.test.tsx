import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultsTable } from "./ResultsTable";
import { SummaryPanel } from "./SummaryPanel";
import { SAMPLE_DROPLET_RESULT as result } from "../lib/sample";
import { indexDroplets, segmentUse } from "../lib/droplet";

const noop = () => {};
describe("high-centered droplet evidence", () => {
  it("shows high identity, low reference IDs and explicitly distinguishes single-sided from interpolation", () => {
    const html = renderToStaticMarkup(<ResultsTable result={result} exporting={null} onExportData={noop} onExportChart={noop} onExportWaveform={noop} />);
    for (const text of ["高平台实测值", "左低平台 / 电平", "右低平台 / 电平", "低平台基线", "双侧低平台插值", "仅右低平台（未插值）", "仅左低平台（未插值）", "规则评分不是准确率", "全部检测区段"]) expect(html).toContain(text);
    for (const m of result.dropletMeasurements) {
      expect(html).toContain(`查看H${m.highSegment}的检测与基线关系`);
      for (const id of [m.leftLowSegment, m.rightLowSegment]) if (id != null) expect(html).toContain(`查看L${id}的检测与基线关系`);
    }
  });
  it("preserves detected-but-unmeasured and unused evidence", () => {
    const isolated = { ...result, dropletMeasurements: [] };
    const index = indexDroplets(isolated);
    expect(segmentUse(result.stableSegments[0], index)).toBe("已检测 · 未形成测量");
    expect(segmentUse(result.stableSegments[1], index)).toBe("已检测 · 未被用作基线");
    const html = renderToStaticMarkup(<ResultsTable result={isolated} exporting={null} onExportData={noop} onExportChart={noop} onExportWaveform={noop} />);
    expect(html).toContain("全部检测区段");
    expect(html).toContain("没有形成测量的高平台");
    expect(html).not.toContain('disabled="" class="button quiet compact-button"');
  });
  it("resolves shared low references to all high users", () => {
    const index = indexDroplets(result);
    const low = result.stableSegments.find(s => s.kind === "bottom")!;
    expect(index.byLow.get(low.number)?.map(m => m.highSegment)).toEqual([1, 3]);
    expect(segmentUse(low, index)).toContain("H1、H3");
  });
  it("shows the selected high's actual baseline and retains its quality flags", () => {
    const m = result.dropletMeasurements[1];
    const html = renderToStaticMarkup(<SummaryPanel result={result} busy={false} dirty={false} status="测试"
      selectedSegment={m.highSegment} onSelectSegment={noop} />);
    for (const text of [`H${m.highSegment}`, `L${m.leftLowSegment}`, `L${m.rightLowSegment}`, "高平台中心", "规则评分偏低", "Δ ="]) expect(html).toContain(text);
    for (const text of ["平均高平台长度（点）", "高平台长度标准差（点）", "高平台长度 RSD"]) expect(html).toContain(text);
  });

  it("offers a waveform CSV even without measured droplets, and disables it during export", () => {
    const html = renderToStaticMarkup(<ResultsTable result={{ ...result, dropletMeasurements: [] }} exporting={null}
      onExportData={noop} onExportChart={noop} onExportWaveform={noop} />);
    expect(html).toContain("导出波形 CSV");
    const busy = renderToStaticMarkup(<ResultsTable result={result} exporting="waveform"
      onExportData={noop} onExportChart={noop} onExportWaveform={noop} />);
    expect(busy).toContain("导出中…");
    expect((busy.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
