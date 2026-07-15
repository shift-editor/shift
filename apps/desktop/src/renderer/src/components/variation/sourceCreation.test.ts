import { describe, expect, it } from "vitest";
import type { Axis, AxisId, Source } from "@shift/types";
import { mintAxisId, mintAxisLabelId, mintSourceId } from "@shift/types";
import { axisLocationFromLocation } from "@/lib/variation/location";
import { sourceCreationIssue, sourceLocation, suggestedSourceName } from "./sourceCreation";

function weightAxis(): Axis {
  return {
    id: mintAxisId(),
    tag: "wght",
    name: "Weight",
    role: "external",
    axisType: "continuous",
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [
      {
        id: mintAxisLabelId(),
        name: "Bold",
        value: 700,
        elidable: false,
      },
    ],
    hidden: false,
  };
}

function source(name: string, values: Record<AxisId, number>): Source {
  return {
    id: mintSourceId(),
    name,
    location: { values },
    metricValues: [],
  };
}

describe("source creation", () => {
  it("parses finite axis fields and rejects incomplete numeric input", () => {
    const axis = weightAxis();

    expect(sourceLocation([axis], { [axis.id]: "550" })).toEqual({
      values: { [axis.id]: 550 },
    });
    expect(sourceLocation([axis], { [axis.id]: "not a number" })).toBeNull();
    expect(sourceLocation([axis], { [axis.id]: "" })).toBeNull();
  });

  it("treats omitted coordinates as axis defaults when checking duplicate masters", () => {
    const axis = weightAxis();
    const regular = source("Regular", {} as Record<AxisId, number>);

    expect(sourceCreationIssue("Book", { [axis.id]: "400" }, [axis], [regular])).toEqual({
      kind: "location",
      sourceId: regular.id,
      message: "Regular already exists at this location",
    });
  });

  it("targets the axis whose coordinate is invalid", () => {
    const axis = weightAxis();

    expect(sourceCreationIssue("Book", { [axis.id]: "" }, [axis], [])).toEqual({
      kind: "axis",
      axisId: axis.id,
      message: "Enter a number for Weight",
    });
  });

  it("targets invalid source names independently of location", () => {
    const axis = weightAxis();

    expect(sourceCreationIssue("", { [axis.id]: "400" }, [axis], [])).toEqual({
      kind: "name",
      message: "Enter a source name",
    });
  });

  it("suggests unique names from axis labels", () => {
    const axis = weightAxis();
    const location = { values: { [axis.id]: 700 } as Record<AxisId, number> };
    const bold = source("Bold", { [axis.id]: 800 } as Record<AxisId, number>);

    expect(suggestedSourceName([axis], [], axisLocationFromLocation(location))).toBe("Bold");
    expect(suggestedSourceName([axis], [bold], axisLocationFromLocation(location))).toBe("Bold 2");
  });
});
