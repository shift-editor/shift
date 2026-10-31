import { describe, expect, it } from "vitest";
import { asAxisId, asSourceId, type Axis } from "@shift/types";
import { createMemoryFontSession } from "../../createMemoryFontSession";
import type { SystemClipboard } from "../clipboard";

class MemoryClipboard implements SystemClipboard {
  writeText(): Promise<void> {
    return Promise.resolve();
  }

  readText(): Promise<string> {
    return Promise.resolve("");
  }
}

describe("Font axes", () => {
  it("lists only the axes users set directly as external axes", () => {
    const weight = weightAxis();
    const opticalSize: Axis = {
      ...weightAxis(),
      id: asAxisId("axis_opsz"),
      tag: "opsz",
      name: "Optical",
      role: "internal",
    };
    const { font, dispose } = createMemoryFontSession({
      clipboard: new MemoryClipboard(),
      source: {
        font: {
          metadata: { familyName: "Axes" },
          metrics: { unitsPerEm: 1000 },
          metricDefinitions: [],
          kerning: { groups: [], sources: [] },
          glyphs: [],
          sources: [
            {
              id: asSourceId("source_regular"),
              name: "Regular",
              location: { values: {} },
              metricValues: [],
            },
          ],
          axes: [weight, opticalSize],
          axisMappings: [],
          axisMappingBases: [],
          namedInstances: [],
        },
        records: [],
        read: () => Promise.resolve([]),
        glyphPreviews: () => Promise.resolve([]),
      },
    });

    expect(font.getAxes()).toHaveLength(2);
    expect(font.externalAxesCell.peek().map(({ id }) => id)).toEqual([weight.id]);
    dispose();
  });
});

function weightAxis(): Axis {
  return {
    id: asAxisId("axis_wght"),
    tag: "wght",
    name: "Weight",
    role: "external",
    axisType: "continuous",
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [],
    hidden: false,
  };
}
