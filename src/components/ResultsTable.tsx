import { useState } from "react";
import { FileDown, FileSpreadsheet, ImageDown, Table2 } from "lucide-react";

import {
  formatMeasurement,
  formatQualityFlag,
  formatReferenceMode,
  formatSegmentKind,
} from "../lib/format";
import type { AnalysisResponse, DropletMeasurement } from "../types";

interface ResultsTableProps {
  result: AnalysisResponse | null;
  exporting: "data" | "chart" | null;
  onExportData: () => void;
  onExportChart: () => void;
}

const EMPTY = "—";
const ROWS_PER_PAGE = 100;
/** The segment evidence sheet is long; the table only previews the first slice. */
const SEGMENT_PREVIEW_LIMIT = 200;

function formatOptional(value: number | null, digits: number) {
  return value == null ? EMPTY : formatMeasurement(value, digits);
}

function DropletRow({ measurement }: { measurement: DropletMeasurement }) {
  return (
    <>
      <th scope="row">{measurement.number}</th>
      <td>{formatMeasurement(measurement.center, 4)}</td>
      <td>{formatMeasurement(measurement.bottomLevel, 6)}</td>
      <td>{formatOptional(measurement.leftPlatformLevel, 6)}</td>
      <td>{formatOptional(measurement.rightPlatformLevel, 6)}</td>
      <td>{formatMeasurement(measurement.platformReference, 6)}</td>
      <td className="emphasis-cell">{formatMeasurement(measurement.correctedSignal, 6)}</td>
      <td>{formatReferenceMode(measurement.referenceMode)}</td>
      <td>{measurement.confidence.toFixed(3)}</td>
      <td>
        {measurement.qualityFlags.length === 0
          ? EMPTY
          : measurement.qualityFlags.map(formatQualityFlag).join("、")}
      </td>
    </>
  );
}

export function ResultsTable({
  result,
  exporting,
  onExportData,
  onExportChart,
}: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const droplet = result?.mode === "droplet";
  const measurements = result?.dropletMeasurements ?? [];
  const count = droplet ? measurements.length : (result?.statistics.featureCount ?? 0);

  const pages = Math.max(1, Math.ceil(count / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pages - 1);
  const first = currentPage * ROWS_PER_PAGE;
  const last = first + ROWS_PER_PAGE;

  return (
    <section className="results-panel" aria-labelledby="results-title">
      <header className="results-heading">
        <div>
          <Table2 size={18} aria-hidden="true" />
          <h2 id="results-title">{droplet ? "液滴测量结果" : "分析数据表"}</h2>
          <span>{count} 项结果</span>
          <button type="button" className="button quiet compact-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" className="button quiet compact-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>
        <div className="results-actions">
          <button
            className="button quiet compact-button"
            type="button"
            disabled={!result || count === 0 || exporting !== null}
            onClick={onExportData}
          >
            {exporting === "data" ? (
              <FileDown className="spin-once" size={16} aria-hidden="true" />
            ) : (
              <FileSpreadsheet size={16} aria-hidden="true" />
            )}
            导出 Excel
          </button>
          <button
            className="button quiet compact-button"
            type="button"
            disabled={!result || exporting !== null}
            onClick={onExportChart}
          >
            {exporting === "chart" ? (
              <FileDown className="spin-once" size={16} aria-hidden="true" />
            ) : (
              <ImageDown size={16} aria-hidden="true" />
            )}
            导出图表
          </button>
        </div>
      </header>

      {!result || count === 0 ? (
        <div className="table-empty">
          <Table2 size={23} aria-hidden="true" />
          <p>
            {result
              ? droplet
                ? "当前参数下没有可列出的液滴；请查看分析状态中的提示。"
                : "当前参数下没有可列出的检测结果。"
              : "载入数据并运行分析后显示逐项结果。"}
          </p>
        </div>
      ) : (
        <div className="table-scroll" tabIndex={0} aria-label="可横向滚动的分析结果">
          <table>
            <thead>
              <tr>
                {droplet ? (
                  <>
                    <th scope="col">液滴 #</th>
                    <th scope="col">中心位置</th>
                    <th scope="col">Bottom 电平</th>
                    <th scope="col">左 Platform</th>
                    <th scope="col">右 Platform</th>
                    <th scope="col">Platform Reference</th>
                    <th scope="col">Corrected ΔSignal</th>
                    <th scope="col">参考方式</th>
                    <th scope="col">置信度</th>
                    <th scope="col">质量标记</th>
                  </>
                ) : (
                  <>
                    <th scope="col">平台 #</th>
                    <th scope="col">中心位置</th>
                    <th scope="col">起始点</th>
                    <th scope="col">结束点</th>
                    <th scope="col">高度（精炼）</th>
                    <th scope="col">长度</th>
                    <th scope="col">平台标准差</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {droplet
                ? measurements.slice(first, last).map((measurement) => (
                    <tr key={measurement.number}>
                      <DropletRow measurement={measurement} />
                    </tr>
                  ))
                : (result?.plateauFeatures ?? []).slice(first, last).map((feature) => (
                    <tr key={feature.number}>
                      <th scope="row">{feature.number}</th>
                      <td>{formatMeasurement(feature.center, 4)}</td>
                      <td>{formatMeasurement(feature.start, 4)}</td>
                      <td>{formatMeasurement(feature.end, 4)}</td>
                      <td>{formatMeasurement(feature.height, 6)}</td>
                      <td>{feature.length}</td>
                      <td>{formatMeasurement(feature.standardDeviation, 6)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {droplet && result != null && result.stableSegments.length > 0 && (
        <details className="results-details">
          <summary>稳定区段证据（{result.stableSegments.length} 段，用于复核分类）</summary>
          <div className="table-scroll" tabIndex={0} aria-label="可横向滚动的稳定区段">
            <table>
              <thead>
                <tr>
                  <th scope="col">区段 #</th>
                  <th scope="col">类型</th>
                  <th scope="col">起始点</th>
                  <th scope="col">中心位置</th>
                  <th scope="col">结束点</th>
                  <th scope="col">电平（原始信号）</th>
                  <th scope="col">长度</th>
                  <th scope="col">标准差</th>
                  <th scope="col">置信度</th>
                </tr>
              </thead>
              <tbody>
                {result.stableSegments.slice(0, SEGMENT_PREVIEW_LIMIT).map((segment) => (
                  <tr key={segment.number}>
                    <th scope="row">{segment.number}</th>
                    <td>{formatSegmentKind(segment.kind)}</td>
                    <td>{segment.startIndex}</td>
                    <td>{segment.centerIndex}</td>
                    <td>{segment.endIndex}</td>
                    <td>{formatMeasurement(segment.level, 6)}</td>
                    <td>{segment.length}</td>
                    <td>{formatMeasurement(segment.standardDeviation, 6)}</td>
                    <td>{segment.confidence.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.stableSegments.length > SEGMENT_PREVIEW_LIMIT && (
            <p className="ledger-overflow">
              仅显示前 {SEGMENT_PREVIEW_LIMIT} 段；完整证据见导出的 Excel“稳定区段”工作表。
            </p>
          )}
        </details>
      )}
    </section>
  );
}
