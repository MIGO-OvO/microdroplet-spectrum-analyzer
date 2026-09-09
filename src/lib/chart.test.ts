import { describe, expect, it } from "vitest";
import { clampRange, nearestIndex, xBounds } from "./chart";

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
