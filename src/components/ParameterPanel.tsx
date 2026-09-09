import {
  ChevronDown,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

import { formatPointCount } from "../lib/format";
import type { AnalysisRequest, DatasetSummary } from "../types";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  title?: string;
  significant?: boolean;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  title,
  significant,
}: NumberFieldProps) {
  return (
    <label className="number-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={significant && Number(value.toPrecision(2)) === value ? value.toPrecision(2) : value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

interface ParameterPanelProps {
  summary: DatasetSummary | null;
  request: AnalysisRequest;
  disabled: boolean;
  autoRefresh: boolean;
  showLabels: boolean;
  suggesting: boolean;
  onRequestChange: (request: AnalysisRequest) => void;
  onChooseFile: () => void;
  onSuggest: () => void;
  onAutoRefreshChange: (checked: boolean) => void;
  onShowLabelsChange: (checked: boolean) => void;
}

export function ParameterPanel({
  summary,
  request,
  disabled,
  autoRefresh,
  showLabels,
  suggesting,
  onRequestChange,
  onChooseFile,
  onSuggest,
  onAutoRefreshChange,
  onShowLabelsChange,
}: ParameterPanelProps) {
  const updatePreprocess = (patch: Partial<AnalysisRequest["preprocess"]>) =>
    onRequestChange({
      ...request,
      preprocess: { ...request.preprocess, ...patch },
    });
  const updatePlateau = (patch: Partial<AnalysisRequest["plateau"]>) =>
    onRequestChange({ ...request, plateau: { ...request.plateau, ...patch } });

  return (
    <aside className="parameter-panel" aria-label="分析参数">
      <div className="panel-section file-section">
        <div className="section-heading">
          <FileSpreadsheet size={17} aria-hidden="true" />
          <h2>数据文件</h2>
        </div>
        {summary ? (
          <dl className="file-facts">
            <div>
              <dt>文件</dt>
              <dd title={summary.fileName}>{summary.fileName}</dd>
            </div>
            <div>
              <dt>有效数据点</dt>
              <dd>{formatPointCount(summary.pointCount)}</dd>
            </div>
            <div>
              <dt>横轴</dt>
              <dd>{summary.hasRealTime ? "时间列" : "数据点序号"}</dd>
            </div>
            {summary.droppedRows > 0 && (
              <div>
                <dt>已忽略行</dt>
                <dd>{formatPointCount(summary.droppedRows)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="panel-empty-copy">尚未载入实验数据。</p>
        )}
        <button className="button secondary full-width" type="button" onClick={onChooseFile}>
          <FolderOpen size={17} aria-hidden="true" />
          {summary ? "更换数据文件" : "加载数据文件"}
        </button>
      </div>

      <details className="parameter-group" open>
        <summary>
          <span>
            <SlidersHorizontal size={17} aria-hidden="true" />
            预处理
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="parameter-fields">
          <label className="field-stack compact">
            <span>平滑过滤方式</span>
            <select
              value={request.preprocess.filterMode}
              disabled={disabled}
              onChange={(event) =>
                updatePreprocess({
                  filterMode: event.target.value as AnalysisRequest["preprocess"]["filterMode"],
                })
              }
            >
              <option value="clip_smooth">削峰 + 平滑（推荐）</option>
              <option value="median_smooth">中值 + 平滑（旧版）</option>
            </select>
          </label>
          <NumberField
            label="削峰分位数 (%)"
            value={request.preprocess.clippingPercentile}
            min={90}
            max={100}
            step={0.1}
            disabled={disabled || request.preprocess.filterMode !== "clip_smooth"}
            title="高于该分位数的极端值会先被削平。"
            onChange={(clippingPercentile) => updatePreprocess({ clippingPercentile })}
          />
          <NumberField
            label="中值滤波窗口"
            value={request.preprocess.medianWindow}
            min={3}
            max={21}
            step={2}
            disabled={disabled || request.preprocess.filterMode !== "median_smooth"}
            title="用于去除孤立突变点，分析时会归一化为奇数。"
            onChange={(medianWindow) => updatePreprocess({ medianWindow })}
          />
          <NumberField
            label="平滑窗口"
            value={request.preprocess.smoothWindow}
            min={3}
            max={51}
            step={2}
            disabled={disabled}
            title="Savitzky–Golay 平滑窗口，分析时会归一化为奇数。"
            onChange={(smoothWindow) => updatePreprocess({ smoothWindow })}
          />
          <NumberField
            label="手动基线"
            value={request.preprocess.manualBaseline}
            min={-1000}
            max={1000}
            step={0.001}
            disabled={disabled}
            title="从整条处理后信号中减去该数值。"
            onChange={(manualBaseline) => updatePreprocess({ manualBaseline })}
          />
        </div>
      </details>

      <details className="parameter-group" open>
        <summary>
          <span>
            <RefreshCw size={17} aria-hidden="true" />
            平台检测参数
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="parameter-fields">
            <>
              <NumberField
                label="幅度下限"
                significant
                value={request.plateau.thresholdLow}
                min={-1000}
                max={1000}
                step={0.001}
                disabled={disabled}
                title="低于该数值的数据点不计入平台。"
                onChange={(thresholdLow) => updatePlateau({ thresholdLow })}
              />
              <NumberField
                label="幅度上限"
                significant
                value={request.plateau.thresholdHigh}
                min={-1000}
                max={1000}
                step={0.001}
                disabled={disabled}
                title="高于该数值的数据点不计入平台。"
                onChange={(thresholdHigh) => updatePlateau({ thresholdHigh })}
              />
              <NumberField
                label="最小长度"
                value={request.plateau.minLength}
                min={0}
                max={1000}
                step={1}
                disabled={disabled}
                title="平台必须包含的最少连续数据点。"
                onChange={(minLength) => updatePlateau({ minLength })}
              />
              <NumberField
                label="最大长度"
                value={request.plateau.maxLength}
                min={0}
                max={5000}
                step={1}
                disabled={disabled}
                title="用于排除异常长的信号段。"
                onChange={(maxLength) => updatePlateau({ maxLength })}
              />
              <NumberField
                label="边缘偏离阈值 (%)"
                value={request.plateau.deviationThreshold}
                min={0}
                max={100}
                step={1}
                disabled={disabled}
                title="精炼平台高度时剔除偏高边缘点。"
                onChange={(deviationThreshold) => updatePlateau({ deviationThreshold })}
              />
              <button
                className="button quiet full-width"
                type="button"
                onClick={onSuggest}
                disabled={disabled || !summary || suggesting}
              >
                <Sparkles size={16} aria-hidden="true" />
                {suggesting ? "正在计算建议…" : "自动建议参数"}
              </button>
            </>
        </div>
      </details>

      <div className="panel-section analysis-options">
        <label className="switch-row">
          <span>
            <strong>自动刷新分析</strong>
            <small>参数停止变更 350 ms 后运行</small>
          </span>
          <input
            type="checkbox"
            checked={autoRefresh}
            disabled={!summary}
            onChange={(event) => onAutoRefreshChange(event.target.checked)}
          />
        </label>
        <label className="switch-row">
          <span>
            <strong>显示数值标签</strong>
            <small>主图最多显示 200 个标记</small>
          </span>
          <input
            type="checkbox"
            checked={showLabels}
            disabled={!summary}
            onChange={(event) => onShowLabelsChange(event.target.checked)}
          />
        </label>
      </div>
    </aside>
  );
}
