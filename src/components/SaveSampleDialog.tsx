import { useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";

import { saveSamplingRecord } from "../lib/bridge";
import { analysisResponse, calculateConcentration, fitCalibration, sampleLookup, type CalibrationCurve } from "../lib/calibration";
import { errorMessage } from "../lib/format";
import { positionLabel } from "../lib/sampling";
import type { AnalysisResponse, DatasetSummary, SamplingRecord, SaveSampleRequest } from "../types";

interface Props {
  summary: DatasetSummary;
  result: AnalysisResponse;
  curves: CalibrationCurve[];
  onClose: () => void;
  onSaved: (record: SamplingRecord) => void;
}

export function SaveSampleDialog({ summary, result, curves, onClose, onSaved }: Props) {
  const sample = summary.sample;
  const [name, setName] = useState(sample?.sampleName ?? sample?.sampleId ?? summary.fileName.replace(/\.[^.]+$/, ""));
  const [analyte, setAnalyte] = useState("");
  const [source, setSource] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState("");
  const nameField = useRef<HTMLInputElement>(null);
  const curve = curves.find(item => item.id === source);

  useEffect(() => { nameField.current?.focus(); }, []);

  let concentration: SaveSampleRequest["concentration"] = null;
  let concentrationError = "";
  const curveUnit = curve?.unit.trim();
  const concentrationUnit = curveUnit || unit.trim();
  if (curve) {
    try {
      const response = analysisResponse(result);
      if (response === null) throw new Error("当前分析没有可用于工作曲线的响应值。");
      const fit = fitCalibration(curve);
      const reading = calculateConcentration(fit, response);
      const notices = [...sampleLookup(curve, response, result.mode).notices];
      if (reading.extrapolated) notices.push("超出标定范围");
      if (reading.value < 0) notices.push("负浓度");
      concentration = {
        value: reading.value, unit: concentrationUnit, notices,
        curve: { id: curve.id, name: curve.name, updatedAt: curve.updatedAt, slope: fit.slope, intercept: fit.intercept },
      };
    } catch (cause) { concentrationError = errorMessage(cause); }
  } else if (source === "manual" && manualValue.trim()) {
    const value = Number(manualValue);
    if (Number.isFinite(value) && value >= 0) concentration = { value, unit: concentrationUnit, notices: [], curve: null };
    else concentrationError = "请输入有限的非负浓度。";
  }

  const canSave = !!name.trim() && (!source || (!!concentration && !!concentrationUnit));
  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveSamplingRecord({ resultId: result.resultId, name, analyte, concentration, replaceExisting });
      if (saved) onSaved(saved);
      else setReplaceExisting(true);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };

  return <div className="dialog-backdrop" onMouseDown={saving ? undefined : onClose}>
    <section className="column-dialog sample-dialog" role="dialog" aria-modal="true" aria-labelledby="save-sample-title"
      onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !saving) onClose(); }}>
      <div className="dialog-heading">
        <span className="dialog-icon"><MapPin size={20} aria-hidden="true" /></span>
        <div><h2 id="save-sample-title">保存采样数据</h2><p>{positionLabel(sample)}</p></div>
        <button className="icon-button" type="button" aria-label="关闭保存采样" disabled={saving} onClick={onClose}><X size={18} /></button>
      </div>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving} className="sample-fields">
          <label className="field-stack"><span>采样名称</span><input ref={nameField} value={name} onChange={event => setName(event.target.value)} required /></label>
          <label className="field-stack"><span>污染物（选填）</span><input value={analyte} onChange={event => setAnalyte(event.target.value)} /></label>
          <label className="field-stack"><span>浓度来源</span>
            <select value={source} onChange={event => setSource(event.target.value)}>
              <option value="">暂不填写</option><option value="manual">手动录入</option>
              {curves.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {source === "manual" && <label className="field-stack"><span>浓度</span>
            <input type="number" min="0" step="any" value={manualValue} onChange={event => setManualValue(event.target.value)} required />
          </label>}
          {source && !curveUnit && <label className="field-stack"><span>浓度单位</span>
            <input value={unit} placeholder="mg/L" onChange={event => setUnit(event.target.value)} required />
          </label>}
          {curve && concentration && <output className="sample-reading">{Number(concentration.value.toPrecision(6))} {concentrationUnit}</output>}
        </fieldset>
        {concentration?.notices.map(notice => <p className="sample-notice" key={notice}>{notice}</p>)}
        {replaceExisting && <p className="sample-notice" role="status">该样本已在采样库中。确认后将更新原记录。</p>}
        {(error || concentrationError) && <p className="field-error" role="alert">{error || concentrationError}</p>}
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>取消</button>
          <button className="button primary" type="submit" disabled={!canSave || saving}>
            {saving ? "保存中…" : replaceExisting ? "更新采样记录" : "保存到采样库"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
