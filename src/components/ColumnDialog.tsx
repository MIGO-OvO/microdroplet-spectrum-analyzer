import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileSpreadsheet, X } from "lucide-react";

import type { FileInspection } from "../types";
import { positionLabel } from "../lib/sampling";
import type { HistoryOrigin } from "../lib/history";

interface ColumnDialogProps {
  inspection: FileInspection;
  busy: boolean;
  initial?: HistoryOrigin | null;
  onCancel: () => void;
  onConfirm: (signalColumn: number, timeColumn: number | null, sampleKey: string | null) => void;
}

export function ColumnDialog({ inspection, initial, busy, onCancel, onConfirm }: ColumnDialogProps) {
  const samples = inspection.samples ?? [];
  const [sampleKey, setSampleKey] = useState(initial?.sampleKey ?? samples[0]?.key ?? "");
  const selectedSample = samples.find(sample => sample.key === sampleKey);
  const [signalColumn, setSignalColumn] = useState(initial?.signalColumn ?? inspection.suggestedSignalColumn ?? inspection.columns[0]?.index ?? 0);
  const [timeColumn, setTimeColumn] = useState<number | "">(initial ? initial.timeColumn ?? "" : inspection.suggestedTimeColumn ?? "");
  const signalSelect = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    signalSelect.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  const selectedTime = timeColumn === "" ? null : timeColumn;
  const columnsConflict = selectedTime === signalColumn;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        className="column-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="column-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <span className="dialog-icon" aria-hidden="true">
            <FileSpreadsheet size={20} />
          </span>
          <div>
            <h2 id="column-dialog-title">选择分析列</h2>
            <p>{inspection.fileName}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="关闭列选择"
          >
            <X size={18} />
          </button>
        </div>

        <div className="dialog-fields">
          {samples.length > 0 && <div className="import-sample">
            <label className="field-stack">
              <span>采样窗口</span>
              <select value={sampleKey} onChange={event => setSampleKey(event.target.value)} disabled={busy}>
                {samples.map((sample, index) => <option key={sample.key} value={sample.key}>
                  {sample.sampleName ?? sample.sampleId ?? `采样 ${index + 1}`} · {sample.rowCount.toLocaleString()} 帧
                </option>)}
              </select>
            </label>
            <small>{positionLabel(selectedSample)}{selectedSample?.startedAt ? ` · ${selectedSample.startedAt}` : ""}</small>
          </div>}
          <label className="field-stack">
            <span>信号列</span>
            <select
              ref={signalSelect}
              value={signalColumn}
              onChange={(event) => setSignalColumn(Number(event.target.value))}
            >
              {inspection.columns.map((column) => (
                <option key={column.index} value={column.index}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack">
            <span>时间列（可选）</span>
            <select
              value={timeColumn}
              onChange={(event) =>
                setTimeColumn(event.target.value === "" ? "" : Number(event.target.value))
              }
            >
              <option value="">使用数据点序号</option>
              {inspection.columns.map((column) => (
                <option key={column.index} value={column.index}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {columnsConflict && (
          <p className="field-error" role="alert">
            时间列和信号列不能相同。
          </p>
        )}

        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => onConfirm(signalColumn, selectedTime, sampleKey || null)}
            disabled={busy || columnsConflict}
          >
            {busy ? "正在读取…" : "载入并分析"}
            {!busy && <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </div>
      </section>
    </div>
  );
}
