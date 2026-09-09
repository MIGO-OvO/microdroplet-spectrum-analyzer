import { useState } from "react";
import { FileDown, FileSpreadsheet, ImageDown, Table2 } from "lucide-react";

import { formatMeasurement } from "../lib/format";
import type { AnalysisResponse } from "../types";

interface ResultsTableProps {
  result: AnalysisResponse | null;
  exporting: "data" | "chart" | null;
  onExportData: () => void;
  onExportChart: () => void;
}

export function ResultsTable({
  result,
  exporting,
  onExportData,
  onExportChart,
}: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const count = result?.statistics.featureCount ?? 0;

  const pages = Math.max(1, Math.ceil(count / 100));
  const currentPage = Math.min(page, pages - 1);

  return (
    <section className="results-panel" aria-labelledby="results-title">
      <header className="results-heading">
        <div>
          <Table2 size={18} aria-hidden="true" />
          <h2 id="results-title">分析数据表</h2>
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
          <p>{result ? "当前参数下没有可列出的检测结果。" : "载入数据并运行分析后显示逐项结果。"}</p>
        </div>
      ) : (
        <div className="table-scroll" tabIndex={0} aria-label="可横向滚动的分析结果">
            <table>
              <thead>
                <tr>
                  <th scope="col">平台 #</th>
                  <th scope="col">中心位置</th>
                  <th scope="col">起始点</th>
                  <th scope="col">结束点</th>
                  <th scope="col">高度（精炼）</th>
                  <th scope="col">长度</th>
                  <th scope="col">平台标准差</th>
                </tr>
              </thead>
              <tbody>
                {result.plateauFeatures.slice(currentPage * 100, (currentPage + 1) * 100).map((feature) => (
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
    </section>
  );
}
