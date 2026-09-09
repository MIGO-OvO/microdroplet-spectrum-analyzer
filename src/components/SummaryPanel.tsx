import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  Ruler,
  Sigma,
} from "lucide-react";

import { formatMeasurement } from "../lib/format";
import type { AnalysisResponse } from "../types";

interface SummaryPanelProps {
  result: AnalysisResponse | null;
  busy: boolean;
  dirty: boolean;
  status: string;
}

export function SummaryPanel({ result, busy, dirty, status }: SummaryPanelProps) {
  const metrics = [
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
      label: result?.mode === "plateau" ? "平均长度" : "高度标准差",
      value: formatMeasurement(
        result?.mode === "plateau"
          ? (result.statistics.meanLength ?? null)
          : (result?.statistics.standardDeviation ?? null),
        4,
      ),
      icon: Ruler,
    },
  ];
  const features = result?.plateauFeatures;

  return (
    <aside className="summary-panel" aria-label="分析概览">
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
          <h2>检测平台</h2>
          <span>{features?.length ?? 0} 项</span>
        </div>
        {!features || features.length === 0 ? (
          <div className="compact-empty">
            <Activity size={20} aria-hidden="true" />
            <p>{result ? "当前参数下未检测到特征。" : "运行分析后在这里复核检测项。"}</p>
          </div>
        ) : (
          <ol className="feature-ledger">
            {features.slice(0, 12).map((feature) => (
              <li key={feature.number}>
                <span className="feature-number">{feature.number}</span>
                <span>
                  <strong>
                    {formatMeasurement(
                      feature.center,
                      4,
                    )}
                  </strong>
                  <small>
                    高度 {formatMeasurement(feature.height, 5)}
                    {"length" in feature ? ` · 长度 ${feature.length}` : ""}
                  </small>
                </span>
                <CheckCircle2 size={15} aria-label="已检测" />
              </li>
            ))}
          </ol>
        )}
        {features && features.length > 12 && (
          <p className="ledger-overflow">其余 {features.length - 12} 项见下方结果表。</p>
        )}
      </section>
    </aside>
  );
}
