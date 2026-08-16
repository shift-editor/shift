import { describe, expect, it } from "vitest";
import { AngleSnap } from "./AngleSnap";

const degrees = (value: number): number => (value * Math.PI) / 180;

describe("angle snapping keeps interaction direction stable", () => {
  it("quantizes to the nearest configured increment", () => {
    const snap = AngleSnap.everyDegrees(15);

    expect(snap.apply(degrees(44))).toBeCloseTo(degrees(45));
  });

  it("sticks to the previous angle inside the hysteresis threshold", () => {
    const snap = AngleSnap.everyDegrees(45);

    expect(snap.apply(degrees(2))).toBeCloseTo(0);
    expect(snap.apply(degrees(17))).toBeCloseTo(0);
    expect(snap.apply(degrees(24))).toBeCloseTo(degrees(45));
  });

  it("resets hysteresis while its condition is inactive", () => {
    let enabled = true;
    const snap = AngleSnap.everyDegrees(45, { when: () => enabled });

    expect(snap.apply(degrees(2))).toBeCloseTo(0);
    enabled = false;
    expect(snap.apply(degrees(44))).toBeNull();
    enabled = true;
    expect(snap.apply(degrees(44))).toBeCloseTo(degrees(45));
  });
});
