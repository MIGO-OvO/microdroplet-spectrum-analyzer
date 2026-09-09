import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileSpreadsheet, X } from "lucide-react";

import type { FileInspection } from "../types";

interface ColumnDialogProps {
  inspection: FileInspection;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (signalColumn: number, timeColumn: number | null) => void;
}

export function ColumnDialog({ inspection, busy, onCancel, onConfirm }: ColumnDialogProps) {
  const [signalColumn, setSignalColumn] = useState(inspection.columns[0]?.index ?? 0);
  const [timeColumn, setTimeColumn] = useState<number | "">("");
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

        <p className="dialog-intro">
          文件包含 {inspection.columns.length} 列、约 {inspection.rowCount.toLocaleString("zh-CN")} 行。
          请选择要分析的信号列；时间列可以留空。
        </p>

        <div className="dialog-fields">
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
            onClick={() => onConfirm(signalColumn, selectedTime)}
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
