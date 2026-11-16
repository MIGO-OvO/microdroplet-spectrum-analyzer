import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ParameterPanel } from "./ParameterPanel";
import { CalibrationPanel } from "./CalibrationPanel";
import { DEFAULT_REQUEST, type AnalysisRequest } from "../types";
import { SAMPLE_DROPLET_RESULT, SAMPLE_SUMMARY } from "../lib/sample";
import { LIBRARY_KEY, newCurve } from "../lib/calibration";

const manualRequest = {
  ...DEFAULT_REQUEST, mode: "droplet" as const,
  xRange: { min: 12000, max: 40000 },
  droplet: { ...DEFAULT_REQUEST.droplet, amplitudeBands: { lowMin: -0.01, lowMax: 0.01, highMin: 0.06, highMax: 0.08 } },
};
const noOp = () => {};
function parameters(request: AnalysisRequest = manualRequest) {
  return renderToStaticMarkup(<ParameterPanel summary={SAMPLE_SUMMARY} request={request}
    disabled={false} autoRefresh showLabels onRequestChange={noOp}
    onChooseFile={noOp} onAutoRefreshChange={noOp} onShowLabelsChange={noOp} />);
}

afterEach(() => vi.unstubAllGlobals());
describe("analysis controls without browser automation", () => {
  it("shows manual amplitude controls by default without automatic classification controls", () => {
    const html = parameters(DEFAULT_REQUEST);
    for (const label of ["高平台幅度下限", "高平台幅度上限", "低平台幅度下限", "低平台幅度上限"]) {
      expect(html).toContain(label);
    }
    for (const label of ["平台识别方式", "自动稳定段分类", "稳定性窗口", "噪声容差倍数", "趋势容差倍数", "两态分离倍数", "自动建议"]) {
      expect(html).not.toContain(label);
    }
    expect(html).toContain('value="51"');
    expect(html).toContain('value="150"');
  });
  it("renders separate amplitude windows and labeled inclusive x limits", () => {
    const html = parameters();
    for (const label of ["高平台幅度下限", "高平台幅度上限", "低平台幅度下限", "低平台幅度上限", "横坐标起点", "横坐标终点", "恢复全文件范围"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="12000"');
    expect(html).toContain('value="40000"');
    expect(html).toContain('value="0.06"');
    expect(html).not.toContain("削峰分位数");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain("边缘偏离阈值");
    expect(html).toContain("分析范围（数据点）");
    expect(html).not.toContain('role="alert"');
  });
  it("renders an actionable warning for overlapping bands", () => {
    const html = parameters({ ...manualRequest, droplet: { ...manualRequest.droplet,
      amplitudeBands: { ...manualRequest.droplet.amplitudeBands, lowMax: 0.07 } } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("低平台上限 &lt; 高平台下限");
  });
  it("renders editable per-point baselines and the captured droplet response", () => {
    const curve = { ...newCurve(), name: "Synthetic QA", points: [1, 2, 3].map((x, i) => ({
      id: `qa-${i}`, concentration: x, response: x * 2 + 1, baseline: 0.5, weight: 1,
      source: `synthetic-${i}.csv`, capturedAt: "2026-09-14", parameters: manualRequest,
    })) };
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === `${LIBRARY_KEY}.draft`
      ? JSON.stringify({ version: 1, curves: [curve] }) : null });
    const html = renderToStaticMarkup(<CalibrationPanel active result={SAMPLE_DROPLET_RESULT}
      summary={SAMPLE_SUMMARY} request={manualRequest} desktop onOpen={noOp} />);
    expect(html).toContain("平均高低差 Δ");
    expect(html).toContain('aria-label="标定点 1 额外基线"');
    expect(html).toContain('value="0.5"');
    expect(html).toContain("采集响应");
    expect(html).toContain("拟合响应");
    expect(html).toContain("不要重复填入");
  });
});
