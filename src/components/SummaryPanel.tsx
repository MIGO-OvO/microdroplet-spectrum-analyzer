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

import { formatMeasurement, formatReferenceMode } from "../lib/format";
import type { AnalysisResponse } from "../types";

interface SummaryPanelProps {
  result: AnalysisResponse | null;
  busy: boolean;
  dirty: boolean;
  status: string;
}

function DropletFacts({ result }: { result: AnalysisResponse }) {
  const statistics = result.dropletStatistics;
  const facts: Array<[string, string]> = [
    ["平均 Bottom 电平", formatMeasurement(statistics.meanBottom, 6)],
    ["平均 Platform Reference", formatMeasurement(statistics.meanPlatformReference, 6)],
    [
      "双侧插值 / 单侧参考",
      `${statistics.interpolatedCount} / ${statistics.singleSidedCount}`,
    ],
    ["低置信度液滴", String(statistics.lowConfidenceCount)],
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

export function SummaryPanel({ result, busy, dirty, status }: SummaryPanelProps) {
  const droplet = result?.mode === "droplet";
  const statistics = result?.dropletStatistics;
  const metrics = droplet
    ? [
        {
          label: "液滴数量",
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
          <h2>{droplet ? "检测液滴" : "检测平台"}</h2>
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
                  <span className="feature-number">{measurement.number}</span>
                  <span>
                    <strong>Δ {formatMeasurement(measurement.correctedSignal, 6)}</strong>
                    <small>
                      中心 {formatMeasurement(measurement.center, 4)} ·{" "}
                      {formatReferenceMode(measurement.referenceMode)}
                    </small>
                  </span>
                  <CheckCircle2 size={15} aria-label="已测量" />
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
