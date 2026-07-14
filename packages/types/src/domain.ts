import type { Axis, NamedInstance } from "./bridge";

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
