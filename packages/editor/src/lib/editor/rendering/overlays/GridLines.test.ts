import { describe, expect, it } from "vitest";
import {
  FULL_GRID_LINE_GAP_PX,
  MIN_GRID_LINE_GAP_PX,
  gridAxisLines,
  gridLineOpacity,
} from "./GridLines";

describe("grid lines along one axis", () => {
  it("draws grid lines on multiples of the spacing, counted from the origin", () => {
    expect(gridAxisLines(-150, 250, 100, 1, 1)).toEqual({ major: [-100, 0, 100, 200], minor: [] });
  });

  it("draws subdivision lines between grid lines", () => {
    expect(gridAxisLines(0, 200, 100, 2, 1)).toEqual({ major: [0, 100, 200], minor: [50, 150] });
  });

  it("leaves out subdivision lines that would sit too close together on screen", () => {
    const pxPerUnit = (MIN_GRID_LINE_GAP_PX - 1) / 50;

    expect(gridAxisLines(0, 200, 100, 2, pxPerUnit)).toEqual({ major: [0, 100, 200], minor: [] });
  });

  it("draws nothing when even the grid lines would sit too close together", () => {
    const pxPerUnit = (MIN_GRID_LINE_GAP_PX - 1) / 100;

    expect(gridAxisLines(0, 1000, 100, 1, pxPerUnit)).toEqual({ major: [], minor: [] });
  });
});

describe("grid line fade as the view zooms out", () => {
  it("draws lines at full strength once they sit far enough apart", () => {
    expect(gridLineOpacity(FULL_GRID_LINE_GAP_PX)).toBe(1);
    expect(gridLineOpacity(FULL_GRID_LINE_GAP_PX * 4)).toBe(1);
  });

  it("fades lines out as they close in on the minimum gap", () => {
    const halfway = (MIN_GRID_LINE_GAP_PX + FULL_GRID_LINE_GAP_PX) / 2;

    expect(gridLineOpacity(halfway)).toBeCloseTo(0.5);
    expect(gridLineOpacity(MIN_GRID_LINE_GAP_PX)).toBe(0);
  });
});
