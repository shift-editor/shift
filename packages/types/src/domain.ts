import type {
  Axis,
  AxisKind,
  FontMetrics,
  GlyphLayerRecord,
  MetricValue,
  NamedInstance,
} from "./bridge";
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

/**
 * Where a glyph's drawing sits off the font's sources: the source its
 * coordinates are laid over (none: every axis they don't name at its
 * default), and its coordinates on font axes and the glyph's own, each in
 * its axis's units. A drawing's record carries both.
 */
export type LayerPlacement = {
  readonly baseSourceId: NonNullable<GlyphLayerRecord["baseSourceId"]> | null;
  readonly coordinates: NonNullable<GlyphLayerRecord["coordinates"]>;
};
