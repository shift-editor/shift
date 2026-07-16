import { describe, expect, it } from "vitest";
import type { Axis, AxisId, NamedInstance } from "@shift/types";
import { mintAxisId, mintNamedInstanceId } from "@shift/types";
import { instanceCreationIssue, instanceLocation, suggestedInstanceName } from "./instanceCreation";

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
    labels: [],
    hidden: false,
  };
}

function instance(name: string, values: Record<AxisId, number>): NamedInstance {
  return {
    id: mintNamedInstanceId(),
    name,
    location: { values },
  };
}

describe("named-instance creation", () => {
  it("parses a complete finite external location", () => {
    const axis = weightAxis();

    expect(instanceLocation([axis], { [axis.id]: "700" })).toEqual({
      values: { [axis.id]: 700 },
    });
    expect(instanceLocation([axis], { [axis.id]: "" })).toBeNull();
  });

  it("rejects duplicate product locations", () => {
    const axis = weightAxis();
    const regular = instance("Regular", { [axis.id]: 400 } as Record<AxisId, number>);

    expect(instanceCreationIssue("Book", { [axis.id]: "400" }, [axis], [regular])).toEqual({
      kind: "location",
      instanceId: regular.id,
      message: "Regular already exists at this location",
    });
  });

  it("targets out-of-range axis values", () => {
    const axis = weightAxis();

    expect(instanceCreationIssue("Heavy", { [axis.id]: "950" }, [axis], [])).toEqual({
      kind: "axis",
      axisId: axis.id,
      message: "Weight must be at most 900",
    });
  });

  it("suggests the first unused numbered name", () => {
    const first = instance("Instance 1", {} as Record<AxisId, number>);
    const third = instance("Instance 3", {} as Record<AxisId, number>);

    expect(suggestedInstanceName([first, third])).toBe("Instance 2");
  });
});
