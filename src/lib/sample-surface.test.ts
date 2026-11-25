import { describe, expect, it } from "vitest";
import { DEFAULT_REQUEST, type SamplingRecord } from "../types";
import { buildMapLayers } from "./sample-surface";
import { readCoordinateDraft } from "./sampling";

function record(id: number, latitude: number, longitude: number, value: number): SamplingRecord {
  const sampleId = String(id);
  return {
    id, name: sampleId, analyte: "亚硝酸盐", savedAt: "2026-11-25T03:00:00Z",
    concentration: { value, unit: "mg/L", curve: null, notices: [] },
    source: { path: "raw.csv", fileName: "raw.csv", signalColumn: 3, timeColumn: 1, metadata: {
      key: sampleId, sampleId, missionId: "mission", sampleName: null, startedAt: null,
      latitude, longitude, positionSource: "gps", simulated: false, outcome: "succeeded", invalidPosition: false, rowCount: 200,
    } },
    response: 0.25, detectionCount: 4, pointCount: 200, parameters: DEFAULT_REQUEST, warnings: [],
  };
}

describe("sample concentration layers", () => {
  it("uses manual positions for missing or invalid file coordinates and keeps simulation status", () => {
    const manualCoordinates = { latitude: 25.01, longitude: 110 };
    const manual = record(3, 25, 110.02, 3);
    manual.manualCoordinates = manualCoordinates;
    manual.source.metadata!.invalidPosition = true;
    const records = [record(1, 25, 110, 0), record(2, 25, 110.01, 5), manual];
    const layers = buildMapLayers(records);
    expect(layers.points[2].position).toEqual({ lat: 25.01, lng: 110 });
    expect(layers.cells.length).toBeGreaterThan(0);
    manual.source.metadata!.simulated = true;
    expect(buildMapLayers(records).cells).toHaveLength(0);
    manual.source.metadata = null;
    expect(buildMapLayers(records).points[2].position).toEqual({ lat: 25.01, lng: 110 });
  });

  it("draws an IDW grid and isolines within the same triangular coverage", () => {
    const layers = buildMapLayers([record(1, 25, 110, 0), record(2, 25, 110.01, 5), record(3, 25.01, 110, 3)]);
    expect(layers.points).toHaveLength(3);
    expect(layers.range).toEqual({ min: 0, max: 5, unit: "mg/L" });
    expect(layers.cells.length).toBeGreaterThan(0);
    expect(layers.cells.length).toBeLessThan(48 * 48 / 2);
    expect(layers.contours.some(contour => contour.segments.length > 0)).toBe(true);
    expect(layers.cells.every(cell => cell.northwest.lat - 25 + cell.southeast.lng - 110 <= 0.010000001)).toBe(true);
  });

  it("keeps real point positions visible while blocking a mixed or one-dimensional surface", () => {
    const a = record(1, 25, 110, 0);
    const b = record(2, 25, 110.01, 5);
    const c = record(3, 25, 110.02, 3);
    expect(buildMapLayers([a, b, c]).cells).toHaveLength(0);
    const mixed = buildMapLayers([a, b, { ...c, analyte: "硝酸盐" }]);
    expect(mixed.points).toHaveLength(3);
    expect(mixed.range).toBeNull();
    expect(mixed.contours).toHaveLength(0);
    const simulated = record(4, 25.01, 110, 3);
    simulated.source.metadata!.simulated = true;
    expect(buildMapLayers([a, b, simulated]).cells).toHaveLength(0);
  });
});

it("reads a complete manual coordinate pair and rejects partial, malformed or out-of-range input", () => {
  expect(readCoordinateDraft({ latitude: "", longitude: " " })).toBeNull();
  expect(readCoordinateDraft({ latitude: "0", longitude: "-180" })).toEqual({ latitude: 0, longitude: -180 });
  for (const input of ["", "0x10", "91", "NaN"]) {
    expect(typeof readCoordinateDraft({ latitude: input, longitude: "110.1" })).toBe("string");
  }
  expect(typeof readCoordinateDraft({ latitude: "25", longitude: "180.1" })).toBe("string");
});
