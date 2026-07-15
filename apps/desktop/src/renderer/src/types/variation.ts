import type { AxisId, SourceId } from "@shift/types";

export type AxisLocation = ReadonlyMap<AxisId, number>;

/** Identifies the source-creation constraint and control associated with a validation failure. */
export type SourceCreationIssue =
  | { kind: "name"; message: string }
  | { kind: "axis"; axisId: AxisId; message: string }
  | { kind: "location"; sourceId: SourceId; message: string };
