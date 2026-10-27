import { describe, expect, it } from "vitest";
import { asNamedInstanceId, asSourceId } from "@shift/types";
import { OutlineTargets } from "./OutlineTargets";

const bold = asSourceId("source-bold");
const light = asSourceId("source-light");
const condensed = asNamedInstanceId("instance-condensed");

describe("OutlineTargets", () => {
  it("keeps the first of each repeated target, in order", () => {
    const targets = OutlineTargets.sources([bold, light, bold]);

    expect(targets.all).toEqual([
      { kind: "source", sourceId: bold },
      { kind: "source", sourceId: light },
    ]);
    expect(targets.size).toBe(2);
  });

  it("answers whether a source or instance is shown, without confusing the two", () => {
    const targets = OutlineTargets.sources([bold]).concat(OutlineTargets.instances([condensed]));

    expect(targets.hasSource(bold)).toBe(true);
    expect(targets.hasSource(light)).toBe(false);
    expect(targets.hasInstance(condensed)).toBe(true);
    expect(targets.hasInstance(asNamedInstanceId(bold))).toBe(false);
    expect(targets.has({ kind: "instance", instanceId: condensed })).toBe(true);
  });

  it("lists sources and instances separately, sources then instances when concatenated", () => {
    const targets = OutlineTargets.sources([light, bold]).concat(
      OutlineTargets.instances([condensed]),
    );

    expect(targets.sources()).toEqual([light, bold]);
    expect(targets.instances()).toEqual([condensed]);
    expect([...targets].map(OutlineTargets.key)).toEqual([
      `source:${light}`,
      `source:${bold}`,
      `instance:${condensed}`,
    ]);
  });
});
