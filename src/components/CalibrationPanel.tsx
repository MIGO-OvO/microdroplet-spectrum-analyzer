import { useEffect, useMemo, useState } from "react";
import { Plus, Save, FolderOpen, Download } from "lucide-react";
import type { AnalysisRequest, AnalysisResponse, DatasetSummary } from "../types";
import { analysisResponse, assertCalibrationCompatible, calibrationDefinition, correctedResponse, calculateConcentration, fitCalibration, LIBRARY_KEY, newCurve, parseLibrary, restoreCalibrationMemory, sampleLookup, WEIGHT_LABELS,
  type CalibrationCurve, type CalibrationLibrary, type Weighting } from "../lib/calibration";
import { calibrationSvg, calibrationTable, calibrationOriginTable, openCalibrationLibrary, saveCalibrationArtifact,
  scientificNumber as fmt, svgPng, tableCsv, type ExportCell } from "../lib/calibration-export";
import { errorMessage } from "../lib/format";
import { CalibrationSample, type SampleOutcome } from "./CalibrationSample";

interface Props {
  active: boolean;
  result: AnalysisResponse | null;
  summary: DatasetSummary | null;
  request: AnalysisRequest;
  desktop: boolean;
  onOpen: () => void;
  /** Kept mounted for its draft state, but not shown while another tab is open. */
  hidden?: boolean;
  onLibraryChange?: (library: CalibrationLibrary) => void;
}
function restore() {
  return restoreCalibrationMemory(key => localStorage.getItem(key));
}
export function CalibrationPanel({ active, result, summary, request, desktop, onOpen, hidden, onLibraryChange }: Props) {
  const [initial] = useState(restore);
  const [library, setLibrary] = useState<CalibrationLibrary>(initial.library);
  useEffect(() => { onLibraryChange?.(library); }, [library, onLibraryChange]);
  const [draft, setDraft] = useState<CalibrationCurve>(initial.draft);
  const [selected, setSelected] = useState("");
  const [concentration, setConcentration] = useState("");
  const [captureBaseline, setCaptureBaseline] = useState("0");
  const [sampleBaseline, setSampleBaseline] = useState("0");
  const currentResponse = analysisResponse(result);
  const responseLabel = result?.mode === "droplet" ? "平均高低差 Δ" : "平台平均高度";
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initial.error || initial.draftError);
  const [busy, setBusy] = useState(false);
  const [residualPlot, setResidualPlot] = useState(false);
  const fitState = useMemo(() => {
    try { return { fit: fitCalibration(draft), error: "" }; }
    catch (e) { return { fit: null, error: errorMessage(e) }; }
  }, [draft]);
  const fit = fitState.fit;
  const savedCurve = library.curves.find(c => c.id === selected);
  const conversion = useMemo<SampleOutcome | null>(() => {
    if (!savedCurve) return null;
    const empty: SampleOutcome = { value: null, extrapolated: false, error: "", notices: [], matched: true, curveDefinition: null, sampleDefinition: null };
    if (!result) return { ...empty, error: "等待有效的分析结果" };
    if (currentResponse == null) return { ...empty, error: "当前分析没有得到可用的平均响应" };
    try {
      const baseline = sampleBaseline.trim() === "" ? 0 : Number(sampleBaseline);
      const lookup = sampleLookup(savedCurve, currentResponse, result.mode);
      return { ...empty, ...lookup,
        ...calculateConcentration(fitCalibration(savedCurve), correctedResponse({ response: currentResponse, baseline })), error: "" };
    }
    catch (e) { return { ...empty, error: errorMessage(e) }; }
  }, [savedCurve, result, currentResponse, sampleBaseline]);
  const savedDraft = library.curves.find(c => c.id === draft.id);
  const unsaved = JSON.stringify(savedDraft) !== JSON.stringify(draft);
  useEffect(() => {
    if (initial.error || initial.draftError) return;
    try { localStorage.setItem(`${LIBRARY_KEY}.draft`, JSON.stringify({ version: 1, curves: [draft] })); }
    catch (e) { setError(`草稿记忆失败，请导出 JSON 备份：${errorMessage(e)}`); }
  }, [draft, initial.error, initial.draftError]);
  const change = (values: Partial<CalibrationCurve>) => setDraft(c => ({ ...c, ...values, updatedAt: new Date().toISOString() }));
  const task = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  function saveLibrary(next: CalibrationLibrary) {
    if (initial.error) throw new Error(initial.error);
    parseLibrary(JSON.stringify(next));
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
    setLibrary(next);
  }
  function saveDraft() {
    if (!draft.name.trim()) throw new Error("请输入曲线名称。");
    if (!fit) throw new Error(fitState.error);
    if (savedDraft && unsaved && !window.confirm("保存将更新此曲线，后续浓度计算会使用新方程。确定保存？")) return;
    saveLibrary({ version: 1, curves: [...library.curves.filter(c => c.id !== draft.id), draft] });
    setMessage("曲线已保存。");
  }
  function addCurrent() {
    const value = Number(concentration);
    if (!concentration.trim() || !Number.isFinite(value) || value < 0) throw new Error("请输入有效的非负浓度。");
    if (!desktop || !summary || !result || currentResponse == null) throw new Error("请先在桌面应用中完成文件分析。");
    assertCalibrationCompatible(draft, result.mode);
    const baseline = captureBaseline.trim() ? Number(captureBaseline) : NaN;
    correctedResponse({ response: currentResponse, baseline });
    if (draft.points.some(p => p.source === summary.fileName)) throw new Error("此文件名已存在。请移除旧点后重新填入，避免把同一文件当作独立重复；独立实验文件请使用不同名称。");
    change({ points: [...draft.points, { id: crypto.randomUUID(), concentration: value,
      response: currentResponse, baseline, weight: 1, source: summary.fileName,
      capturedAt: new Date().toISOString(), parameters: structuredClone(request),
      ...(result.mode === "droplet" ? { responseDefinition: "highMinusLowBaselineV1" as const } : {}) }] });
    setMessage(`已将 ${summary.fileName} 添加为浓度 ${value} 的标定点。`); onOpen();
  }
  const currentAvailable = desktop && currentResponse != null;
  const svg = fit ? calibrationSvg(draft, fit, residualPlot) : "";
  const exportData = (extension: "csv" | "xlsx") => task(async () => {
    if (!fit) return;
    const table = extension === "csv" ? calibrationOriginTable(draft, fit) : calibrationTable(draft, fit);
    if (await saveCalibrationArtifact(draft.name, extension, extension === "csv" ? tableCsv(table) : "", table)) setMessage(`${extension.toUpperCase()} 已导出（当前编辑版本）。`);
  });
  const exportConcentration = () => void task(async () => {
    if (!savedCurve || conversion?.value == null || !summary || currentResponse == null) return;
    const equation = fitCalibration(savedCurve);
    const baseline = sampleBaseline.trim() === "" ? 0 : Number(sampleBaseline);
    const rows: ExportCell[][] = [
      ["Source", "Captured response", "Additional baseline", "Response", "Concentration", "Unit", "Curve", "Slope", "Intercept", "Extrapolated", "Curve updated", "Processing parameters", "Curve response definition", "Sample response definition", "Definition matched"],
      [summary.fileName, currentResponse, baseline, correctedResponse({ response: currentResponse, baseline }), conversion.value, savedCurve.unit,
        savedCurve.name, equation.slope, equation.intercept, String(conversion.extrapolated), savedCurve.updatedAt, JSON.stringify(request),
        conversion.curveDefinition ? calibrationDefinition(savedCurve) : "", conversion.sampleDefinition ?? "", String(conversion.matched)],
    ];
    if (await saveCalibrationArtifact(`${summary.fileName}_concentration`, "csv", tableCsv(rows))) setMessage("浓度结果已导出。");
  });
  const sampleProps = { curves: library.curves, curve: savedCurve, selected, onSelect: setSelected,
    baseline: sampleBaseline, onBaseline: setSampleBaseline,
    sampleResponse: currentResponse, outcome: conversion, busy, onExport: exportConcentration, onOpen };
  return <section className={active ? "calibration-panel" : "calibration-strip"} aria-label="工作曲线与浓度计算" hidden={hidden}>
    {!active ? <div>
      <CalibrationSample variant="strip" {...sampleProps} />
      {savedCurve?.points.some(p => p.parameters === null || JSON.stringify(p.parameters) !== JSON.stringify(request)) &&
        <p className="calibration-notice">当前处理参数与部分标定点不同或未记录。</p>}
    </div> : <>
      <div className="calibration-toolbar">
        <h2>工作曲线</h2><span>{unsaved ? "未保存" : "已保存"}</span>
        <button className="button secondary" disabled={busy} onClick={() => {
          if (!unsaved || draft.points.length === 0 || window.confirm("创建新曲线将替换当前草稿，请确认已保存或导出。")) { setDraft(newCurve()); setMessage(""); }
        }}><Plus size={15}/>新建</button>
        <label>编辑曲线 <select value={savedDraft?.id ?? ""} onChange={e => {
          const c = library.curves.find(c => c.id === e.target.value);
          if (c && (!unsaved || draft.points.length === 0 || window.confirm("切换将替换当前草稿，确定继续？"))) { setDraft(structuredClone(c)); setMessage(""); }
        }}><option value="">选择曲线</option>{library.curves.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="button primary" disabled={busy || !fit || !!initial.error} onClick={() => void task(async () => saveDraft())}><Save size={15}/>保存曲线</button>
        <button className="button secondary" disabled={busy} onClick={() => void task(async () => {
          if (!draft.name.trim()) throw new Error("另存前请填写曲线名称，以便重新导入。");
          if (await saveCalibrationArtifact(draft.name, "json", JSON.stringify({ version: 1, curves: [draft] }, null, 2))) setMessage("当前曲线已另存 JSON（含标定点与参数，可重新导入编辑）。");
        })}>另存 JSON</button>
        <button className="button secondary" disabled={busy || !!initial.error} onClick={() => void task(async () => {
          const text = await openCalibrationLibrary(); if (text === null) return;
          const imported = parseLibrary(text);
          if (imported.curves.length === 0) throw new Error("文件没有工作曲线。");
          const copies = imported.curves.map(c => ({ ...c, id: crypto.randomUUID() }));
          saveLibrary({ version: 1, curves: [...library.curves, ...copies] });
          setMessage(`已导入 ${copies.length} 条曲线副本，原曲线及当前草稿保持不变。请从列表选择。`);
        })}><FolderOpen size={15}/>导入 JSON</button>
      </div>
      <CalibrationSample variant="panel" {...sampleProps} />
      <div className="calibration-fields">
        <label>曲线名称<input value={draft.name} maxLength={120} onChange={e => change({ name: e.target.value })}/></label>
        <label>浓度单位<input value={draft.unit} maxLength={40} placeholder="例如 μmol/L" onChange={e => change({ unit: e.target.value })}/></label>
        <label>线性回归权重<select value={draft.weighting} onChange={e => change({ weighting: e.target.value as Weighting })}>{Object.entries(WEIGHT_LABELS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      </div>
      <div className="calibration-toolbar calibration-capture">
        <span>当前文件：{summary?.fileName ?? "未加载"} · {responseLabel} {fmt(currentResponse)}</span>
        <label>已知浓度<input type="number" min="0" step="any" value={concentration} onChange={e => setConcentration(e.target.value)}/></label>
        <label title="拟合响应 = 采集响应 − 额外基线。已在数据处理中扣除的基线不要重复填入。">该点额外基线<input type="number" step="any" value={captureBaseline} onChange={e => setCaptureBaseline(e.target.value)} /></label>
        <button className="button primary" disabled={!currentAvailable || busy} onClick={() => void task(async () => addCurrent())}><Plus size={15}/>填入标定点</button>
      </div>
      {new Set(draft.points.map(p => JSON.stringify(p.parameters))).size > 1 && <p className="calibration-notice">标定点使用了不同的处理参数，请核对基线、平滑和检测设置是否允许直接比较。</p>}
      {!fit && draft.points.length > 0 && <p className="calibration-notice">{fitState.error}</p>}
      {fit && <>
        <div className="calibration-plots">
          <div><div className="calibration-toolbar"><h3>{residualPlot ? "残差诊断" : "线性拟合"}</h3><button className="button secondary" onClick={() => setResidualPlot(v => !v)}>{residualPlot ? "显示工作曲线" : "显示残差图"}</button>
            <button className="button secondary" disabled={busy} onClick={() => void task(async () => { if (await saveCalibrationArtifact(`${draft.name}_${residualPlot ? "residuals" : "fit"}`, "svg", svg)) setMessage("SVG 矢量图已导出。"); })}>SVG</button>
            <button className="button secondary" disabled={busy} onClick={() => void task(async () => { if (await saveCalibrationArtifact(`${draft.name}_${residualPlot ? "residuals" : "fit"}`, "png", await svgPng(svg))) setMessage("PNG 已导出：2400 × 1560 像素。"); })}>PNG</button></div>
            <img className="calibration-chart" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={residualPlot ? "残差对浓度散点图" : "响应对浓度线性拟合图"}/>
          </div>
          <section className="calibration-diagnostics"><h3>拟合指标与检验</h3>
            <p className="calibration-equation">y = {fmt(fit.slope)} x {fit.intercept < 0 ? "−" : "+"} {fmt(Math.abs(fit.intercept))}</p>
            <dl>{[
              ["测量点数 / 残差自由度", `${fit.n} / ${fit.df}`],
              [draft.weighting === "ols" ? "决定系数 R²" : "加权决定系数 R²", fmt(fit.r2)],
              ["RMSE · √(SSE/n)", fmt(fit.rmse)], ["剩余标准差 · √(SSE/(n−2))", fmt(fit.residualSD)],
              ...(draft.weighting === "ols" ? [] : [["加权剩余标准差（权重均值=1）", fmt(fit.weightedResidualSD)]]),
              ["斜率标准误 SE(a)", fmt(fit.slopeSE)], ["斜率 RSD · SE(a)/|a|", fit.slopeRsd === null ? "—" : `${fmt(fit.slopeRsd)}%`],
              ["截距标准误 SE(b)", fmt(fit.interceptSE)], ["截距 t / 双侧 p", `${fmt(fit.interceptT)} / ${fmt(fit.interceptP)}`],
              ["失拟 F / p", `${fmt(fit.lofF)} / ${fmt(fit.lofP)}`],
              ["失拟 / 纯误差自由度", `${fit.lofDf} / ${fit.pureDf}`],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <p>{fit.interceptP === null ? "截距 t 检验不可用：残差自由度不足或标准误为零。" : `α=0.05：${fit.interceptP < 0.05 ? "截距显著偏离零" : "截距未显著偏离零"}。`}</p>
            <p>{fit.lofReason ?? `α=0.05：${fit.lofP! < 0.05 ? "检出显著失拟" : "未检出显著失拟"}。`}</p>
          </section>
        </div>
      </>}
      {draft.points.some(p => p.parameters?.mode === "droplet" && !p.responseDefinition) && <p className="calibration-notice">草稿使用旧版低平台中心 Δ；采集当前定义的标定点需新建曲线。</p>}
      <div className="calibration-toolbar"><h3>标定点与回算偏差</h3><span>{draft.points.length} 点</span><button className="button secondary" disabled={!fit || busy} onClick={() => void exportData("csv")}><Download size={15}/>CSV</button><button className="button secondary" disabled={!fit || busy || !desktop} onClick={() => void exportData("xlsx")}>Excel</button></div>
      <div className="calibration-table-wrap"><table className="calibration-table"><thead><tr><th>来源文件</th><th>浓度</th><th>采集响应</th><th>额外基线</th><th>拟合响应</th><th>自定义权重</th><th>预测响应</th><th>残差</th><th>回算浓度</th><th>RD (%)</th><th>操作</th></tr></thead><tbody>
        {draft.points.map((point, i) => <tr key={point.id}><td title={`${point.capturedAt}\n${JSON.stringify(point.parameters)}`}>{point.source}</td>
          <td><input aria-label={`标定点 ${i + 1} 浓度`} type="number" min="0" step="any" key={`${point.id}-${point.concentration}`} defaultValue={point.concentration} onBlur={e => {
            const value = e.target.value.trim() ? Number(e.target.value) : NaN;
            if (!Number.isFinite(value) || value < 0) { e.target.value = String(point.concentration); setError("浓度必须是非负有限数值。"); return; }
            if (value !== point.concentration) change({ points: draft.points.map(p => p.id === point.id ? { ...p, concentration: value } : p) });
          }}/></td><td>{fmt(point.response)}</td>
          <td><input aria-label={`标定点 ${i + 1} 额外基线`} type="number" step="any" key={`${point.id}-baseline-${point.baseline ?? 0}`} defaultValue={point.baseline ?? 0} onBlur={e => {
            const value = e.target.value.trim() ? Number(e.target.value) : NaN;
            try { correctedResponse({ response: point.response, baseline: value }); }
            catch (error) { e.target.value = String(point.baseline ?? 0); setError(errorMessage(error)); return; }
            if (value !== (point.baseline ?? 0)) change({ points: draft.points.map(p => p.id === point.id ? { ...p, baseline: value } : p) });
          }} /></td><td>{fmt(point.response - (point.baseline ?? 0))}</td>
          <td><input aria-label={`标定点 ${i + 1} 权重`} type="number" min="0" step="any" disabled={draft.weighting !== "custom"} key={`${point.id}-${point.weight}`} defaultValue={point.weight} onBlur={e => {
            const value = Number(e.target.value); if (!Number.isFinite(value) || value <= 0) { e.target.value = String(point.weight); setError("权重必须是有限正数。"); return; }
            if (value !== point.weight) change({ points: draft.points.map(p => p.id === point.id ? { ...p, weight: value } : p) });
          }}/></td><td>{fmt(fit?.rows[i].predicted ?? null)}</td><td>{fmt(fit?.rows[i].residual ?? null)}</td><td>{fmt(fit?.rows[i].backCalculated ?? null)}</td><td>{fmt(fit?.rows[i].rd ?? null)}</td>
          <td><button className="button secondary" onClick={() => { if (window.confirm(`从草稿移除 ${point.source}？已保存版本保持不变，直到再次保存。`)) change({ points: draft.points.filter(p => p.id !== point.id) }); }}>移除</button></td></tr>)}
      </tbody></table>{draft.points.length === 0 && <div className="table-empty">暂无标定点</div>}</div>
    </>}
    {(error || initial.error || initial.draftError) && <p className="calibration-error" role="alert">{error || initial.error || initial.draftError}</p>}
    {active && message && <p className="calibration-notice" role="status">{message}</p>}
  </section>;
}
