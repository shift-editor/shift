import type { Tool } from "./tool";
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

export type CursorType =
  | { type: "default" }
  | { type: "pointer" }
  | { type: "grab" }
  | { type: "grabbing" }
  | { type: "move" }
  | { type: "crosshair" }
  | { type: "pen" }
  | { type: "pen-add" }
  | { type: "pen-end" }
  | { type: "not-allowed" }
  | { type: "ew-resize" }
  | { type: "ns-resize" }
  | { type: "nwse-resize" }
  | { type: "nesw-resize" };

export type VisualState = "idle" | "hovered" | "selected";

export interface ToolRegistryItem {
  tool: Tool;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
}
