import type { Axis, FontMetrics, NamedInstance } from "./bridge";

/** Complete axis definition before the editor assigns its stable identity. */
export type AxisDefinition = Pick<
  Axis,
  | "tag"
  | "name"
  | "role"
  | "axisType"
  | "minimum"
  | "default"
  | "maximum"
  | "values"
  | "labels"
  | "hidden"
>;

/** Complete named-instance definition before the editor assigns its stable identity. */
export type NamedInstanceDefinition = Omit<NamedInstance, "id">;

/** Standard and technical metrics resolved for one authored source. */
export type SourceMetrics = Readonly<
  FontMetrics & {
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
