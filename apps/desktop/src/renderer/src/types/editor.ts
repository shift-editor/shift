import type { PointId, Glyph, Point2D } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "./indicator";
import type { BoundingBoxHitResult } from "./boundingBox";
import type { SnapIndicator } from "@/lib/editor/snapping/types";
import type { DebugOverlays } from "./electron";
import type { ToolName } from "@/lib/tools/core";

export type SelectionMode = "preview" | "committed";

export interface RenderState {
  glyph: Glyph | null;
  drawOffset: Point2D;
  selectedPointIds: ReadonlySet<PointId>;
  selectedSegmentIds: ReadonlySet<SegmentId>;
  hoveredPointId: PointId | null;
  hoveredSegmentId: SegmentIndicator | null;
  selectionMode: SelectionMode;
  previewMode: boolean;
}

export interface StaticRenderState {
  glyph: Glyph | null;
  drawOffset: Point2D;
  selectedPointIds: ReadonlySet<PointId>;
  selectedSegmentIds: ReadonlySet<SegmentId>;
  selectionMode: SelectionMode;
  previewMode: boolean;
  handlesVisible: boolean;
  hoveredPointId: PointId | null;
  hoveredSegmentId: SegmentIndicator | null;
  hoveredBoundingBoxHandle: BoundingBoxHitResult;
  debugOverlays: DebugOverlays;
}

export interface OverlayRenderState {
  glyph: Glyph | null;
  drawOffset: Point2D;
  selectedSegmentIds: ReadonlySet<SegmentId>;
  hoveredPointId: PointId | null;
  hoveredSegmentId: SegmentIndicator | null;
  snapIndicator: SnapIndicator | null;
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
  | { type: "rotate-br" }
  | { type: "text" };

export type VisualState = "idle" | "hovered" | "selected";

export interface ToolRegistryItem {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
  shortcut?: string;
}

export interface TemporaryToolOptions {
  onActivate?: () => void;
  onReturn?: () => void;
}

export interface SnapPreferences {
  enabled: boolean;
  angle: boolean;
  metrics: boolean;
  pointToPoint: boolean;
  angleIncrementDeg: number;
  pointRadiusPx: number;
}

export interface ToolSwitchHandler {
  requestTemporary: (toolId: ToolName, options?: TemporaryToolOptions) => void;
  returnFromTemporary: () => void;
}
