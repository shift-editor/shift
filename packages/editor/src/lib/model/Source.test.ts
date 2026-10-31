import { describe, expect, it } from "vitest";
import { asAxisId, asMetricId, asSourceId, type Source as SourceRecord } from "@shift/types";
import { Axis } from "./Axis";
import { Source } from "./Source";

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
const ascender = asMetricId("metric_ascender");

const bold: SourceRecord = {
  id: asSourceId("source_bold"),
  name: "Bold",
  location: { values: { [weight.id]: 700 } },
  metricValues: { [ascender]: { position: 750, overshoot: 12 } },
  lineGap: 200,
  role: "master",
};

describe("a source builds its edited records", () => {
  it("reads a missing coordinate as the axis default and an unset metric as zero", () => {
    const source = new Source(bold);

    expect([source.locationValue(weight), source.locationValue(width)]).toEqual([700, 400]);
    expect(source.metricValue(asMetricId("metric_xheight"))).toEqual({ position: 0, overshoot: 0 });
    expect(source).toMatchObject({ lineGap: 200, italicAngle: null });
  });

  it("renames and moves the source, keeping its other coordinates", () => {
    const renamed = new Source(new Source(bold).withName("Heavy"));

    expect(renamed.withLocationValue(width.id, 75)).toEqual({
      ...bold,
      name: "Heavy",
      location: { values: { [weight.id]: 700, [width.id]: 75 } },
    });
  });

  it("sets one metric row, adding a row it lacked", () => {
    const xHeight = asMetricId("metric_xheight");

    expect(new Source(bold).withMetricValue(xHeight, { position: 500, overshoot: 10 })).toEqual({
      ...bold,
      metricValues: {
        [ascender]: { position: 750, overshoot: 12 },
        [xHeight]: { position: 500, overshoot: 10 },
      },
    });
  });

  it("sets and clears its technical values", () => {
    const angled = new Source(new Source(bold).withItalicAngle(-12));
    const underlined = new Source(
      new Source(angled.withUnderlinePosition(-100)).withUnderlineThickness(50),
    );

    expect(new Source(underlined.withLineGap(undefined))).toMatchObject({
      italicAngle: -12,
      lineGap: null,
      underlinePosition: -100,
      underlineThickness: 50,
    });
  });
});
