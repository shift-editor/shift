import type { GlyphId, NodeId, RunId, SelectableId, ShiftId } from "@shift/types";
import type { EditingId } from "./editing";
import type { SelectionId } from "./object";
import type { TextEditingId, TextEditingRecord } from "./text";

export type ShiftRecordId = ShiftId | SelectionId | EditingId | TextEditingId | RunId;

/** Something a scene node depends on: a node, a text run, or a glyph in the font. */
export type NodeReference = ShiftRecordId | GlyphId;

export interface ShiftRecord<
  Type extends string = string,
  Id extends ShiftRecordId = ShiftRecordId,
> {
  readonly id: Id;
  readonly type: Type;
}

export type SelectionRecord = ShiftRecord<"selection", SelectionId> & {
  readonly scope: "session";
  readonly ids: readonly SelectableId[];
};

export type EditingRecord = ShiftRecord<"editing", EditingId> & {
  readonly scope: "session";
  readonly nodeIds: readonly NodeId[];
};

/**
 * A record of the editor's session state: selection, editing focus and the
 * text caret. The document's content (the scene, runs included) lives in the
 * document, not here.
 */
export type ShiftEditorRecord = SelectionRecord | EditingRecord | TextEditingRecord;
