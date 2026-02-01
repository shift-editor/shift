import type { PointId, GlyphSnapshot } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "./indicator";

export type SelectionMode = "preview" | "committed";

export interface RenderState {
  glyph: GlyphSnapshot | null;
  selectedPointIds: ReadonlySet<PointId>;
  selectedSegmentIds: ReadonlySet<SegmentId>;
  hoveredPointId: PointId | null;
  hoveredSegmentId: SegmentIndicator | null;
  selectionMode: SelectionMode;
  previewMode: boolean;
}

export interface StaticRenderState {
  glyph: GlyphSnapshot | null;
  selectedPointIds: ReadonlySet<PointId>;
  selectedSegmentIds: ReadonlySet<SegmentId>;
  selectionMode: SelectionMode;
  previewMode: boolean;
  handlesVisible: boolean;
  hoveredPointId: PointId | null;
  hoveredSegmentId: SegmentIndicator | null;
}

export interface OverlayRenderState {
  glyph: GlyphSnapshot | null;
  selectedSegmentIds: ReadonlySet<SegmentId>;
  hoveredPointId: PointId | null;
  hoveredSegmentId: SegmentIndicator | null;
}

export interface InteractiveRenderState {
  activeToolState: { type: string };
}

export type CursorType =
  | { type: "default" }
  | { type: "pointer" }
  | { type: "grab" }
  | { type: "grabbing" }
  | { type: "move" }
  | { type: "copy" }
  | { type: "crosshair" }
  | { type: "pen" }
  | { type: "pen-add" }
  | { type: "pen-end" }
  | { type: "not-allowed" }
  | { type: "ew-resize" }
  | { type: "ns-resize" }
  | { type: "nwse-resize" }
  | { type: "nesw-resize" }
  | { type: "rotate-tl" }
  | { type: "rotate-tr" }
  | { type: "rotate-bl" }
  | { type: "rotate-br" };

export type VisualState = "idle" | "hovered" | "selected";

export interface ToolRegistryItem {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
}

export interface TemporaryToolOptions {
  onActivate?: () => void;
  onReturn?: () => void;
}

export interface ToolSwitchHandler {
  requestTemporary: (toolId: string, options?: TemporaryToolOptions) => void;
  returnFromTemporary: () => void;
}
