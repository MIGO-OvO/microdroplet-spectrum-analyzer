import { describe, expect, it } from "vitest";

import { DEFAULT_REQUEST, type QualityFlag, type ReferenceMode, type SegmentKind } from "../types";
import { SAMPLE_DROPLET_RESULT, SAMPLE_RESULT } from "./sample";
import {
  buildAxisTicks,
  formatMeasurement,
  formatQualityFlag,
  formatReferenceMode,
  formatSegmentKind,
} from "./format";

describe("formatMeasurement", () => {
  it("uses a dash for absent values", () => {
    expect(formatMeasurement(null)).toBe("—");
  });

  it("uses scientific notation for very small non-zero values", () => {
    expect(formatMeasurement(0.0000123)).toContain("e");
  });
});

describe("buildAxisTicks", () => {
  it("uses round integer ticks for sample indices", () => {
    const ticks = buildAxisTicks(0, 1799, 6, true);

    expect(ticks.fractionDigits).toBe(0);
    expect(ticks.values).toEqual([0, 500, 1000, 1500]);
  });

  it("retains the precision required by real-time values", () => {
    const ticks = buildAxisTicks(0.0012, 0.0021, 6);

    expect(ticks.fractionDigits).toBe(4);
    expect(ticks.values).toEqual([0.0012, 0.0014, 0.0016, 0.0018, 0.002]);
  });
});

describe("droplet vocabulary labels", () => {
  const kinds: SegmentKind[] = ["unknown", "platform", "bottom"];
  const modes: ReferenceMode[] = ["interpolated", "leftOnly", "rightOnly", "none"];
  const flags: QualityFlag[] = [
    "lowClassificationConfidence",
    "singleSidedReference",
    "largeReferenceGap",
    "noisyBottom",
    "noisyPlatform",
    "nearbyUnknownSegment",
    "indexTimeFallback",
  ];

  it("translates every state, reference mode and quality flag", () => {
    // The helpers fall back to the raw machine string, so an uncovered member
    // would show up as an untranslated value here.
    for (const kind of kinds) expect(formatSegmentKind(kind)).not.toBe(kind);
    for (const mode of modes) expect(formatReferenceMode(mode)).not.toBe(mode);
    for (const flag of flags) expect(formatQualityFlag(flag)).not.toBe(flag);
  });
});

describe("analysis defaults", () => {
  it("retain the incumbent plateau and preprocessing defaults", () => {
    expect(DEFAULT_REQUEST.preprocess).toMatchObject({
      filterMode: "clip_smooth",
      medianWindow: 5,
      smoothWindow: 11,
      smoothOrder: 3,
      clippingPercentile: 98,
      manualBaseline: 0,
    });
    expect(DEFAULT_REQUEST.plateau).toMatchObject({
      thresholdLow: 0.1,
      thresholdHigh: 0.5,
      minLength: 5,
      maxLength: 1000,
      deviationThreshold: 20,
    });
  });

  it("defaults new analyses to the dual-platform engine", () => {
    expect(DEFAULT_REQUEST.mode).toBe("droplet");
  });

  it("expose the droplet defaults the backend normalises against", () => {
    expect(DEFAULT_REQUEST.droplet).toMatchObject({
      minSegmentLength: 8,
      maxSegmentLength: 0,
      stabilityWindow: 15,
      edgeTrimFraction: 0.08,
      outlierSigma: 3,
      allowSingleSidedReference: true,
      despikeWindow: 5,
      despikeSigma: 3,
      noiseFactor: 6,
      slopeFactor: 3,
      clusterSeparationFactor: 2.5,
      referenceGapFactor: 3,
    });
  });

  it("keeps preview plot arrays aligned", () => {
    expect(SAMPLE_RESULT.plot.original).toHaveLength(SAMPLE_RESULT.plot.x.length);
    expect(SAMPLE_RESULT.plot.processed).toHaveLength(SAMPLE_RESULT.plot.x.length);
    expect(SAMPLE_RESULT.statistics.featureCount).toBe(SAMPLE_RESULT.plateauFeatures.length);
  });
});

describe("droplet preview payload", () => {
  const result = SAMPLE_DROPLET_RESULT;

  it("stays in droplet mode and carries no plateau features", () => {
    expect(result.mode).toBe("droplet");
    expect(result.plateauFeatures).toHaveLength(0);
    expect(result.statistics.featureCount).toBe(0);
  });

  it("keeps the corrected signal equal to high minus low baseline", () => {
    expect(result.dropletMeasurements.length).toBeGreaterThan(0);
    for (const measurement of result.dropletMeasurements) {
      expect(measurement.correctedSignal).toBeCloseTo(
        measurement.highLevel - measurement.baselineReference,
        12,
      );
    }
  });

  it("only claims interpolation when both neighbours exist", () => {
    for (const measurement of result.dropletMeasurements) {
      if (measurement.referenceMode === "interpolated") {
        expect(measurement.leftLowSegment).not.toBeNull();
        expect(measurement.rightLowSegment).not.toBeNull();
        expect(measurement.qualityFlags).not.toContain("singleSidedReference");
      } else {
        expect(
          measurement.leftLowSegment === null || measurement.rightLowSegment === null,
        ).toBe(true);
        expect(measurement.qualityFlags).toContain("singleSidedReference");
      }
    }
  });

  it("points every measurement at a high segment and low references", () => {
    const bottoms = new Set(
      result.stableSegments
        .filter((segment) => segment.kind === "platform")
        .map((segment) => segment.number),
    );
    for (const measurement of result.dropletMeasurements) {
      expect(bottoms.has(measurement.highSegment)).toBe(true);
      for (const id of [measurement.leftLowSegment, measurement.rightLowSegment]) {
        if (id != null) expect(result.stableSegments.find(s => s.number === id)?.kind).toBe("bottom");
      }
    }
    expect(result.dropletStatistics.dropletCount).toBe(result.dropletMeasurements.length);
    expect(result.dropletStatistics.interpolatedCount).toBe(
      result.dropletMeasurements.filter((m) => m.referenceMode === "interpolated").length,
    );
  });

  it("keeps the preview plot aligned", () => {
    expect(result.plot.original).toHaveLength(result.plot.x.length);
    expect(result.plot.processed).toHaveLength(result.plot.x.length);
  });
});
