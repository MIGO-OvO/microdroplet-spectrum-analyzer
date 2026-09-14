import { useEffect, useMemo, useState } from "react";
import { Plus, Save, FolderOpen, Download } from "lucide-react";
import type { AnalysisRequest, AnalysisResponse, DatasetSummary } from "../types";
import { analysisResponse, calibrationMode, correctedResponse, calculateConcentration, fitCalibration, LIBRARY_KEY, newCurve, parseLibrary, restoreCalibrationMemory, WEIGHT_LABELS,
  type CalibrationCurve, type CalibrationLibrary, type Weighting } from "../lib/calibration";
import { calibrationSvg, calibrationTable, calibrationOriginTable, openCalibrationLibrary, saveCalibrationArtifact,
  scientificNumber as fmt, svgPng, tableCsv } from "../lib/calibration-export";
import { errorMessage } from "../lib/format";

interface Props {
  active: boolean;
  result: AnalysisResponse | null;
  summary: DatasetSummary | null;
  request: AnalysisRequest;
  desktop: boolean;
  onOpen: () => void;
}
function restore() {
  return restoreCalibrationMemory(key => localStorage.getItem(key));
}
export function CalibrationPanel({ active, result, summary, request, desktop, onOpen }: Props) {
  const [initial] = useState(restore);
  const [library, setLibrary] = useState<CalibrationLibrary>(initial.library);
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
  const conversion = useMemo(() => {
    if (!savedCurve || currentResponse == null || !result) return null;
    try {
      if (calibrationMode(savedCurve) !== result.mode) throw new Error("当前分析模式与曲线不一致，请选择相同响应类型的曲线。");
      const baseline = sampleBaseline.trim() ? Number(sampleBaseline) : NaN;
      return { ...calculateConcentration(fitCalibration(savedCurve), correctedResponse({ response: currentResponse, baseline })), error: "" };
    }
    catch (e) { return { value: null, extrapolated: false, error: errorMessage(e) }; }
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
    setMessage("曲线已保存到本机；建议另存 JSON 作为可迁移备份。");
  }
  function addCurrent() {
    const value = Number(concentration);
    if (!concentration.trim() || !Number.isFinite(value) || value < 0) throw new Error("请输入有效的非负浓度。");
    if (!desktop || !summary || !result || currentResponse == null) throw new Error("请先在桌面应用中完成文件分析。");
    if (draft.points.length && calibrationMode(draft) !== result.mode) throw new Error("平台高度与双平台差 Δ 不能混用，请新建工作曲线。");
    const baseline = captureBaseline.trim() ? Number(captureBaseline) : NaN;
    correctedResponse({ response: currentResponse, baseline });
    if (draft.points.some(p => p.source === summary.fileName)) throw new Error("此文件名已存在。请移除旧点后重新填入，避免把同一文件当作独立重复；独立实验文件请使用不同名称。");
    change({ points: [...draft.points, { id: crypto.randomUUID(), concentration: value,
      response: currentResponse, baseline, weight: 1, source: summary.fileName,
      capturedAt: new Date().toISOString(), parameters: structuredClone(request) }] });
    setMessage(`已将 ${summary.fileName} 添加为浓度 ${value} 的标定点。`); onOpen();
  }
  const currentAvailable = desktop && currentResponse != null;
  const svg = fit ? calibrationSvg(draft, fit, residualPlot) : "";
  const exportData = (extension: "csv" | "xlsx") => task(async () => {
    if (!fit) return;
    const table = extension === "csv" ? calibrationOriginTable(draft, fit) : calibrationTable(draft, fit);
    if (await saveCalibrationArtifact(draft.name, extension, extension === "csv" ? tableCsv(table) : "", table)) setMessage(`${extension.toUpperCase()} 已导出（当前编辑版本）。`);
  });
  return <section className={active ? "calibration-panel" : "calibration-strip"} aria-label="工作曲线与浓度计算">
    {!active ? <div className="calibration-toolbar">
      <strong>浓度计算</strong>
      <label>已保存曲线 <select value={selected} onChange={e => setSelected(e.target.value)}><option value="">不使用曲线</option>{library.curves.map(c => <option key={c.id} value={c.id}>{c.name} {c.unit && `(${c.unit})`}</option>)}</select></label>
      {savedCurve && <label>样品额外基线<input type="number" step="any" value={sampleBaseline} onChange={e => setSampleBaseline(e.target.value)} /></label>}
      {conversion ? <output>{conversion.error || `浓度：${fmt(conversion.value)} ${savedCurve?.unit ?? ""}${conversion.extrapolated ? " · 超出标定范围（外推）" : ""}`}</output> : <span>{selected ? "等待有效分析结果" : "选择曲线后按当前文件响应反算"}</span>}
      {savedCurve && <span>y = {(() => { try { const f = fitCalibration(savedCurve); return `${fmt(f.slope)} x + ${fmt(f.intercept)}`; } catch { return "无效方程"; } })()}</span>}
      {conversion?.value != null && <button className="button secondary" disabled={busy} onClick={() => void task(async () => {
        const f = fitCalibration(savedCurve!);
        const rows = [["Source", "Captured response", "Additional baseline", "Response", "Concentration", "Unit", "Curve", "Slope", "Intercept", "Extrapolated", "Curve updated", "Processing parameters"],
          [summary!.fileName, currentResponse, Number(sampleBaseline), correctedResponse({ response: currentResponse!, baseline: Number(sampleBaseline) }), conversion.value, savedCurve!.unit, savedCurve!.name, f.slope, f.intercept, String(conversion.extrapolated), savedCurve!.updatedAt, JSON.stringify(request)]];
        if (await saveCalibrationArtifact(`${summary!.fileName}_concentration`, "csv", tableCsv(rows))) setMessage("浓度结果已导出。");
      })}>导出浓度 CSV</button>}
      <button className="button secondary" onClick={onOpen}>管理工作曲线</button>
      {savedCurve && savedCurve.points.some(p => p.parameters === null || JSON.stringify(p.parameters) !== JSON.stringify(request)) && <span>注意：当前处理参数与部分标定点不同或来源参数未知，请确认测量条件可比。</span>}
    </div> : <>
      <div className="calibration-toolbar">
        <h2>工作曲线</h2><span>{unsaved ? "草稿 · 未保存到曲线库" : "已保存"}</span>
        <button className="button secondary" disabled={busy} onClick={() => {
          if (!unsaved || draft.points.length === 0 || window.confirm("创建新曲线将替换当前草稿，请确认已保存或导出。")) { setDraft(newCurve()); setMessage(""); }
        }}><Plus size={15}/>新建</button>
        <label>编辑已存曲线 <select value={savedDraft?.id ?? ""} onChange={e => {
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
      <div className="calibration-fields">
        <label>曲线名称<input value={draft.name} maxLength={120} onChange={e => change({ name: e.target.value })}/></label>
        <label>浓度单位<input value={draft.unit} maxLength={40} placeholder="例如 μmol/L" onChange={e => change({ unit: e.target.value })}/></label>
        <label>线性回归权重<select value={draft.weighting} onChange={e => change({ weighting: e.target.value as Weighting })}>{Object.entries(WEIGHT_LABELS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      </div>
      <div className="calibration-toolbar calibration-capture">
        <span>当前文件：{summary?.fileName ?? "未加载"} · {responseLabel} {fmt(currentResponse)}</span>
        <label>已知浓度<input type="number" min="0" step="any" value={concentration} onChange={e => setConcentration(e.target.value)} placeholder="用户输入"/></label>
        <label>该点额外基线<input type="number" step="any" value={captureBaseline} onChange={e => setCaptureBaseline(e.target.value)} /></label>
        <button className="button primary" disabled={!currentAvailable || busy} onClick={() => void task(async () => addCurrent())}><Plus size={15}/>填入标定点</button>
        <span>一个文件为一个测量点，同浓度可添加独立重复文件。</span>
      </div>
      <p className="calibration-notice">拟合响应 = 采集响应 − 该点额外基线。每个浓度的测量点可分别修改；已在数据处理中扣除的基线不要重复填入。双平台采集响应为高低差 Δ，不是单个平台高度。</p>
      {new Set(draft.points.map(p => JSON.stringify(p.parameters))).size > 1 && <p className="calibration-notice">标定点使用了不同的处理参数，请核对基线、平滑和检测设置是否允许直接比较。</p>}
      {!fit && <p className="calibration-notice">{fitState.error}</p>}
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
            <p>{fit.interceptP === null ? "截距 t 检验不可用：残差自由度不足或标准误为零。" : `α=0.05：${fit.interceptP < 0.05 ? "截距显著偏离零" : "未发现截距显著偏离零"}；不据此自动强制过原点。`}</p>
            <p>{fit.lofReason ?? `α=0.05：${fit.lofP! < 0.05 ? "检出显著失拟，线性模型可能不足" : "未检出显著失拟（不等于证明线性）"}。`}</p>
          </section>
        </div>
        <p className="calibration-notice">残差出现漏斗趋势时，可比较加权拟合；权重应有方差依据（如 1/σ²），不会自动选择。t/F 检验假设独立、正态误差及正确方差模型；加权结果中的斜率 RSD 是参数相对标准误，不是多次建曲线的重复性。零浓度 RD 不定义。</p>
      </>}
      <div className="calibration-toolbar"><h3>标定点与回算偏差</h3><span>{draft.points.length} 个测量点 · 浓度、额外基线和权重可修改，采集响应保留</span><button className="button secondary" disabled={!fit || busy} onClick={() => void exportData("csv")}><Download size={15}/>CSV</button><button className="button secondary" disabled={!fit || busy || !desktop} onClick={() => void exportData("xlsx")}>Excel</button></div>
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
      </tbody></table>{draft.points.length === 0 && <p className="calibration-notice">先处理标准样品文件，输入其已知浓度，再点击“填入标定点”。曲线草稿会在本机自动记忆。</p>}</div>
    </>}
    {(error || initial.error || initial.draftError) && <p className="calibration-error" role="alert">{error || initial.error || initial.draftError}</p>}
    {message && <p className="calibration-notice" role="status">{message}</p>}
  </section>;
}
