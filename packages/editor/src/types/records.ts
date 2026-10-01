import type { NodeId, RunId } from "@shift/types";
import type { EditingId } from "./editing";
import type { GlyphNode, TextRunNode } from "./node";
import type { SelectableId, SelectionId, ShiftId } from "./object";
import type { TextRunRecord } from "./text";

export type ShiftRecordId = ShiftId | SelectionId | EditingId | RunId;

export interface ShiftRecord<
  Type extends string = string,
  Id extends ShiftRecordId = ShiftRecordId,
> {
  readonly id: Id;
  readonly type: Type;
}

export type GlyphNodeRecord = GlyphNode & ShiftRecord<"node", NodeId>;

export type TextRunNodeRecord = TextRunNode & ShiftRecord<"node", NodeId>;

export type ShiftNodeRecord = GlyphNodeRecord | TextRunNodeRecord;

export type SelectionRecord = ShiftRecord<"selection", SelectionId> & {
  readonly scope: "session";
  readonly ids: readonly SelectableId[];
};

export type EditingRecord = ShiftRecord<"editing", EditingId> & {
  readonly scope: "session";
  readonly nodeIds: readonly NodeId[];
};

export type ShiftEditorRecord = ShiftNodeRecord | SelectionRecord | EditingRecord | TextRunRecord;
