import { describe, expect, it } from "vitest";
import { REGISTERED_AXIS_PRESETS, nextCustomAxisDefinition } from "./axisPresets";

describe("axis creation presets", () => {
  it("provides practical registered-axis starting ranges", () => {
    expect(
      REGISTERED_AXIS_PRESETS.map(({ tag, minimum, default: defaultValue, maximum }) => [
        tag,
        minimum,
        defaultValue,
        maximum,
      ]),
    ).toEqual([
      ["wght", 100, 400, 900],
      ["wdth", 50, 100, 200],
      ["opsz", 8, 14, 144],
      ["slnt", -20, 0, 20],
      ["ital", 0, 0, 1],
    ]);
  });

  it("allocates a distinct custom name and private tag", () => {
    const first = nextCustomAxisDefinition([]);
    const second = nextCustomAxisDefinition([first]);

    expect(first).toMatchObject({ name: "Custom Axis", tag: "AX01" });
    expect(second).toMatchObject({ name: "Custom Axis 2", tag: "AX02" });
  });
});
