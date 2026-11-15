import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  Ruler,
  Sigma,
  Waves,
} from "lucide-react";

import { useMemo } from "react";
import { formatMeasurement, formatReferenceMode, formatQualityFlag } from "../lib/format";
import { indexDroplets, segmentId, segmentUse, lowId, SCORE_EXPLANATION } from "../lib/droplet";
import type { AnalysisResponse } from "../types";

interface SummaryPanelProps {
  result: AnalysisResponse | null;
  busy: boolean;
  dirty: boolean;
  status: string;
  selectedSegment?: number | null;
  onSelectSegment?: (number: number) => void;
}

function DropletFacts({ result }: { result: AnalysisResponse }) {
  const statistics = result.dropletStatistics;
  const facts: Array<[string, string]> = [
    ["检测到的高 / 低平台", `${result.stableSegments.filter(s => s.kind === "platform").length} / ${result.stableSegments.filter(s => s.kind === "bottom").length}`],
    ["高平台未形成测量", String(result.stableSegments.filter(s => s.kind === "platform").length - statistics.dropletCount)],
    ["平均高平台实测值", formatMeasurement(statistics.meanHigh, 6)],
    ["平均低平台基线", formatMeasurement(statistics.meanBaseline, 6)],
    ["平均高平台长度（点）", formatMeasurement(statistics.meanLength, 4)],
    ["高平台长度标准差（点）", formatMeasurement(statistics.lengthStandardDeviation, 4)],
    ["高平台长度 RSD", statistics.lengthRsd == null ? "—" : `${formatMeasurement(statistics.lengthRsd, 2)}%`],
    [
      "双侧插值 / 单侧参考",
      `${statistics.interpolatedCount} / ${statistics.singleSidedCount}`,
    ],
    ["低规则评分测量", String(statistics.lowConfidenceCount)],
    ["未分类稳定区段", String(statistics.unknownSegmentCount)],
  ];
  return (
    <dl className="file-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SummaryPanel({ result, busy, dirty, status, selectedSegment, onSelectSegment }: SummaryPanelProps) {
  const index = useMemo(() => result ? indexDroplets(result) : null, [result]);
  const selected = index?.segments.get(selectedSegment ?? -1);
  const measurement = index?.byHigh.get(selectedSegment ?? -1);
  const droplet = result?.mode !== "plateau";
  const statistics = result?.dropletStatistics;
  const metrics = droplet
    ? [
        {
          label: "高平台测量数",
          value: result ? String(statistics?.dropletCount ?? 0) : "—",
          icon: Waves,
        },
        {
          label: "平均校正信号 Δ",
          value: formatMeasurement(statistics?.meanCorrectedSignal ?? null, 6),
          icon: Sigma,
        },
        {
          label: "RSD",
          value:
            statistics?.rsd == null ? "—" : `${formatMeasurement(statistics.rsd, 2)}%`,
          icon: Gauge,
        },
        {
          label: "校正信号标准差",
          value: formatMeasurement(statistics?.standardDeviation ?? null, 6),
          icon: Ruler,
        },
      ]
    : [
        {
          label: "平台数量",
          value: result ? String(result.statistics.featureCount) : "—",
          icon: Activity,
        },
        {
          label: "平均高度",
          value: formatMeasurement(result?.statistics.meanHeight ?? null, 6),
          icon: Sigma,
        },
        {
          label: "RSD",
          value:
            result?.statistics.rsd == null
              ? "—"
              : `${formatMeasurement(result.statistics.rsd, 2)}%`,
          icon: Gauge,
        },
        {
          label: "平均长度",
          value: formatMeasurement(result?.statistics.meanLength ?? null, 4),
          icon: Ruler,
        },
      ];

  return (
    <aside className="summary-panel" aria-label="分析概览">
      {droplet && <section className="summary-section segment-inspector" aria-live="polite">
        <h2>平台与基线关系</h2>
        {selected && index ? <>
          <strong>{segmentId(selected.kind, selected.number)} · {segmentUse(selected, index)}</strong>
          <p>检测范围 {formatMeasurement(selected.start, 4)}–{formatMeasurement(selected.end, 4)} · 原始电平 {formatMeasurement(selected.level, 6)}</p>
          {measurement ? <>
            <dl className="file-facts">
              <div><dt>左低平台</dt><dd>{lowId(measurement.leftLowSegment)} · {formatMeasurement(measurement.leftLowLevel, 6)}</dd></div>
              <div><dt>右低平台</dt><dd>{lowId(measurement.rightLowSegment)} · {formatMeasurement(measurement.rightLowLevel, 6)}</dd></div>
              <div><dt>基线计算位置</dt><dd>{formatMeasurement(measurement.center, 4)}（高平台中心）</dd></div>
              <div><dt>低平台基线</dt><dd>{formatMeasurement(measurement.baselineReference, 6)}</dd></div>
            </dl>
            <p className="delta-equation">Δ = {formatMeasurement(measurement.highLevel, 6)} − ({formatMeasurement(measurement.baselineReference, 6)}) = {formatMeasurement(measurement.correctedSignal, 6)}</p>
            <p>{measurement.qualityFlags.map(formatQualityFlag).join("、") || "无质量标记（不代表已验证）"}</p>
          </> : selected.kind === "platform" ? <p>未输出 Δ：缺少可用低平台，或单侧参考已禁用。请检查分析范围与参考配对参数。</p> : null}
          {selected.kind === "bottom" && (index.byLow.get(selected.number) ?? []).map(m => <button
            key={m.number} type="button" className="segment-link" onClick={() => onSelectSegment?.(m.highSegment)}>
            查看 H{m.highSegment} · {formatReferenceMode(m.referenceMode)}
          </button>)}
        </> : <p>点击图中的平台或下方表格编号，查看检测范围、测量状态及实际基线来源。</p>}
        <p className="score-note">{SCORE_EXPLANATION}</p>
      </section>}
      <section className="summary-section metrics-section">
        <div className="summary-heading">
          <h2>统计概览</h2>
          {result?.usedCachedPreprocess && <span className="cache-badge">复用预处理</span>}
        </div>
        <dl className="metric-list">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <dt>
                <Icon size={15} aria-hidden="true" />
                {label}
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {droplet && result && (
          <div className="droplet-facts">
            <DropletFacts result={result} />
          </div>
        )}
      </section>

      <section className="summary-section state-section" aria-live="polite">
        <div className="summary-heading">
          <h2>分析状态</h2>
          {busy ? (
            <span className="state-mark running">
              <Clock3 size={15} aria-hidden="true" />
              处理中
            </span>
          ) : dirty ? (
            <span className="state-mark pending">
              <AlertTriangle size={15} aria-hidden="true" />
              待更新
            </span>
          ) : (
            <span className="state-mark ready">
              <CheckCircle2 size={15} aria-hidden="true" />
              已同步
            </span>
          )}
        </div>
        <p>{status}</p>
        {result && result.warnings.length > 0 && (
          <ul className="warning-list">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="summary-section detected-section">
        <div className="summary-heading">
          <h2>{droplet ? "已测量高平台" : "检测平台"}</h2>
          <span>
            {droplet
              ? `${result?.dropletMeasurements.length ?? 0} 项`
              : `${result?.plateauFeatures.length ?? 0} 项`}
          </span>
        </div>
        {droplet ? (
          !result || result.dropletMeasurements.length === 0 ? (
            <div className="compact-empty">
              <Waves size={20} aria-hidden="true" />
              <p>{result ? "当前参数下未检出可配对的液滴。" : "运行分析后在这里复核液滴结果。"}</p>
            </div>
          ) : (
            <ol className="feature-ledger">
              {result.dropletMeasurements.slice(0, 12).map((measurement) => (
                <li key={measurement.number}>
                  <button type="button" className="segment-link" aria-pressed={selectedSegment === measurement.highSegment}
                    onClick={() => onSelectSegment?.(measurement.highSegment)}>H{measurement.highSegment}</button>
                  <span>
                    <strong>Δ {formatMeasurement(measurement.correctedSignal, 6)}</strong>
                    <small>
                      中心 {formatMeasurement(measurement.center, 4)} ·{" "}
                      {formatReferenceMode(measurement.referenceMode)}
                    </small>
                  </span>
                  {measurement.qualityFlags.length ? <AlertTriangle size={15} aria-label="需复核质量标记" /> : <CheckCircle2 size={15} aria-label="已计算（非准确率验证）" />}
                </li>
              ))}
            </ol>
          )
        ) : !result || result.plateauFeatures.length === 0 ? (
          <div className="compact-empty">
            <Activity size={20} aria-hidden="true" />
            <p>{result ? "当前参数下未检测到特征。" : "运行分析后在这里复核检测项。"}</p>
          </div>
        ) : (
          <ol className="feature-ledger">
            {result.plateauFeatures.slice(0, 12).map((feature) => (
              <li key={feature.number}>
                <span className="feature-number">{feature.number}</span>
                <span>
                  <strong>{formatMeasurement(feature.center, 4)}</strong>
                  <small>高度 {formatMeasurement(feature.height, 5)} · 长度 {feature.length}</small>
                </span>
                <CheckCircle2 size={15} aria-label="已检测" />
              </li>
            ))}
          </ol>
        )}
        {!droplet && result && result.plateauFeatures.length > 12 && (
          <p className="ledger-overflow">其余 {result.plateauFeatures.length - 12} 项见下方结果表。</p>
        )}
        {droplet && result && result.dropletMeasurements.length > 12 && (
          <p className="ledger-overflow">
            其余 {result.dropletMeasurements.length - 12} 项见下方结果表。
          </p>
        )}
      </section>
    </aside>
  );
}
