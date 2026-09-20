import type { AxisId, NamedInstanceId, SourceId } from "@shift/types";

declare const axisLocationSpace: unique symbol;

type AxisLocation<Space extends "external" | "design"> = ReadonlyMap<AxisId, number> & {
  readonly [axisLocationSpace]: Space;
};

/** User-space coordinates used by controls, named instances, and catalog requests. */
export type ExternalAxisLocation = AxisLocation<"external">;

/** Internal coordinates used by authored sources, interpolation, and exact-source matching. */
export type DesignAxisLocation = AxisLocation<"design">;

/** Identifies the source-creation constraint and control associated with a validation failure. */
export type SourceCreationIssue =
  | { kind: "name"; message: string }
  | { kind: "axis"; axisId: AxisId; message: string }
  | { kind: "location"; sourceId: SourceId; message: string };

/** Identifies the named-instance constraint and control associated with a validation failure. */
export type InstanceCreationIssue =
  | { kind: "name"; message: string }
  | { kind: "axis"; axisId: AxisId; message: string }
  | { kind: "location"; instanceId: NamedInstanceId; message: string };
