import { describe, expect, it } from "vitest";
import { AMPLITUDE_BOUNDARIES, clampRange, moveAmplitudeBoundary, nearestIndex, xBounds } from "./chart";

describe("stable data-coordinate viewport", () => {
  it("keeps the same range when smoothing changes envelope count", () => {
    const zoom: [number, number] = [0.4, 0.401];
    expect(xBounds([0, 50, 1000], zoom)).toEqual(xBounds([0, 99, 400, 401, 1000], zoom));
    expect(xBounds([0, 1000], zoom)).toEqual([400, 401]);
  });
  it("zooms into an individual peak in 500k points", () => {
    expect(clampRange(0.5, 0.5001)[1] - 0.5).toBeCloseTo(0.0001);
  });
  it("clamps pan and resolves the nearest endpoint correctly", () => {
    expect(clampRange(-0.1, 0.1)).toEqual([0, 0.2]);
    expect(nearestIndex([0, 10, 100], 12)).toBe(1);
    expect(nearestIndex([0], 2)).toBe(0);
  });
});

describe("amplitude boundary movement", () => {
  it("moves only the selected limit and keeps disjoint bands at every crossing", () => {
    for (const bands of [
      { lowMin: -0.04, lowMax: -0.03, highMin: -0.02, highMax: 0.03 },
      { lowMin: 0, lowMax: 1e-12, highMin: 2e-12, highMax: 1 },
      { lowMin: -4e-14, lowMax: -3e-14, highMin: -2e-14, highMax: 3e-14 },
    ]) {
      for (const [key] of AMPLITUDE_BOUNDARIES) {
        for (const value of [-100, 100]) {
          const next = moveAmplitudeBoundary(bands, key, value);
          expect(next.lowMin).toBeLessThan(next.lowMax);
          expect(next.lowMax).toBeLessThan(next.highMin);
          expect(next.highMin).toBeLessThan(next.highMax);
          for (const [other] of AMPLITUDE_BOUNDARIES) if (other !== key) expect(next[other]).toBe(bands[other]);
        }
      }
    }
    const bands = { lowMin: -0.04, lowMax: -0.03, highMin: -0.02, highMax: 0.03 };
    expect(moveAmplitudeBoundary(bands, "highMax", 0.025).highMax).toBe(0.025);
    expect(bands.highMax).toBe(0.03);
  });
});
