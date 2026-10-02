import type {
  AxisId,
  FontSessionMode,
  GlyphId,
  NodeId,
  SelectableId,
  SourceId,
} from "@shift/types";

export type ShiftSessionMode = FontSessionMode;

/** One open Shift window that can be addressed through runtime capabilities. */
export interface ShiftSession {
  windowId: number;
  sessionId: string;
  mode: ShiftSessionMode;
  focused: boolean;
  editorConnected: boolean;
}

/** One external/user-space axis coordinate displayed by the editor. */
export interface AxisCoordinate {
  axisId: AxisId;
  value: number;
}

/** Glyph occurrence currently placed in the editor, when a glyph route is open. */
export interface EditorGlyph {
  glyphId: GlyphId;
  name: string;
  nodeId: NodeId;
  sourceId: SourceId;
}

/** Active editor tool and its published state discriminator. */
export interface EditorTool {
  id: string;
  state: string;
}

/** Renderer-owned facts for one live Shift window. */
export interface EditorView {
  route: string;
  glyph: EditorGlyph | null;
  activeSourceId: SourceId | null;
  editingSourceIds: SourceId[];
  externalLocation: AxisCoordinate[];
  selectionIds: SelectableId[];
  tool: EditorTool | null;
  dragging: boolean;
  editing: boolean;
  applyStatus: "idle" | "queued" | "applying" | null;
}

/** Editor facts paired with the explicit window and font-session target. */
export interface EditorInspection extends EditorView {
  windowId: number;
  sessionId: string;
  mode: ShiftSessionMode;
}

/** Live application capabilities shared by protocol and plugin hosts. */
export interface ShiftCapabilities {
  sessions: {
    list(): Promise<ShiftSession[]>;
  };
  editor: {
    inspect(input: { windowId: number }): Promise<EditorInspection>;
  };
}
