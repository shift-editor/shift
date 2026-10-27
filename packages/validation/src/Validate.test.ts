import { describe, it, expect } from "vitest";
import { Validate } from "./Validate";
import type { PointLike } from "./types";

const onCurve = (): PointLike => ({ pointType: "onCurve" });
const offCurve = (): PointLike => ({ pointType: "offCurve" });
const qCurve = (): PointLike => ({ pointType: "qCurve" });

describe("Validate", () => {
  it("treats onCurve and qCurve endpoints as on-curve", () => {
    expect(Validate.isOnCurve(onCurve())).toBe(true);
    expect(Validate.isOnCurve(qCurve())).toBe(true);
    expect(Validate.isOnCurve(offCurve())).toBe(false);
  });

  it("isOffCurve returns true only for offCurve points", () => {
    expect(Validate.isOffCurve(offCurve())).toBe(true);
    expect(Validate.isOffCurve(onCurve())).toBe(false);
    expect(Validate.isOffCurve(qCurve())).toBe(false);
  });

  it("finds an anchor only among on-curve points", () => {
    expect(Validate.hasValidAnchor([])).toBe(false);
    expect(Validate.hasValidAnchor([offCurve(), offCurve()])).toBe(false);
    expect(Validate.hasValidAnchor([offCurve(), qCurve()])).toBe(true);
  });
});
