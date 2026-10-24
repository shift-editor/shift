import { describe, expect, it } from "vitest";
import { asAxisId, asNamedInstanceId, type Axis, type NamedInstance } from "@shift/types";
import { instanceCreationIssue, instanceLocation } from "./instanceCreation";
import { DraftIssues, LocationDraft, type DraftIssue } from "./locationDraft";

const weight: Axis = {
  id: asAxisId("axis_weight"),
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

const regular: NamedInstance = {
  id: asNamedInstanceId("instance-regular"),
  name: "Regular",
  location: { values: { [weight.id]: 400 } },
};

describe("location draft", () => {
  it("trims the name and reads typed coordinates, NaN for empty or non-numeric fields", () => {
    const draft = new LocationDraft({ name: "  Bold ", location: { [weight.id]: " 700 " } });

    expect(draft.name).toBe("Bold");
    expect(draft.coordinate(weight)).toBe(700);
    expect(new LocationDraft({ name: "", location: {} }).coordinate(weight)).toBeNaN();
    expect(
      new LocationDraft({ name: "", location: { [weight.id]: "x" } }).invalidAxis([weight]),
    ).toBe(weight);
  });

  it("reports a missing or taken name with the noun's article", () => {
    expect(new LocationDraft({ name: " ", location: {} }).nameIssue("an instance", [])).toEqual({
      kind: "name",
      message: "Enter an instance name",
    });
    expect(
      new LocationDraft({ name: "Regular", location: {} }).nameIssue("an instance", [regular]),
    ).toEqual({ kind: "name", message: "An instance named “Regular” already exists" });
    expect(new LocationDraft({ name: "Bold", location: {} }).nameIssue("a source", [])).toBeNull();
  });

  it("validates instances in order: name, axis range, then an existing location", () => {
    expect(instanceCreationIssue("Bold", { [weight.id]: "950" }, [weight], [])).toEqual({
      kind: "axis",
      axisId: weight.id,
      message: "Weight must be at most 900",
    });
    expect(instanceCreationIssue("Book", { [weight.id]: "400" }, [weight], [regular])).toEqual({
      kind: "location",
      instanceId: regular.id,
      message: "Regular already exists at this location",
    });
    expect(instanceLocation([weight], { [weight.id]: "700" })).toEqual({
      values: { [weight.id]: 700 },
    });
    expect(instanceLocation([weight], { [weight.id]: "" })).toBeNull();
  });
});

describe("draft issues", () => {
  const axisIssue: DraftIssue = { kind: "axis", axisId: weight.id, message: "Enter a number" };

  it("answers each field with its own issue, and nothing while hidden", () => {
    const issues = new DraftIssues<DraftIssue>(axisIssue);

    expect(issues.of("axis")).toBe(axisIssue);
    expect(issues.of("name")).toBeNull();
    expect(issues.forAxis(weight.id)).toBe(axisIssue);
    expect(issues.forAxis(asAxisId("axis_width"))).toBeNull();
    expect(new DraftIssues<DraftIssue>(null).of("axis")).toBeNull();
  });
});
