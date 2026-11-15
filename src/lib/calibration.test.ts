import { describe, expect, it } from "vitest";
import { calculateConcentration, fitCalibration, newCurve, parseLibrary, restoreCalibrationMemory, LIBRARY_KEY, tPValue, fPValue, type CalibrationCurve } from "./calibration";
import { calibrationSvg, calibrationTable, calibrationOriginTable, tableCsv } from "./calibration-export";
import { analysisResponse, correctedResponse, assertCalibrationCompatible, calibrationDefinition, sampleLookup, responseDefinitionForMode } from "./calibration";
import { DEFAULT_REQUEST } from "../types";
import { SAMPLE_DROPLET_RESULT, SAMPLE_RESULT } from "./sample";

function fixture(): CalibrationCurve {
  return { ...newCurve(), name: "Independent replicate fixture", points: [1, 2, 2, 4, 5, 6].map((response, i) => ({
    id: String(i), concentration: Math.floor(i / 2), response, weight: i + 1, source: `${i}.csv`,
    parameters: null, capturedAt: "2026-09-09T00:00:00Z",
  })) };
}

describe("response definition migration safety", () => {
  const legacy = () => ({ ...fixture(), points: fixture().points.map(p => ({ ...p,
    parameters: { ...DEFAULT_REQUEST, mode: "droplet" as const } })) });
  it("preserves old responses but refuses to use them with new high-centered measurements", () => {
    const curve = legacy();
    const restored = parseLibrary(JSON.stringify({ version: 1, curves: [curve] })).curves[0];
    expect(restored.points).toEqual(curve.points);
    expect(calibrationDefinition(restored)).toBe("legacyLowCenteredDelta");
    expect(() => fitCalibration(restored)).not.toThrow();
    expect(() => assertCalibrationCompatible(restored, "droplet")).toThrow("旧版低平台中心");
  });
  it("accepts new-definition curves and rejects mixed or unknown definitions", () => {
    const curve = legacy();
    const current = { ...curve, points: curve.points.map(p => ({ ...p, responseDefinition: "highMinusLowBaselineV1" as const })) };
    expect(() => assertCalibrationCompatible(current, "droplet")).not.toThrow();
    expect(() => fitCalibration({ ...current, points: [...current.points, curve.points[0]] })).toThrow("不同响应定义");
    expect(() => parseLibrary(JSON.stringify({ version: 1, curves: [{ ...curve, points: curve.points.map(p => ({ ...p, responseDefinition: "unknown" })) }] }))).toThrow("标定点数据无效");
    expect(parseLibrary(JSON.stringify({ version: 1, curves: [current] })).curves[0]).toEqual(current);
  });
});
describe("calibration numerical reference (SciPy 1.x independent cross-check)", () => {
  it("matches OLS coefficients, standard errors and two-sided t p value", () => {
    const f = fitCalibration(fixture());
    expect(f.slope).toBeCloseTo(2, 13);
    expect(f.intercept).toBeCloseTo(4 / 3, 13);
    expect(f.r2).toBeCloseTo(0.909717652294684 ** 2, 12);
    expect(f.slopeSE).toBeCloseTo(0.4564354645876386, 12);
    expect(f.interceptSE).toBeCloseTo(0.5892556509887898, 12);
    expect(f.interceptP).toBeCloseTo(0.0864180504571546, 12);
    expect(f.rmse).toBeCloseTo(Math.sqrt((10 / 3) / 6), 12);
    expect(f.residualSD).toBeCloseTo(Math.sqrt((10 / 3) / 4), 12);
    expect(f.slopeRsd).toBeCloseTo(100 * f.slopeSE! / 2, 12);
    expect(f.rows[0].rd).toBeNull();
    expect(f.rows[2].rd).toBeCloseTo(-200 / 3, 12);
  });
  it("partitions lack-of-fit and pure error with independent replicates", () => {
    const f = fitCalibration(fixture());
    expect(f.pureSS).toBeCloseTo(3, 13); expect(f.pureDf).toBe(3); expect(f.lofDf).toBe(1);
    expect(f.lofF).toBeCloseTo(1 / 3, 12); expect(f.lofP).toBeCloseTo(0.6041813035905921, 12);
  });
  it("matches WLS normal-equation reference and is invariant under weight rescaling", () => {
    const c = { ...fixture(), weighting: "custom" as const };
    const f = fitCalibration(c);
    expect(f.intercept).toBeCloseTo(1.3565217391304347, 11);
    expect(f.slope).toBeCloseTo(2.0521739130434784, 11);
    expect(f.interceptP).toBeCloseTo(0.15899844601860477, 11);
    const scaled = fitCalibration({ ...c, points: c.points.map(p => ({ ...p, weight: p.weight * 100 })) });
    expect(scaled.slopeSE).toBeCloseTo(f.slopeSE!, 12);
    expect(scaled.weightedResidualSD).toBeCloseTo(f.weightedResidualSD!, 12);
    expect(f.lofF).toBeNull(); expect(f.lofReason).toContain("等权");
  });
  it("handles t and F survival tails without subtractive cancellation", () => {
    expect(tPValue(0, 4)).toBe(1); expect(tPValue(1, 1)).toBeCloseTo(0.5, 12);
    expect(tPValue(-2, 10)).toBe(tPValue(2, 10));
    expect(fPValue(1, 1, 1)).toBeCloseTo(0.5, 12);
    expect(tPValue(1e10, 10)).toBeGreaterThan(0);
    for (const [t, df, p] of [[0.01, 1, 0.993634014470186], [2, 3, 0.13932596855884305],
      [5, 100, 2.4501734135038015e-6], [2, 10000, 0.04552726066143543], [20, 30, 6.7490836657712895e-19]]) {
      expect(tPValue(t, df) / p).toBeCloseTo(1, 8);
    }
    for (const [f, d1, d2, p] of [[0.01, 2, 5, 0.9900695822980478], [3, 10, 20, 0.017509541478400014],
      [100, 1, 100, 9.901688984594144e-17], [1, 100, 100, 0.5], [1.2, 10000, 10000, 4.1362594785003873e-20]]) {
      expect(fPValue(f, d1, d2) / p).toBeCloseTo(1, 8);
    }
  });
});
describe("calibration guards and persistence", () => {
  it("subtracts each point baseline once without changing captured response", () => {
    const c = fixture();
    const shifted = { ...c, points: c.points.map((p, i) => ({ ...p, response: p.response + i * 0.2, baseline: i * 0.2 })) };
    expect(fitCalibration(shifted).slope).toBeCloseTo(fitCalibration(c).slope, 12);
    expect(fitCalibration(shifted).intercept).toBeCloseTo(fitCalibration(c).intercept, 12);
    expect(shifted.points[5].response).toBe(7);
    expect(fitCalibration(shifted).rows[5].response).toBe(6);
  });
  it("persists baselines, exports captured and corrected responses, and reads legacy points", () => {
    const c = { ...fixture(), points: fixture().points.map(p => ({ ...p, baseline: 0.2 })) };
    const restored = parseLibrary(JSON.stringify({ version: 1, curves: [c] })).curves[0];
    const f = fitCalibration(restored);
    const csv = calibrationOriginTable(restored, f);
    expect(csv[0].slice(-3)).toEqual(["Captured response", "Additional baseline", "Response definition"]);
    expect(csv[1][1]).toBeCloseTo(0.8);
    expect(csv[1].slice(-3)).toEqual([1, 0.2, "plateauHeight"]);
    expect(fitCalibration(fixture()).rows[0].response).toBe(1);
    expect(() => correctedResponse({ response: 1, baseline: Infinity })).toThrow();
    expect(() => parseLibrary(JSON.stringify({ version: 1, curves: [{ ...c, points: [{ ...c.points[0], baseline: "0.2" }] }] }))).toThrow();
  });
  it("accepts droplet calibration but prevents mixed response types", () => {
    const c = { ...fixture(), points: fixture().points.map(p => ({ ...p, parameters: { ...DEFAULT_REQUEST, mode: "droplet" as const }, baseline: -0.1 })) };
    expect(parseLibrary(JSON.stringify({ version: 1, curves: [c] })).curves[0].points).toHaveLength(6);
    expect(fitCalibration(c).intercept).toBeCloseTo(4 / 3 + 0.1);
    expect(() => fitCalibration({ ...c, points: [fixture().points[0], ...c.points.slice(1)] })).toThrow("混用");
    expect(analysisResponse(SAMPLE_DROPLET_RESULT)).toBe(SAMPLE_DROPLET_RESULT.dropletStatistics.meanCorrectedSignal);
    expect(analysisResponse(SAMPLE_RESULT)).toBe(SAMPLE_RESULT.statistics.meanHeight);
    expect(analysisResponse(null)).toBeNull();
  });
  it("two points give a line but no inferential statistics", () => {
    const c = fixture(); c.points = [c.points[0], c.points[2]];
    const f = fitCalibration(c); expect(f.df).toBe(0); expect(f.interceptP).toBeNull(); expect(f.slopeRsd).toBeNull();
  });
  it("rejects degenerate concentrations, invalid weights and zero-x inverse weighting", () => {
    expect(() => fitCalibration(newCurve())).toThrow();
    const c = fixture();
    expect(() => fitCalibration({ ...c, points: c.points.map(p => ({ ...p, concentration: 1 })) })).toThrow();
    for (const weighting of ["inverseX", "inverseX2"] as const) expect(() => fitCalibration({ ...c, weighting })).toThrow("零浓度");
    expect(() => fitCalibration({ ...c, weighting: "custom", points: c.points.map(p => ({ ...p, weight: 0 })) })).toThrow();
    expect(() => fitCalibration({ ...c, points: c.points.map(p => ({ ...p, response: Infinity })) })).toThrow();
  });
  it("calculates inverse-weight fits on positive concentrations", () => {
    const c = fixture(); c.points = c.points.map(p => ({ ...p, concentration: p.concentration + 1 }));
    for (const weighting of ["inverseX", "inverseX2"] as const) {
      const f = fitCalibration({ ...c, weighting });
      expect(f.slope).toBeGreaterThan(0); expect(f.r2).toBeGreaterThan(0.5);
    }
  });
  it("rejects inverse prediction on zero slopes and flags extrapolation", () => {
    const f = fitCalibration(fixture());
    expect(calculateConcentration(f, 10 / 3)).toEqual({ value: 1, extrapolated: false });
    expect(calculateConcentration(f, 100).extrapolated).toBe(true);
    expect(() => calculateConcentration(f, NaN)).toThrow();
    const constant = fitCalibration({ ...fixture(), points: fixture().points.map(p => ({ ...p, response: 1 })) });
    expect(constant.r2).toBeNull(); expect(() => calculateConcentration(constant, 1)).toThrow();
  });
  it("reports missing replicates and zero pure error explicitly", () => {
    const c = fixture(); c.points = [c.points[0], c.points[2], c.points[4]];
    expect(fitCalibration(c).lofReason).toContain("独立重复");
    c.points = fixture().points.map(p => ({ ...p, response: p.concentration * 2 + 1 }));
    expect(fitCalibration(c).lofReason).toContain("纯误差为零");
  });
  it("roundtrips source metadata and rejects invalid or duplicate records", () => {
    const c = fixture(); const library = { version: 1, curves: [c] };
    expect(parseLibrary(JSON.stringify(library))).toEqual(library);
    expect(() => parseLibrary('{"version":2,"curves":[]}')).toThrow();
    expect(() => parseLibrary(JSON.stringify({ ...library, curves: [c, c] }))).toThrow();
    expect(() => parseLibrary(JSON.stringify({ ...library, curves: [{ ...c, weighting: "toString" }] }))).toThrow();
    expect(() => parseLibrary(JSON.stringify({ ...library, curves: [{ ...c, points: [{ ...c.points[0], weight: -1 }] }] }))).toThrow();
  });
  it("incomplete or corrupted drafts never hide a valid saved library", () => {
    const saved = JSON.stringify({ version: 1, curves: [fixture()] });
    const blank = JSON.stringify({ version: 1, curves: [{ ...fixture(), name: "" }] });
    const restored = restoreCalibrationMemory(key => key === LIBRARY_KEY ? saved : blank);
    expect(restored.library.curves).toHaveLength(1); expect(restored.draft.name).toBe("");
    expect(restored.error).toBe(""); expect(restored.draftError).toBe("");
    expect(() => parseLibrary(blank)).toThrow();
    const broken = restoreCalibrationMemory(key => key === LIBRARY_KEY ? saved : "bad json");
    expect(broken.library.curves).toHaveLength(1); expect(broken.error).toBe(""); expect(broken.draftError).not.toBe("");
    const blocked = restoreCalibrationMemory(() => { throw new Error("storage unavailable"); });
    expect(blocked.error).not.toBe("");
  });
});
describe("portable scientific exports", () => {
  it("escapes XML metadata and exports both plot variants", () => {
    const c = fixture(); c.unit = '<script>&"μM'; const f = fitCalibration(c);
    const svg = calibrationSvg(c, f);
    expect(svg).toContain("&lt;script&gt;&amp;&quot;μM"); expect(svg).not.toContain("<script>");
    expect(svg.match(/<circle/g)).toHaveLength(6);
    expect(calibrationSvg(c, f, true)).toContain("Residuals vs concentration");
  });
  it("CSV quotes metadata, preserves negative numerics, and defuses formulas", () => {
    expect(tableCsv([["=cmd()", -2, 'a,"b', null]])).toBe('\ufeff"\'=cmd()","-2","a,""b",""');
    const c = fixture(); expect(calibrationTable(c, fitCalibration(c)).flat()).toContain("RD (%)");
    const origin = calibrationOriginTable(c, fitCalibration(c));
    expect(origin).toHaveLength(7); expect(origin.every(r => r.length === origin[0].length)).toBe(true);
    expect(origin[1][0]).toBe(0); expect(origin[1][7]).toBeNull();
  });
});
describe("quick concentration lookup across analysis modes", () => {
  const plateauCurve = () => ({ ...fixture(), points: fixture().points.map(p => ({ ...p, parameters: { ...DEFAULT_REQUEST, mode: "plateau" as const } })) });
  const dropletCurve = () => ({ ...fixture(), points: fixture().points.map(p => ({ ...p,
    parameters: { ...DEFAULT_REQUEST, mode: "droplet" as const }, responseDefinition: "highMinusLowBaselineV1" as const })) });
  it("substitutes a sample from the other mode instead of refusing to compute", () => {
    const lookup = sampleLookup(plateauCurve(), 3, "droplet");
    expect(lookup.matched).toBe(false);
    expect(lookup.response).toBe(3);
    expect(lookup.curveDefinition).toBe("plateauHeight");
    expect(lookup.sampleDefinition).toBe("highMinusLowBaselineV1");
    expect(lookup.notices).toHaveLength(1);
    expect(lookup.notices[0]).toContain("平台平均高度");
    expect(lookup.notices[0]).toContain("快速参考");
    // The conversion still happens: no exception, a number, and the same equation.
    const value = calculateConcentration(fitCalibration(plateauCurve()), lookup.response);
    expect(value.value).toBeCloseTo((3 - 4 / 3) / 2, 12);
  });
  it("stays quiet when curve and sample share one response definition", () => {
    for (const [curve, mode] of [[plateauCurve(), "plateau"], [dropletCurve(), "droplet"]] as const) {
      const lookup = sampleLookup(curve, 2, mode);
      expect(lookup.matched).toBe(true);
      expect(lookup.notices).toEqual([]);
    }
    expect(responseDefinitionForMode("plateau")).toBe("plateauHeight");
    expect(responseDefinitionForMode("droplet")).toBe("highMinusLowBaselineV1");
  });
  it("flags a curve built from the retired low-centered Δ", () => {
    const legacy = { ...dropletCurve(), points: dropletCurve().points.map(p => ({ ...p, responseDefinition: undefined })) };
    const lookup = sampleLookup(legacy, 2, "droplet");
    expect(lookup.matched).toBe(false);
    expect(lookup.curveDefinition).toBe("legacyLowCenteredDelta");
    expect(lookup.notices[0]).toContain("旧版低平台中心 Δ");
  });
  it("rejects a response that no analysis produced", () => {
    expect(() => sampleLookup(plateauCurve(), Number.NaN, "plateau")).toThrow("没有可用的平均响应");
  });
});
