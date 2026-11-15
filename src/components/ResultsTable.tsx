import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, ImageDown, Table2 } from "lucide-react";
import { formatMeasurement as fmt, formatQualityFlag, formatReferenceMode, formatSegmentKind } from "../lib/format";
import { indexDroplets, segmentId, segmentUse, SCORE_EXPLANATION } from "../lib/droplet";
import type { AnalysisResponse } from "../types";

interface ResultsTableProps {
  result: AnalysisResponse | null;
  exporting: "data" | "chart" | "waveform" | null;
  onExportData: () => void;
  onExportChart: () => void;
  onExportWaveform: () => void;
  selectedSegment?: number | null;
  onSelectSegment?: (id: number) => void;
}
const ROWS_PER_PAGE = 100;

export function ResultsTable({ result, exporting, onExportData, onExportChart, onExportWaveform, selectedSegment, onSelectSegment }: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"measurements" | "segments">("measurements");
  const droplet = result?.mode !== "plateau";
  const evidence = droplet && view === "segments";
  useEffect(() => {
    if (!result || selectedSegment == null) { setPage(0); return; }
    const position = evidence ? result.stableSegments.findIndex(s => s.number === selectedSegment)
      : result.dropletMeasurements.findIndex(m => m.highSegment === selectedSegment);
    if (position >= 0) setPage(Math.floor(position / ROWS_PER_PAGE));
  }, [result, evidence, selectedSegment]);
  const index = useMemo(() => result ? indexDroplets(result) : null, [result]);
  const count = !result ? 0 : evidence ? result.stableSegments.length
    : droplet ? result.dropletMeasurements.length : result.plateauFeatures.length;
  const pages = Math.max(1, Math.ceil(count / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pages - 1);
  const first = currentPage * ROWS_PER_PAGE;
  const last = first + ROWS_PER_PAGE;
  const pick = (kind: "platform" | "bottom" | "unknown", id: number | null) => id == null ? "无" : (
    <button type="button" className={`segment-link segment-${kind}`} aria-pressed={selectedSegment === id}
      aria-label={`查看${segmentId(kind, id)}的检测与基线关系`} onClick={() => onSelectSegment?.(id)}>
      {segmentId(kind, id)}
    </button>
  );

  return (
    <section className="results-panel" aria-labelledby="results-title">
      <header className="results-heading">
        <div>
          <Table2 size={18} aria-hidden="true" />
          <h2 id="results-title">{droplet ? "双平台复核" : "分析数据表"}</h2>
          {droplet && result && <div className="result-view" role="group" aria-label="结果视图">
            <button type="button" aria-pressed={!evidence} onClick={() => { setView("measurements"); setPage(0); }}>高平台测量（{result.dropletMeasurements.length}）</button>
            <button type="button" aria-pressed={evidence} onClick={() => { setView("segments"); setPage(0); }}>全部检测区段（{result.stableSegments.length}）</button>
          </div>}
          <button type="button" className="button quiet compact-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" className="button quiet compact-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>
        <div className="results-actions">
          <button className="button quiet compact-button" type="button" disabled={!result || exporting !== null} onClick={onExportWaveform}
            title="导出本次分析范围内的全部处理后采样点，含原始信号对照">
            <FileDown size={16} aria-hidden="true" />{exporting === "waveform" ? "导出中…" : "导出波形 CSV"}
          </button>
          <button className="button quiet compact-button" type="button" disabled={!result || exporting !== null} onClick={onExportData}>
            {exporting === "data" ? <FileDown size={16} aria-hidden="true" /> : <FileSpreadsheet size={16} aria-hidden="true" />}导出 Excel
          </button>
          <button className="button quiet compact-button" type="button" disabled={!result || exporting !== null} onClick={onExportChart}>
            <ImageDown size={16} aria-hidden="true" />导出图表
          </button>
        </div>
      </header>
      {!result || count === 0 ? (
        <div className="table-empty"><Table2 size={23} aria-hidden="true" /><p>
          {!result ? "载入数据并运行分析后显示逐项结果。" : droplet && !evidence
            ? "没有形成测量的高平台；请切换“全部检测区段”检查已检测但未配对的平台。" : "当前参数下没有可列出的检测结果。"}
        </p></div>
      ) : (
        <div className="table-scroll" tabIndex={0} aria-label="可横向滚动的分析结果">
          <table>
            {droplet && <caption className="result-caption">
              Δ = 高平台实测值 − 低平台基线（在高平台中心计算）。H / L / U 后为本次分析的区段编号；点击编号在主图与右栏复核。{SCORE_EXPLANATION}
            </caption>}
            <thead><tr>
              {(evidence ? ["区段", "检测类型", "用途 / 测量状态", "起始坐标", "中心坐标", "结束坐标", "原始电平", "长度 / 有效点数", "标准差", "规则评分"]
                : droplet ? ["测量 #", "高平台", "中心坐标", "高平台实测值", "左低平台 / 电平", "右低平台 / 电平", "低平台基线", "校正信号 Δ", "基线方式", "规则评分", "质量标记"]
                  : ["平台 #", "中心位置", "起始点", "结束点", "高度（精炼）", "长度", "平台标准差"]
              ).map(label => <th scope="col" key={label}>{label}</th>)}
            </tr></thead>
            <tbody>
              {evidence && index ? result.stableSegments.slice(first, last).map(segment => (
                <tr key={segment.number} className={selectedSegment === segment.number ? "selected-result" : undefined}>
                  <th scope="row">{pick(segment.kind, segment.number)}</th>
                  <td>{formatSegmentKind(segment.kind)}</td><td>{segmentUse(segment, index)}</td>
                  <td>{fmt(segment.start, 4)}</td><td>{fmt(segment.center, 4)}</td><td>{fmt(segment.end, 4)}</td>
                  <td>{fmt(segment.level, 6)}</td><td>{segment.length} / {segment.effectiveLength}</td>
                  <td>{fmt(segment.standardDeviation, 6)}</td><td>{segment.confidence.toFixed(3)}</td>
                </tr>
              )) : droplet ? result.dropletMeasurements.slice(first, last).map(m => (
                <tr key={m.number} className={selectedSegment === m.highSegment ? "selected-result" : undefined}>
                  <th scope="row">{m.number}</th><td>{pick("platform", m.highSegment)}</td>
                  <td>{fmt(m.center, 4)}</td><td>{fmt(m.highLevel, 6)}</td>
                  <td>{pick("bottom", m.leftLowSegment)} / {fmt(m.leftLowLevel, 6)}</td>
                  <td>{pick("bottom", m.rightLowSegment)} / {fmt(m.rightLowLevel, 6)}</td>
                  <td>{fmt(m.baselineReference, 6)}</td><td className="emphasis-cell">{fmt(m.correctedSignal, 6)}</td>
                  <td>{formatReferenceMode(m.referenceMode)}</td><td>{m.confidence.toFixed(3)}</td>
                  <td className="quality-flags">{m.qualityFlags.length ? m.qualityFlags.map(formatQualityFlag).join("、") : "无标记（不代表已验证）"}</td>
                </tr>
              )) : result.plateauFeatures.slice(first, last).map(f => (
                <tr key={f.number}><th scope="row">{f.number}</th><td>{fmt(f.center, 4)}</td><td>{fmt(f.start, 4)}</td>
                  <td>{fmt(f.end, 4)}</td><td>{fmt(f.height, 6)}</td><td>{f.length}</td><td>{fmt(f.standardDeviation, 6)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
