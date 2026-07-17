import { describe, expect, it } from "vitest";
import { REGISTERED_OPENTYPE_AXES, isRegisteredOpenTypeAxisTag } from "./registeredAxes";

describe("OpenType registered axis classification", () => {
  it("recognizes the specification registry without treating custom tags as registered", () => {
    expect(REGISTERED_OPENTYPE_AXES.map((axis) => axis.tag)).toEqual([
      "wght",
      "wdth",
      "opsz",
      "slnt",
      "ital",
    ]);
    expect(isRegisteredOpenTypeAxisTag("wght")).toBe(true);
    expect(isRegisteredOpenTypeAxisTag("GRAD")).toBe(false);
  });
});
