import { describe, expect, it } from "vitest";
import {
  asAxisId,
  asNamedInstanceId,
  type NamedInstance as NamedInstanceRecord,
} from "@shift/types";
import { Axis } from "./Axis";
import { NamedInstance } from "./NamedInstance";

const weight = new Axis({
  id: asAxisId("axis_wght"),
  tag: "wght",
  name: "Weight",
  role: "external",
  kind: { kind: "continuous", minimum: 100, default: 400, maximum: 900 },
  labels: [],
  hidden: false,
});
const width = new Axis({ ...weight.record, id: asAxisId("axis_wdth"), tag: "wdth" });

const display: NamedInstanceRecord = {
  id: asNamedInstanceId("instance_display"),
  name: "Display",
  location: { values: { [weight.id]: 800 } },
  postscriptName: "Font-Display",
};

describe("a named instance builds its edited records", () => {
  it("reads a missing coordinate as the axis default", () => {
    const instance = new NamedInstance(display);

    expect([instance.locationValue(weight), instance.locationValue(width)]).toEqual([800, 400]);
  });

  it("renames and moves the instance, keeping its other coordinates", () => {
    const renamed = new NamedInstance(new NamedInstance(display).withName("Poster"));

    expect(renamed.withLocationValue(weight.id, 900)).toEqual({
      ...display,
      name: "Poster",
      location: { values: { [weight.id]: 900 } },
    });
  });
});
