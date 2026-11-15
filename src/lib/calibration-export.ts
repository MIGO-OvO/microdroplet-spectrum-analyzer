import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./bridge";
import { WEIGHT_LABELS, calibrationDefinition, type CalibrationCurve, type CalibrationFit } from "./calibration";

export type ExportCell = string | number | null;
export function calibrationTable(curve: CalibrationCurve, fit: CalibrationFit): ExportCell[][] {
  return [
    ["Curve", curve.name], ["Concentration unit", curve.unit], ["Weighting", WEIGHT_LABELS[curve.weighting]],
    ["Response definition", calibrationDefinition(curve)],
    ["Model", "response = slope * concentration + intercept"], ["Slope", fit.slope], ["Intercept", fit.intercept],
    ["R2 (weighted for WLS)", fit.r2], ["RMSE sqrt(SSE/n), raw response", fit.rmse],
    ["Residual SD sqrt(SSE/(n-2)), raw response", fit.residualSD],
    ["Weighted residual SD (weights normalized to mean 1)", fit.weightedResidualSD],
    ["Slope SE", fit.slopeSE], ["Slope RSD (%)", fit.slopeRsd], ["Intercept SE", fit.interceptSE],
    ["Intercept t (H0: intercept=0)", fit.interceptT], ["Intercept two-sided p", fit.interceptP], ["Residual df", fit.df],
    ["Pure error SS", fit.pureSS], ["Pure error df", fit.pureDf], ["Lack of fit SS", fit.lofSS],
    ["Lack of fit df", fit.lofDf], ["Lack of fit F", fit.lofF], ["Lack of fit p", fit.lofP],
    ["Lack of fit unavailable reason", fit.lofReason],
    ["Notes", "Independent files are replicates; RD undefined at zero concentration. t/F assume independent normal errors and correct variance model."], [],
    ["Concentration", "Response", "Normalized weight", "Predicted response", "Residual", "Weighted residual", "Back-calculated concentration", "RD (%)", "Source", "Captured at", "Processing parameters", "Captured response", "Additional baseline"],
    ...fit.rows.map(r => [r.concentration, r.response, r.normalizedWeight, r.predicted, r.residual, r.weightedResidual,
      r.backCalculated, r.rd, r.source, r.capturedAt, JSON.stringify(r.parameters), r.capturedResponse, r.baseline]),
  ];
}
// Rectangular numeric-first table for Origin: one row per independent measurement,
// no report preamble to skip during CSV import.
export function calibrationOriginTable(curve: CalibrationCurve, fit: CalibrationFit): ExportCell[][] {
  const definition = calibrationDefinition(curve);
  return [["Concentration", "Response", "Normalized weight", "Predicted response", "Residual", "Weighted residual", "Back-calculated concentration", "RD (%)", "Source", "Curve", "Unit", "Weighting", "Slope", "Intercept", "R2 (weighted for WLS)", "RMSE", "Residual SD", "Slope SE", "Slope RSD (%)", "Intercept t", "Intercept p", "Lack of fit F", "Lack of fit p", "Captured at", "Processing parameters", "Captured response", "Additional baseline", "Response definition"],
    ...fit.rows.map(r => [r.concentration, r.response, r.normalizedWeight, r.predicted, r.residual, r.weightedResidual,
      r.backCalculated, r.rd, r.source, curve.name, curve.unit, curve.weighting, fit.slope, fit.intercept, fit.r2, fit.rmse,
      fit.residualSD, fit.slopeSE, fit.slopeRsd, fit.interceptT, fit.interceptP, fit.lofF, fit.lofP, r.capturedAt, JSON.stringify(r.parameters), r.capturedResponse, r.baseline, definition])];
}
export function tableCsv(rows: ExportCell[][]): string {
  return "\ufeff" + rows.map(row => row.map(cell => {
    // Guard textual metadata against spreadsheet formula injection. Numeric negatives stay numeric.
    const value = cell === null ? "" : typeof cell === "number" ? String(cell)
      : /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
    return `"${value.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
}
export async function saveCalibrationArtifact(name: string, extension: "json" | "csv" | "xlsx" | "svg" | "png", contents: string | Uint8Array, table?: ExportCell[][]) {
  const stem = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "calibration";
  if (isTauriRuntime()) {
    const path = await save({ title: "保存工作曲线", defaultPath: `${stem}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!path) return false;
    if (!path.toLowerCase().endsWith(`.${extension}`)) throw new Error(`文件扩展名必须为 .${extension}`);
    await invoke("write_calibration_artifact", { path, contents: Array.from(typeof contents === "string" ? new TextEncoder().encode(contents) : contents), table: table ?? null });
  } else {
    if (extension === "xlsx") throw new Error("Excel 导出需在桌面应用中使用；浏览器预览可导出 CSV。");
    const data = typeof contents === "string" ? contents : new Uint8Array(contents).buffer;
    const url = URL.createObjectURL(new Blob([data], { type: extension === "svg" ? "image/svg+xml" : "application/octet-stream" }));
    const link = document.createElement("a"); link.href = url; link.download = `${stem}.${extension}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}
export async function openCalibrationLibrary(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.addEventListener("change", () => {
        const file = input.files?.[0]; if (!file) { resolve(null); return; }
        if (file.size > 20_000_000) { reject(new Error("曲线文件超过 20 MB。")); return; }
        file.text().then(resolve, reject);
      }, { once: true });
      input.click();
    });
  }
  const path = await open({ multiple: false, filters: [{ name: "工作曲线 JSON", extensions: ["json"] }] });
  return typeof path === "string" ? invoke<string>("read_calibration_artifact", { path }) : null;
}
const escapeXml = (s: string) => s.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
export const scientificNumber = (n: number | null) => n === null ? "—"
  : n !== 0 && (Math.abs(n) >= 1e5 || Math.abs(n) < 1e-4) ? n.toExponential(4) : Number(n.toPrecision(5)).toString();
export function calibrationSvg(curve: CalibrationCurve, fit: CalibrationFit, residual = false): string {
  const width = 800, height = 520, left = 135, right = 765, top = 70, bottom = 430;
  let xmin = fit.min, xmax = fit.max;
  const xp = (xmax - xmin) * 0.08; xmin -= xp; xmax += xp;
  const values = residual ? fit.rows.map(r => r.residual) : fit.rows.flatMap(r => [r.response, r.predicted]);
  let ymin = Math.min(...values, ...(residual ? [0] : []));
  let ymax = Math.max(...values, ...(residual ? [0] : []));
  const yp = (ymax - ymin) * 0.15 || Math.max(Math.abs(ymin) * 0.1, 0.1); ymin -= yp; ymax += yp;
  const x = (v: number) => left + (v - xmin) / (xmax - xmin) * (right - left);
  const y = (v: number) => bottom - (v - ymin) / (ymax - ymin) * (bottom - top);
  const tick = (v: number) => v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4)
    ? v.toExponential(2) : Number(v.toPrecision(3)).toString();
  let marks = "";
  for (let i = 0; i <= 5; i++) {
    const xv = xmin + (xmax - xmin) * i / 5, yv = ymin + (ymax - ymin) * i / 5;
    marks += `<path d="M${x(xv)},${bottom}v-7 M${left},${y(yv)}h7" stroke="#222"/><text x="${x(xv)}" y="${bottom + 27}" text-anchor="middle">${tick(xv)}</text><text x="${left - 12}" y="${y(yv) + 5}" text-anchor="end">${tick(yv)}</text>`;
  }
  const line = residual ? `<path d="M${left},${y(0)}H${right}" stroke="#555" stroke-dasharray="7 5"/>`
    : `<path d="M${x(fit.min)},${y(fit.intercept + fit.slope * fit.min)}L${x(fit.max)},${y(fit.intercept + fit.slope * fit.max)}" stroke="#147d9a" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${residual ? "残差对浓度" : "工作曲线"}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#222"><text x="${left}" y="30" font-size="20">${residual ? "Residuals vs concentration" : "Linear calibration"}</text><text x="${left}" y="53" font-size="14">${residual ? "Raw response residuals" : `y = ${scientificNumber(fit.slope)} x ${fit.intercept < 0 ? "−" : "+"} ${scientificNumber(Math.abs(fit.intercept))}; ${curve.weighting === "ols" ? "R²" : "Weighted R²"} = ${scientificNumber(fit.r2)}`}</text><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="none" stroke="#222" stroke-width="1.4"/>${marks}${line}${fit.rows.map(r => `<circle cx="${x(r.concentration)}" cy="${y(residual ? r.residual : r.response)}" r="4.5" fill="white" stroke="#222" stroke-width="1.5"/>`).join("")}<text x="${(left + right) / 2}" y="490" text-anchor="middle">Concentration${curve.unit ? ` (${escapeXml(curve.unit)})` : ""}</text><text transform="translate(24,250) rotate(-90)" text-anchor="middle">${residual ? "Residual (response)" : "Baseline-corrected response"}</text></g></svg>`;
}
export async function svgPng(svg: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 2400; canvas.height = 1560;
    const context = canvas.getContext("2d"); if (!context) throw new Error("无法创建导出画布。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG 编码失败。")), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
