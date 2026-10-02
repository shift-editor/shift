//#region ../types/src/ids.d.ts
/**
 * Branded ID types for type-safe identification of font entities.
 *
 * These types ensure compile-time safety when working with IDs across the
 * TS/Rust boundary. Most ids are prefixed strings (`point_<short-id>`). The
 * renderer MINTS ids for entities it creates (client-minted ids: verbs return
 * identity synchronously; Rust validates and honors them); all other ids come
 * from Rust.
 */
declare const PointIdBrand: unique symbol;
declare const ContourIdBrand: unique symbol;
declare const AnchorIdBrand: unique symbol;
declare const AxisIdBrand: unique symbol;
declare const ComponentIdBrand: unique symbol;
declare const GlyphIdBrand: unique symbol;
declare const NodeIdBrand: unique symbol;
declare const SegmentIdBrand: unique symbol;
declare const SourceIdBrand: unique symbol;
/**
 * A point identifier from Rust.
 * Branded string type - can't be confused with ContourId or plain strings.
 */
type PointId = string & {
  readonly [PointIdBrand]: typeof PointIdBrand;
};
/**
 * A contour identifier from Rust.
 * Branded string type - can't be confused with PointId or plain strings.
 */
type ContourId = string & {
  readonly [ContourIdBrand]: typeof ContourIdBrand;
};
/**
 * An anchor identifier from Rust.
 * Branded string type - can't be confused with PointId/ContourId or plain strings.
 */
type AnchorId = string & {
  readonly [AnchorIdBrand]: typeof AnchorIdBrand;
};
/**
 * An axis identifier from Rust.
 * Branded string type - can't be confused with OpenType axis tags.
 */
type AxisId = string & {
  readonly [AxisIdBrand]: typeof AxisIdBrand;
};
/**
 * A component identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
type ComponentId = string & {
  readonly [ComponentIdBrand]: typeof ComponentIdBrand;
};
/**
 * A glyph identifier from Rust.
 * Branded string type - can't be confused with names or other IDs.
 */
type GlyphId = string & {
  readonly [GlyphIdBrand]: typeof GlyphIdBrand;
};
/**
 * A scene node identifier minted by the renderer.
 *
 * Node ids identify placed editor nodes. They are placement identity only;
 * commands that mutate authored glyph geometry must resolve the glyph layer
 * separately from document glyph identity and designspace location.
 */
type NodeId = string & {
  readonly [NodeIdBrand]: typeof NodeIdBrand;
};
/** Stable identity of one segment derived from its endpoint identities. */
type SegmentId = string & {
  readonly [SegmentIdBrand]: typeof SegmentIdBrand;
};
/**
 * A source identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
type SourceId = string & {
  readonly [SourceIdBrand]: typeof SourceIdBrand;
};
/** Identifies an editor-addressable scene node or glyph object. */
type ShiftId = NodeId | PointId | AnchorId | ContourId | SegmentId | ComponentId;
/** Identifies objects that can be selected by the editor. */
type SelectableId = ShiftId;
//#endregion
//#region ../types/src/workspace.d.ts
/** Immutable product mode for one live font session. */
type FontSessionMode = "preview" | "memory" | "workspace";
//#endregion
//#region src/capabilities.d.ts
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
//#endregion

declare global {
  const shift: ShiftCapabilities;
}
