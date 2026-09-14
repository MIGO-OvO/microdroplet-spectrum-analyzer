import type { AnalysisRequest, AnalysisResponse } from "../types";

export type Weighting = "ols" | "inverseX" | "inverseX2" | "custom";
export interface CalibrationPoint {
  id: string;
  concentration: number;
  response: number;
  /** Additional baseline; never mutate the captured response. Old points use zero. */
  baseline?: number;
  weight: number;
  source: string;
  capturedAt: string;
  parameters: AnalysisRequest | null;
}
export interface CalibrationCurve {
  id: string;
  name: string;
  unit: string;
  weighting: Weighting;
  points: CalibrationPoint[];
  updatedAt: string;
}
export interface CalibrationLibrary { version: 1; curves: CalibrationCurve[] }
export const LIBRARY_KEY = "microdroplet.calibration.v1";
export const WEIGHT_LABELS: Record<Weighting, string> = {
  ols: "普通最小二乘（等权）", inverseX: "加权 1/x", inverseX2: "加权 1/x²", custom: "自定义正权重",
};
export const newCurve = (): CalibrationCurve => ({
  id: crypto.randomUUID(), name: "新工作曲线", unit: "", weighting: "ols", points: [], updatedAt: new Date().toISOString(),
});

// Lanczos log-gamma and Lentz continued fraction for regularized incomplete beta.
// Student t two-sided p and F survival use beta directly, avoiding 1-CDF cancellation.
function logGamma(z: number): number {
  const c = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.9999999999998099;
  c.forEach((v, i) => { x += v / (z + i + 1); });
  const t = z + c.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const nonzero = (v: number) => Math.abs(v) < tiny ? (v < 0 ? -tiny : tiny) : v;
  let c = 1;
  let d = 1 / nonzero(1 - (a + b) * x / (a + 1));
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const terms = [m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)),
      -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))];
    for (let k = 0; k < terms.length; k++) {
      const aa = terms[k];
      d = 1 / nonzero(1 + aa * d);
      c = nonzero(1 + aa / c);
      const delta = d * c;
      h *= delta;
      if (k === 1 && Math.abs(delta - 1) < 3e-14) return h;
    }
  }
  throw new Error("统计分布计算未收敛，请检查数值范围。");
}
function beta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  const result = x < (a + 1) / (a + b + 2)
    ? bt * betaFraction(a, b, x) / a : 1 - bt * betaFraction(b, a, 1 - x) / b;
  return Math.max(0, Math.min(1, result));
}
export function tPValue(t: number, df: number): number {
  return beta(df / (df + t * t), df / 2, 0.5);
}
export function fPValue(f: number, df1: number, df2: number): number {
  return beta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export function correctedResponse(point: Pick<CalibrationPoint, "response" | "baseline">): number {
  const baseline = point.baseline ?? 0;
  const value = point.response - baseline;
  if (!Number.isFinite(point.response) || !Number.isFinite(baseline) || !Number.isFinite(value)) {
    throw new Error("响应与基线必须是有限数值，且扣减结果不能溢出。");
  }
  return value;
}
export function analysisResponse(result: AnalysisResponse | null): number | null {
  return result?.mode === "droplet" ? result.dropletStatistics.meanCorrectedSignal : result?.statistics.meanHeight ?? null;
}
export function calibrationMode(curve: CalibrationCurve) {
  const modes = new Set(curve.points.map(p => p.parameters?.mode ?? "plateau"));
  if (modes.size > 1) throw new Error("同一曲线不能混用平台高度与双平台校正差 Δ，请分别建立曲线。");
  return modes.values().next().value ?? "plateau";
}
export function fitCalibration(curve: CalibrationCurve) {
  calibrationMode(curve);
  const points = curve.points.map(p => ({ ...p, capturedResponse: p.response, baseline: p.baseline ?? 0, response: correctedResponse(p) }));
  const n = points.length;
  if (n < 2) throw new Error("至少添加两个不同浓度的标定点才能拟合。");
  if (points.some(p => !Number.isFinite(p.concentration) || p.concentration < 0 || !Number.isFinite(p.response))) {
    throw new Error("浓度必须为有限非负数，响应必须为有限数值。");
  }
  const rawWeights = points.map(p => {
    if ((curve.weighting === "inverseX" || curve.weighting === "inverseX2") && p.concentration <= 0) {
      throw new Error("1/x 和 1/x² 不支持零浓度；请改用等权或自定义权重，不会自动排除空白点。");
    }
    return curve.weighting === "inverseX" ? 1 / p.concentration
      : curve.weighting === "inverseX2" ? 1 / p.concentration ** 2
      : curve.weighting === "custom" ? p.weight : 1;
  });
  if (rawWeights.some(w => !Number.isFinite(w) || w <= 0)) throw new Error("权重必须为有限正数。");
  // Normalize to mean 1, making weighted residual scale independent of arbitrary weight scaling.
  const weightMean = sum(rawWeights) / n;
  const w = rawWeights.map(v => v / weightMean);
  const sw = sum(w);
  const mx = sum(points.map((p, i) => w[i] * p.concentration)) / sw;
  const my = sum(points.map((p, i) => w[i] * p.response)) / sw;
  const sxx = sum(points.map((p, i) => w[i] * (p.concentration - mx) ** 2));
  if (!(sxx > 0) || !Number.isFinite(sxx)) throw new Error("浓度必须至少有两个不同值，且数值范围不能溢出。");
  const slope = sum(points.map((p, i) => w[i] * (p.concentration - mx) * (p.response - my))) / sxx;
  const intercept = my - slope * mx;
  const rows = points.map((p, i) => {
    const predicted = intercept + slope * p.concentration;
    const residual = p.response - predicted;
    const backCalculated = slope === 0 ? null : (p.response - intercept) / slope;
    return { ...p, normalizedWeight: w[i], predicted, residual, weightedResidual: residual * Math.sqrt(w[i]),
      backCalculated, rd: p.concentration === 0 || backCalculated === null ? null : 100 * (backCalculated - p.concentration) / p.concentration };
  });
  const sse = sum(rows.map(r => r.residual ** 2));
  const wsse = sum(rows.map(r => r.weightedResidual ** 2));
  const tss = sum(points.map((p, i) => w[i] * (p.response - my) ** 2));
  if (![slope, intercept, sse, wsse, tss, sw].every(Number.isFinite)) throw new Error("拟合数值溢出，请调整浓度或响应单位。");
  const df = n - 2;
  const variance = df > 0 ? wsse / df : null;
  const slopeSE = variance === null ? null : Math.sqrt(variance / sxx);
  const interceptSE = variance === null ? null : Math.sqrt(variance * (1 / sw + mx * mx / sxx));
  const interceptT = interceptSE === null || interceptSE === 0 ? null : intercept / interceptSE;
  const interceptP = interceptT === null ? null : tPValue(interceptT, df);
  const groups = new Map<number, typeof rows>();
  rows.forEach(r => groups.set(r.concentration, [...(groups.get(r.concentration) ?? []), r]));
  const pureDf = n - groups.size;
  const lofDf = groups.size - 2;
  let pureSS = 0;
  groups.forEach(group => {
    const mean = sum(group.map(r => r.response)) / group.length;
    pureSS += sum(group.map(r => (r.response - mean) ** 2));
  });
  const lofSS = Math.max(0, sse - pureSS);
  const lofReason = curve.weighting !== "ols" ? "经典失拟 F 检验仅对等权回归提供；加权模型需另外验证方差结构。"
    : lofDf <= 0 ? "至少需要三个不同浓度。" : pureDf <= 0 ? "需要同浓度的独立重复文件。"
    : pureSS <= 0 ? "纯误差为零，无法进行失拟 F 检验。" : null;
  const lofF = lofReason ? null : (lofSS / lofDf) / (pureSS / pureDf);
  return { slope, intercept, n, df, r2: tss === 0 ? null : 1 - wsse / tss,
    rmse: Math.sqrt(sse / n), residualSD: df > 0 ? Math.sqrt(sse / df) : null,
    weightedResidualSD: variance === null ? null : Math.sqrt(variance), slopeSE, interceptSE,
    slopeRsd: slopeSE === null || slope === 0 ? null : 100 * slopeSE / Math.abs(slope),
    interceptT, interceptP, pureSS, pureDf, lofSS, lofDf, lofF,
    lofP: lofF === null ? null : fPValue(lofF, lofDf, pureDf), lofReason,
    min: Math.min(...points.map(p => p.concentration)), max: Math.max(...points.map(p => p.concentration)), rows };
}
export type CalibrationFit = ReturnType<typeof fitCalibration>;
export function calculateConcentration(fit: CalibrationFit, response: number) {
  if (!Number.isFinite(response) || fit.slope === 0) throw new Error("响应无效或斜率为零，不能反算浓度。");
  const value = (response - fit.intercept) / fit.slope;
  if (!Number.isFinite(value)) throw new Error("反算浓度溢出。");
  return { value, extrapolated: value < fit.min || value > fit.max };
}

export function parseLibrary(text: string, allowIncompleteDraftName = false): CalibrationLibrary {
  const data = JSON.parse(text);
  if (data?.version !== 1 || !Array.isArray(data.curves) || data.curves.length > 200) throw new Error("工作曲线文件格式或版本不受支持。");
  const ids = new Set<string>();
  for (const c of data.curves) {
    if (!c || typeof c.id !== "string" || ids.has(c.id) || typeof c.name !== "string" || (!allowIncompleteDraftName && !c.name.trim())
      || typeof c.unit !== "string" || !Object.hasOwn(WEIGHT_LABELS, c.weighting)
      || typeof c.updatedAt !== "string" || !Array.isArray(c.points) || c.points.length > 10000) throw new Error("工作曲线元数据无效。");
    ids.add(c.id);
    const pointIds = new Set<string>();
    for (const p of c.points) {
      if (!p || typeof p.id !== "string" || pointIds.has(p.id) || !Number.isFinite(p.concentration) || p.concentration < 0
        || !Number.isFinite(p.response) || !Number.isFinite(p.weight) || p.weight <= 0
        || (p.baseline !== undefined && !Number.isFinite(p.baseline))
        || typeof p.source !== "string" || typeof p.capturedAt !== "string"
        || !(p.parameters === null || (["plateau", "droplet"].includes(p.parameters?.mode) && p.parameters.preprocess && p.parameters.plateau
          && (p.parameters.mode !== "droplet" || p.parameters.droplet)))) {
        throw new Error("标定点数据无效。");
      }
      pointIds.add(p.id);
    }
  }
  return data as CalibrationLibrary;
}

export function restoreCalibrationMemory(read: (key: string) => string | null) {
  let library: CalibrationLibrary = { version: 1, curves: [] };
  let draft = newCurve();
  let error = "", draftError = "";
  try {
    const saved = read(LIBRARY_KEY);
    if (saved) library = parseLibrary(saved);
  } catch (e) {
    error = `本地曲线库无法读取；为保护原数据已禁用曲线库写入。请备份原存储后处理：${String(e)}`;
  }
  try {
    const saved = read(`${LIBRARY_KEY}.draft`);
    if (saved) draft = parseLibrary(saved, true).curves[0] ?? draft;
  } catch (e) {
    draftError = `原草稿无法读取，已保留原存储并暂停草稿自动记忆；已保存曲线仍可使用。新编辑请保存到曲线库或另存 JSON：${String(e)}`;
  }
  return { library, draft, error, draftError };
}
