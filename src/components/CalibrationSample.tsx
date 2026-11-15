import { Download } from "lucide-react";

import {
  RESPONSE_DEFINITION_LABELS,
  type CalibrationCurve,
  type ResponseDefinition,
} from "../lib/calibration";
import { scientificNumber as fmt } from "../lib/calibration-export";

/** Result of substituting the analysed sample into one saved curve. */
export interface SampleOutcome {
  value: number | null;
  extrapolated: boolean;
  error: string;
  notices: string[];
  matched: boolean;
  curveDefinition: ResponseDefinition | null;
  sampleDefinition: ResponseDefinition | null;
}

interface Props {
  /** Strip sits above the analysis view; panel is the full workspace section. */
  variant: "strip" | "panel";
  curves: CalibrationCurve[];
  curve: CalibrationCurve | undefined;
  selected: string;
  onSelect: (id: string) => void;
  baseline: string;
  onBaseline: (value: string) => void;
  sampleName: string | null;
  sampleResponse: number | null;
  outcome: SampleOutcome | null;
  busy: boolean;
  onExport: () => void;
  onOpen: () => void;
}

/**
 * Concentration read-out for the current analysis.
 *
 * Kept mode-agnostic on purpose: any saved curve can be applied to any finished
 * result. When the curve and the sample disagree on the response definition the
 * number is still produced, with an explicit notice instead of a blocking error.
 */
export function CalibrationSample({
  variant, curves, curve, selected, onSelect, baseline, onBaseline,
  sampleName, sampleResponse, outcome, busy, onExport, onOpen,
}: Props) {
  const panel = variant === "panel";
  return (
    <div className={panel ? "sample-lookup sample-panel-variant" : "sample-lookup"}>
      {panel && (
        <div className="sample-heading">
          <h3>样品浓度反算</h3>
          <span>直接代入已保存曲线，不要求分析模式一致；响应定义不同时会在下方标注。</span>
        </div>
      )}
      <div className="sample-controls">
        <label>
          {panel ? "使用曲线" : "已保存曲线"}
          <select value={selected} onChange={event => onSelect(event.target.value)}>
            <option value="">不使用曲线</option>
            {curves.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}{item.unit ? ` (${item.unit})` : ""}
              </option>
            ))}
          </select>
        </label>
        {curve && (
          <label>
            样品额外基线
            <input type="number" step="any" value={baseline} onChange={event => onBaseline(event.target.value)} />
          </label>
        )}
        {outcome?.error ? (
          <span className="sample-hint">{outcome.error}</span>
        ) : outcome?.value != null && (
          <output className={outcome.matched ? "sample-value" : "sample-value reference"}>
            浓度：{fmt(outcome.value)} {curve?.unit ?? ""}
            {outcome.extrapolated ? " · 超出标定范围（外推）" : ""}
          </output>
        )}
        {curve && (
          <button className="button secondary" type="button" disabled={busy || outcome?.value == null} onClick={onExport}>
            <Download size={15} aria-hidden="true" />导出浓度 CSV
          </button>
        )}
        {!panel && <button className="button secondary" type="button" onClick={onOpen}>管理工作曲线</button>}
        {!panel && sampleName && <span className="sample-source">当前文件：{sampleName}</span>}
      </div>
      {curve && outcome && !outcome.error && (
        <p className="sample-definition">
          <span>曲线响应：{outcome.curveDefinition ? RESPONSE_DEFINITION_LABELS[outcome.curveDefinition] : "—"}</span>
          <span>本次数据：{outcome.sampleDefinition ? RESPONSE_DEFINITION_LABELS[outcome.sampleDefinition] : "—"}</span>
          <span className={outcome.matched ? "definition-match" : "definition-mismatch"}>
            {outcome.matched ? "定义一致" : "定义不同 · 仅作参考"}
          </span>
          {sampleResponse != null && <span>代入值 {fmt(sampleResponse)}</span>}
        </p>
      )}
      {outcome?.notices.map(notice => <p className="sample-notice" key={notice}>{notice}</p>)}
      {!curves.length && (
        <p className="sample-hint">
          还没有保存的工作曲线；在“工作曲线”中拟合并保存后，即可按当前文件的响应反算浓度。
        </p>
      )}
      {curves.length > 0 && !curve && (
        <p className="sample-hint">选择一条已保存曲线后，按当前文件的响应反算浓度；不要求分析模式一致。</p>
      )}
    </div>
  );
}
