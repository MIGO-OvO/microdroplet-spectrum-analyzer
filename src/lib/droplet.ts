import type { AnalysisResponse, DropletMeasurement, StableSegment } from "../types";
import { formatReferenceMode } from "./format";

/** Preserve backend chronological numbers across chart, table and export. */
export function segmentId(kind: StableSegment["kind"], number: number): string {
  return `${kind === "platform" ? "H" : kind === "bottom" ? "L" : "U"}${number}`;
}
export function lowId(number: number | null): string { return number == null ? "无" : `L${number}`; }
export function indexDroplets(result: AnalysisResponse) {
  const segments = new Map(result.stableSegments.map(s => [s.number, s]));
  const byHigh = new Map(result.dropletMeasurements.map(m => [m.highSegment, m]));
  const byLow = new Map<number, DropletMeasurement[]>();
  for (const measurement of result.dropletMeasurements) {
    for (const id of new Set([measurement.leftLowSegment, measurement.rightLowSegment])) {
      if (id == null) continue;
      const users = byLow.get(id) ?? [];
      users.push(measurement);
      byLow.set(id, users);
    }
  }
  return { segments, byHigh, byLow };
}
export function segmentUse(segment: StableSegment, index: ReturnType<typeof indexDroplets>): string {
  if (segment.kind === "unknown") return "未分类 · 不参与测量";
  if (segment.kind === "platform") {
    const m = index.byHigh.get(segment.number);
    return m ? formatReferenceMode(m.referenceMode) : "已检测 · 未形成测量";
  }
  const users = index.byLow.get(segment.number) ?? [];
  return users.length ? `作为 ${users.map(m => `H${m.highSegment}`).join("、")} 的基线来源` : "已检测 · 未被用作基线";
}
export const SCORE_EXPLANATION = "规则评分不是准确率；手动窗口内区段初始评分为 1，仅表示命中规则。请结合原始信号与质量标记复核。";
