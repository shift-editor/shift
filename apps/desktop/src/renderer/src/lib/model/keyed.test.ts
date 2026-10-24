import { describe, expect, it } from "vitest";
import { removeBy, replaceBy, upsertBy } from "@shift/types";

interface Metric {
  readonly metricId: string;
  readonly position: number;
}

const metrics: readonly Metric[] = [
  { metricId: "ascender", position: 700 },
  { metricId: "descender", position: -200 },
];
const byMetric = (value: Metric) => value.metricId;

describe("keyed list edits", () => {
  it("replaces the value with the same key in place, or appends a new one", () => {
    const replaced = upsertBy(metrics, { metricId: "ascender", position: 720 }, byMetric);
    const appended = upsertBy(metrics, { metricId: "xHeight", position: 500 }, byMetric);

    expect(replaced).toEqual([
      { metricId: "ascender", position: 720 },
      { metricId: "descender", position: -200 },
    ]);
    expect(appended.map(byMetric)).toEqual(["ascender", "descender", "xHeight"]);
    expect(metrics[0]?.position).toBe(700);
  });

  it("changes only the values with the key", () => {
    const changed = replaceBy(
      metrics,
      "descender",
      (value) => ({ ...value, position: value.position - 10 }),
      byMetric,
    );

    expect(changed.map(({ position }) => position)).toEqual([700, -210]);
  });

  it("removes the values with the key and keeps the rest in order", () => {
    expect(removeBy(metrics, "ascender", byMetric).map(byMetric)).toEqual(["descender"]);
    expect(removeBy(metrics, "missing", byMetric)).toEqual(metrics);
  });
});
