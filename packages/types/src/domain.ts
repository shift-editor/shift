import type { Axis, AxisKind, FontMetrics, MetricValue, NamedInstance } from "./bridge";
import type { MetricId } from "./ids";

/** Complete axis definition before the editor assigns its stable identity. */
export type AxisDefinition = Pick<Axis, "tag" | "name" | "role" | "kind" | "labels" | "hidden">;

/** Whether an axis takes a continuous range or a list of discrete values. */
export type AxisKindName = AxisKind["kind"];

/** Complete named-instance definition before the editor assigns its stable identity. */
export type NamedInstanceDefinition = Omit<NamedInstance, "id">;

/** Standard and technical metrics resolved for one authored source. */
export type SourceMetrics = Readonly<
  FontMetrics & {
    metricValues: Readonly<Record<MetricId, MetricValue>>;
    ascender: number;
    descender: number;
    baseline: number;
    capHeight?: number;
    xHeight?: number;
    lineGap?: number;
    italicAngle?: number;
    underlinePosition?: number;
    underlineThickness?: number;
  }
>;
