import type { Bounds } from "@shift/geo";
import type {
  AnchorId,
  Axis,
  AxisId,
  FontMetadata,
  FontMetrics,
  FontSessionMode,
  GlyphId,
  GlyphName,
  GlyphStructure,
  LayerId,
  NamedInstance,
  NodeId,
  PointId,
  PointType,
  SelectableId,
  Source,
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

/** Current font facts from one explicitly targeted live session, including Home. */
export interface FontOverview {
  mode: ShiftSessionMode;
  metadata: FontMetadata;
  metrics: FontMetrics;
  glyphCount: number;
  axes: Axis[];
  /** Global font masters; glyph-specific supplementary sources are advertised on glyphs. */
  sources: Source[];
  namedInstances: NamedInstance[];
}

/** Directory identity; optional structure is for one requested authored source. */
export interface GlyphSummary {
  id: GlyphId;
  name: string;
  unicodes: number[];
  componentBaseGlyphIds: GlyphId[];
  /** Authored layer sources, including glyph-specific non-master sources. */
  sourceIds: SourceId[];
  structure?: GlyphStructure | null;
}

/** Select one glyph by stable ID or exact name, never by both. */
export type GlyphSelector =
  | { glyphId: GlyphId; name?: never }
  | { name: GlyphName; glyphId?: never };

/** One bounded page of glyphs in font directory order. */
export interface GlyphPage {
  items: GlyphSummary[];
  nextCursor: string | null;
}

/** Authored geometry of one glyph in one source, never an interpolated preview. */
export interface LayerView {
  glyphId: GlyphId;
  sourceId: SourceId;
  layerId: LayerId;
  structure: GlyphStructure;
  xAdvance: number;
  bounds: Bounds | null;
  anchors: { id: AnchorId; name: string | null; x: number; y: number }[];
  points: { id: PointId; x: number; y: number; pointType: PointType; smooth: boolean }[];
}

/** Live application capabilities shared by protocol and plugin hosts. */
export interface ShiftCapabilities {
  sessions: {
    list(): Promise<ShiftSession[]>;
  };
  editor: {
    inspect(input: { windowId: number }): Promise<EditorInspection>;
  };
  font: {
    get(input: { windowId: number }): Promise<FontOverview>;
  };
  glyphs: {
    list(input: {
      windowId: number;
      limit?: number;
      cursor?: string;
      sourceId?: SourceId;
    }): Promise<GlyphPage>;
    get(input: { windowId: number } & GlyphSelector): Promise<GlyphSummary>;
  };
  layers: {
    get(input: {
      windowId: number;
      glyphId: GlyphId;
      sourceId: SourceId;
    }): Promise<LayerView | null>;
  };
}
