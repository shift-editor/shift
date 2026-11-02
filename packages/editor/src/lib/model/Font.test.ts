import { describe, expect, it } from "vitest";
import { asAxisId, type Axis } from "@shift/types";
import { startMemorySession } from "../../testing/emptyMemorySession";

describe("Font axes", () => {
  it("lists only the axes users set directly as external axes", async () => {
    const weight = weightAxis();
    const opticalSize: Axis = {
      ...weightAxis(),
      id: asAxisId("axis_opsz"),
      tag: "opsz",
      name: "Optical",
      role: "internal",
    };
    const { font, dispose } = await startMemorySession({
      build: () =>
        [weight, opticalSize].map((axis) => ({ kind: "createAxis", createAxis: { axis } })),
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
    kind: { kind: "continuous", minimum: 100, default: 400, maximum: 900 },
    labels: [],
    hidden: false,
  };
}
