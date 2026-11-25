import { useState } from "react";
import { MapPin, X } from "lucide-react";
import { coordinateDraft, positionLabel, readCoordinateDraft, type CoordinateDraft } from "../lib/sampling";
import type { SampleCoordinates, SampleMetadata } from "../types";

interface FieldsProps {
  draft: CoordinateDraft;
  error: string | null;
  onChange: (draft: CoordinateDraft) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function SampleCoordinateFields({ draft, error, onChange, disabled, autoFocus }: FieldsProps) {
  return <fieldset className="sample-coordinate-fields" disabled={disabled}>
    <legend>手动坐标（WGS84，可选）</legend>
    <label className="field-stack"><span>纬度</span>
      <input type="text" inputMode="decimal" autoFocus={autoFocus} aria-invalid={!!error}
        value={draft.latitude} onChange={event => onChange({ ...draft, latitude: event.target.value })} />
    </label>
    <label className="field-stack"><span>经度</span>
      <input type="text" inputMode="decimal" aria-invalid={!!error}
        value={draft.longitude} onChange={event => onChange({ ...draft, longitude: event.target.value })} />
    </label>
    {(draft.latitude || draft.longitude) && <button className="button quiet compact-button" type="button"
      onClick={() => onChange(coordinateDraft())}>清除手动坐标</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </fieldset>;
}

interface DialogProps {
  sample?: SampleMetadata | null;
  coordinates: SampleCoordinates | null;
  onClose: () => void;
  onApply: (value: SampleCoordinates | null) => void;
}

export function SampleCoordinatesDialog({ sample, coordinates, onClose, onApply }: DialogProps) {
  const [draft, setDraft] = useState(() => coordinateDraft(coordinates));
  const parsed = readCoordinateDraft(draft);
  return <div className="dialog-backdrop" onMouseDown={onClose}>
    <section className="column-dialog sample-coordinate-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-coordinate-title"
      onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <div className="dialog-heading">
        <span className="dialog-icon"><MapPin size={20} aria-hidden="true" /></span>
        <div><h2 id="sample-coordinate-title">设置采样坐标</h2><p>文件坐标 · {positionLabel(sample)}</p></div>
        <button className="icon-button" type="button" aria-label="关闭坐标设置" onClick={onClose}><X size={18} /></button>
      </div>
      <form onSubmit={event => { event.preventDefault(); if (typeof parsed !== "string") onApply(parsed); }}>
        <SampleCoordinateFields draft={draft} error={typeof parsed === "string" ? parsed : null} onChange={setDraft} autoFocus />
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" disabled={typeof parsed === "string"}>应用坐标</button>
        </div>
      </form>
    </section>
  </div>;
}
