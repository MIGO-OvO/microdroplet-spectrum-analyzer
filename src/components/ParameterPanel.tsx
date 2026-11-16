import {
  ChevronDown,
  FileSpreadsheet,
  FolderOpen,
  SlidersHorizontal,
  Waves,
} from "lucide-react";

import { formatPointCount } from "../lib/format";
import type { AnalysisRequest, DatasetSummary } from "../types";

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  onClear?: () => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  title?: string;
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
  onClear,
}: NumberFieldProps) {
  return (
    <label className="number-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        placeholder={onClear ? "不限" : undefined}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value && onClear) { onClear(); return; }
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
  onRequestChange: (request: AnalysisRequest) => void;
  onChooseFile: () => void;
  onAutoRefreshChange: (checked: boolean) => void;
  onShowLabelsChange: (checked: boolean) => void;
}

export function ParameterPanel({
  summary,
  request,
  disabled,
  autoRefresh,
  showLabels,
  onRequestChange,
  onChooseFile,
  onAutoRefreshChange,
  onShowLabelsChange,
}: ParameterPanelProps) {
  const updatePreprocess = (patch: Partial<AnalysisRequest["preprocess"]>) =>
    onRequestChange({
      ...request,
      preprocess: { ...request.preprocess, ...patch },
    });
  const updateDroplet = (patch: Partial<AnalysisRequest["droplet"]>) =>
    onRequestChange({ ...request, droplet: { ...request.droplet, ...patch } });
  const bands = request.droplet.amplitudeBands;

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
        ) : null}
        <button className="button secondary full-width" type="button" onClick={onChooseFile}>
          <FolderOpen size={17} aria-hidden="true" />
          {summary ? "更换数据文件" : "加载数据文件"}
        </button>
      </div>

      <details className="parameter-group" open>
        <summary><span><SlidersHorizontal size={17} aria-hidden="true" />分析范围（{summary?.hasRealTime ? "时间" : "数据点"}）</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="parameter-fields">
          <NumberField label="横坐标起点" value={request.xRange?.min ?? null} min={-1e15} max={1e15} step={1} disabled={disabled}
            title="分析范围包含两端；留空不限。数据点序号从 0 开始。"
            onChange={min => onRequestChange({ ...request, xRange: { min, max: request.xRange?.max ?? null } })}
            onClear={() => onRequestChange({ ...request, xRange: { min: null, max: request.xRange?.max ?? null } })} />
          <NumberField label="横坐标终点" value={request.xRange?.max ?? null} min={-1e15} max={1e15} step={1} disabled={disabled}
            title="分析范围包含两端；留空不限。数据点序号从 0 开始。"
            onChange={max => onRequestChange({ ...request, xRange: { max, min: request.xRange?.min ?? null } })}
            onClear={() => onRequestChange({ ...request, xRange: { max: null, min: request.xRange?.min ?? null } })} />
          <button className="button quiet full-width" disabled={disabled || !request.xRange} onClick={() => onRequestChange({ ...request, xRange: null })}>恢复全文件范围</button>
        </div>
      </details>

      <details className="parameter-group" open>
        <summary>
          <span>
            <SlidersHorizontal size={17} aria-hidden="true" />
            预处理
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="parameter-fields">
          <NumberField
            label="平滑窗口"
            value={request.preprocess.smoothWindow}
            min={3}
            max={51}
            step={2}
            disabled={disabled}
            title="Savitzky–Golay 平滑窗口，只作用于检测信号；测量值始终取自原始信号。"
            onChange={(smoothWindow) => updatePreprocess({ smoothWindow })}
          />
          <NumberField
            label="手动基线"
            value={request.preprocess.manualBaseline}
            min={-1000}
            max={1000}
            step={0.001}
            disabled={disabled}
            title="从检测信号减去基线；手动幅度窗口需相应调整。对同一组平台，高低差 Δ 不受恒定平移影响。"
            onChange={(manualBaseline) => updatePreprocess({ manualBaseline })}
          />
        </div>
      </details>

        <details className="parameter-group" open>
          <summary>
            <span>
              <Waves size={17} aria-hidden="true" />
              双平台检测参数
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="parameter-fields">
            {bands && <>
              {([["高平台幅度下限", "highMin"], ["高平台幅度上限", "highMax"], ["低平台幅度下限", "lowMin"], ["低平台幅度上限", "lowMax"]] as const).map(([label, key]) =>
                <NumberField key={key} label={label} value={bands[key]} min={-1e15} max={1e15} step={0.001} disabled={disabled}
                  onChange={value => updateDroplet({ amplitudeBands: { ...bands, [key]: value } })} />)}
              {!(bands.lowMin < bands.lowMax && bands.lowMax < bands.highMin && bands.highMin < bands.highMax) &&
                <p className="calibration-error" role="alert">须满足：低平台下限 &lt; 低平台上限 &lt; 高平台下限 &lt; 高平台上限。</p>}
            </>}
            <NumberField
              label="最小稳定长度"
              value={request.droplet.minSegmentLength}
              min={3}
              max={100000}
              step={1}
              disabled={disabled}
              title="一个稳定区段至少包含的数据点数；过短的平台或多液滴会被忽略。"
              onChange={(minSegmentLength) => updateDroplet({ minSegmentLength })}
            />
            <NumberField
              label="边缘裁剪比例"
              value={request.droplet.edgeTrimFraction}
              min={0}
              max={0.45}
              step={0.01}
              disabled={disabled}
              title="每个稳定区段两端额外裁掉的比例，用于排除过渡点对电平的影响。"
              onChange={(edgeTrimFraction) => updateDroplet({ edgeTrimFraction })}
            />
            <label className="switch-row compact-switch" title="缺少一侧低平台时仍计算 Δ，使用单侧低平台作为基线。">
              <span>
                <strong>允许单侧参考</strong>
              </span>
              <input
                type="checkbox"
                checked={request.droplet.allowSingleSidedReference}
                disabled={disabled}
                onChange={(event) =>
                  updateDroplet({ allowSingleSidedReference: event.target.checked })
                }
              />
            </label>
            <details className="parameter-subgroup">
              <summary>
                高级参数
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="parameter-fields">
                <NumberField
                  label="最长稳定长度"
                  value={request.droplet.maxSegmentLength}
                  min={0}
                  max={1000000}
                  step={1}
                  disabled={disabled}
                  title="0 表示不限制；用于排除异常长的稳定段。"
                  onChange={(maxSegmentLength) => updateDroplet({ maxSegmentLength })}
                />
                <NumberField
                  label="去尖峰窗口"
                  value={request.droplet.despikeWindow}
                  min={3}
                  max={99}
                  step={2}
                  disabled={disabled}
                  title="对称中值去尖峰窗口，分析时会归一化为奇数，并受最小稳定长度限制。"
                  onChange={(despikeWindow) => updateDroplet({ despikeWindow })}
                />
                <NumberField
                  label="去尖峰阈值"
                  value={request.droplet.despikeSigma}
                  min={1}
                  max={10}
                  step={0.5}
                  disabled={disabled}
                  title="局部稳健 MAD 的倍数，超过即视为尖峰并替换为中值。"
                  onChange={(despikeSigma) => updateDroplet({ despikeSigma })}
                />
                <NumberField
                  label="离群剔除倍数"
                  value={request.droplet.outlierSigma}
                  min={1}
                  max={10}
                  step={0.5}
                  disabled={disabled}
                  title="测量电平时用于剔除区段内离群点的 MAD 倍数。"
                  onChange={(outlierSigma) => updateDroplet({ outlierSigma })}
                />
                <NumberField
                  label="参考间隔倍数"
                  value={request.droplet.referenceGapFactor}
                  min={1}
                  max={20}
                  step={0.5}
                  disabled={disabled}
                  title="高平台与参考低平台间距超过典型间距的该倍数时标记并降低规则评分；超过两倍该上限时弃用该侧。"
                  onChange={(referenceGapFactor) => updateDroplet({ referenceGapFactor })}
                />
              </div>
            </details>
          </div>
        </details>

      <div className="panel-section analysis-options">
        <label className="switch-row">
          <span>
            <strong>自动刷新分析</strong>
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
