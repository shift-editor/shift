import type { NodeId } from "@shift/types";
import type { GlyphNode } from "./node";
import type { SelectableId, SelectionId, ShiftId } from "./object";

export type ShiftRecordId = ShiftId | SelectionId;

export interface ShiftRecord<
  Type extends string = string,
  Id extends ShiftRecordId = ShiftRecordId,
> {
  readonly id: Id;
  readonly type: Type;
}

export type GlyphNodeRecord = GlyphNode & ShiftRecord<"node", NodeId>;

export type ShiftNodeRecord = GlyphNodeRecord;

export type SelectionRecord = ShiftRecord<"selection", SelectionId> & {
  readonly scope: "session";
  readonly ids: readonly SelectableId[];
};

export type ShiftEditorRecord = ShiftNodeRecord | SelectionRecord;
