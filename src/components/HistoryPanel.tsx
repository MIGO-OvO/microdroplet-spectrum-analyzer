import { useMemo, useState } from "react";
import { ArrowDownToLine, Download, FileClock, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";

import type { HistoryEntry } from "../lib/history";
import { HISTORY_LIMIT, historyConcentrations } from "../lib/history";
import type { CalibrationCurve } from "../lib/calibration";
import { formatMeasurement, formatPointCount } from "../lib/format";

interface Props {
  active: boolean;
  entries: HistoryEntry[];
  error: string;
  curves: CalibrationCurve[];
  curve?: CalibrationCurve;
  onSelectCurve: (id: string) => void;
  /** True when a finished analysis is available to record right now. */
  canRecord: boolean;
  currentFileName: string | null;
  onRecord: () => void;
  onReload: (entry: HistoryEntry) => void;
  onReuseParameters: (entry: HistoryEntry) => void;
  onUpdate: (id: string, patch: Partial<Pick<HistoryEntry, "source" | "note">>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onResetStorage: () => void;
  onExport: () => void;
}

const MODE_SHORT = { plateau: "平台检测", droplet: "液滴双电平分析" } as const;

function recordedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Audit trail of processed datasets.
 *
 * Records are written automatically after each successful initial analysis and may be
 * added manually while parameters are being tuned. The operator owns `source` and
 * `note`; the measured values are read-only so a record can never drift from the
 * number the analysis produced.
 */
export function HistoryPanel({
  active, entries, error, curves, curve, onSelectCurve, canRecord, currentFileName, onRecord, onReload, onReuseParameters,
  onUpdate, onRemove, onClear, onResetStorage, onExport,
}: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | HistoryEntry["mode"]>("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => (mode === "all" || entry.mode === mode)
      && (!needle || `${entry.fileName} ${entry.source} ${entry.note}`.toLowerCase().includes(needle)));
  }, [entries, mode, query]);
  const concentrations = useMemo(() => historyConcentrations(filtered, curve), [filtered, curve]);

  return (
    <section className="history-panel" aria-labelledby="history-title" hidden={!active}>
      <header className="history-heading">
        <div>
          <FileClock size={18} aria-hidden="true" />
          <h2 id="history-title">处理历史</h2>
          <span>{entries.length} 条记录 · 仅保存在本机</span>
        </div>
        <div className="history-actions">
          <button className="button primary" type="button" disabled={!canRecord} onClick={onRecord}
            title={canRecord ? "把当前同步的结果追加为一条记录" : "需要一个与当前参数同步的分析结果"}>
            记录当前结果
          </button>
          <button className="button quiet compact-button" type="button" disabled={!entries.length} onClick={onExport}>
            <Download size={15} aria-hidden="true" />导出 CSV
          </button>
          <button className="button quiet compact-button" type="button" disabled={!entries.length}
            onClick={() => { if (window.confirm(`清空全部 ${entries.length} 条处理历史？此操作不可撤销。`)) onClear(); }}>
            <Trash2 size={15} aria-hidden="true" />清空
          </button>
        </div>
      </header>

      <div className="history-toolbar">
        <label>搜索
          <input type="search" value={query} placeholder="文件名、数据来源或备注" onChange={event => setQuery(event.target.value)} />
        </label>
        <label>工作曲线
          <select value={curve?.id ?? ""} disabled={!curves.length} onChange={event => onSelectCurve(event.target.value)}>
            <option value="">{curves.length ? "不计算浓度" : "请先在工作曲线页保存曲线"}</option>
            {curves.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="history-filter" role="group" aria-label="按分析模式筛选">
          {(["all", "plateau", "droplet"] as const).map(value => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
              {value === "all" ? "全部" : MODE_SHORT[value]}
            </button>
          ))}
        </div>
        <span className="history-count">显示 {filtered.length} / {entries.length} 条</span>
        <span className="history-current">当前文件：{currentFileName ?? "未加载"}</span>
      </div>

      {error && (
        <div className="history-error" role="alert">
          <span>{error}</span>
          <button className="button quiet compact-button" type="button" onClick={onResetStorage}>重置历史存储</button>
        </div>
      )}

      {!entries.length ? (
        <div className="history-empty">
          <FileClock size={26} aria-hidden="true" />
          <p>还没有处理记录。载入数据并完成一次分析会自动记录，也可以在参数调整后用“记录当前结果”手动追加。</p>
        </div>
      ) : !filtered.length ? (
        <div className="history-empty"><p>没有符合当前筛选条件的记录。</p></div>
      ) : (
        <div className="history-table-wrap" tabIndex={0} aria-label="可横向滚动的处理历史">
          <table className="history-table">
            <caption>数据来源与备注可直接编辑，离开输入框后保存；测量值只读，与记录时的分析结果一致。</caption>
            <thead>
              <tr>
                <th scope="col">记录时间</th>
                <th scope="col">文件</th>
                <th scope="col">数据来源（可编辑）</th>
                <th scope="col">备注（可编辑）</th>
                <th scope="col">模式</th>
                <th scope="col">响应（曲线用）</th>
                <th scope="col">浓度{curve?.unit ? `（${curve.unit}）` : ""}</th>
                <th scope="col">检测数</th>
                <th scope="col">平均高平台长度（点）</th>
                <th scope="col">长度 RSD (%)</th>
                <th scope="col">数据点</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, index) => (
                <tr key={entry.id}>
                  <td className="history-time">{recordedAt(entry.recordedAt)}</td>
                  <td className="history-file" title={entry.filePath ?? entry.fileName}>{entry.fileName}</td>
                  <td>
                    <input className="history-input" aria-label={`${entry.fileName} 的数据来源`} defaultValue={entry.source}
                      maxLength={120} placeholder="例如 第 3 批 · 样品 A"
                      onBlur={event => {
                        const value = event.target.value.trim();
                        if (value !== entry.source) onUpdate(entry.id, { source: value });
                      }} />
                  </td>
                  <td>
                    <input className="history-input" aria-label={`${entry.fileName} 的备注`} defaultValue={entry.note}
                      maxLength={200} placeholder="例如 更换毛细管后首次测量"
                      onBlur={event => {
                        const value = event.target.value.trim();
                        if (value !== entry.note) onUpdate(entry.id, { note: value });
                      }} />
                  </td>
                  <td>{MODE_SHORT[entry.mode]}</td>
                  <td className="history-response" title={entry.responseLabel}>
                    {formatMeasurement(entry.response, 6)}
                    {entry.warnings > 0 && <span className="history-warning">{entry.warnings} 条警告</span>}
                  </td>
                  <td className="history-concentration">
                    {formatMeasurement(concentrations[index].value, 6)}
                    {(concentrations[index].error || concentrations[index].notices.length > 0) &&
                      <small className="history-cell-note">{concentrations[index].error || concentrations[index].notices.join(" · ")}</small>}
                  </td>
                  <td>{entry.count}</td>
                  <td>{formatMeasurement(entry.meanLength ?? null, 4)}</td>
                  <td>{formatMeasurement(entry.lengthRsd ?? null, 2)}</td>
                  <td>{formatPointCount(entry.pointCount)}</td>
                  <td className="history-row-actions">
                    <button className="button quiet compact-button" type="button"
                      disabled={!entry.filePath || entry.signalColumn == null}
                      title={entry.filePath ? `重新载入 ${entry.filePath}` : "该记录没有保存文件路径"}
                      onClick={() => onReload(entry)}>
                      <RotateCcw size={14} aria-hidden="true" />重新载入
                    </button>
                    <button className="button quiet compact-button" type="button" disabled={!entry.parameters}
                      title="把这条记录的处理参数套用到当前数据（横坐标范围仅在文件相同时恢复）"
                      onClick={() => onReuseParameters(entry)}>
                      <SlidersHorizontal size={14} aria-hidden="true" />复用参数
                    </button>
                    <button className="button quiet compact-button" type="button" aria-label={`删除 ${entry.fileName} 的记录`}
                      onClick={() => { if (window.confirm(`删除 ${entry.fileName} 的处理记录？已导出的文件不受影响。`)) onRemove(entry.id); }}>
                      <Trash2 size={14} aria-hidden="true" />删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="history-notice">
        <ArrowDownToLine size={13} aria-hidden="true" />
        历史保存在本机应用存储中，最多保留 {HISTORY_LIMIT} 条，清理应用数据或卸载会一并丢失；需要归档时请导出 CSV。
        记录只包含分析得到的数值与处理参数，不含原始数据文件。
      </p>
    </section>
  );
}
