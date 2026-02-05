import type { FontMetrics, Glyph, Point2D, PointId } from "@shift/types";

export interface SnapIndicator {
  lines: Array<{
    from: Point2D;
    to: Point2D;
  }>;
  markers?: Point2D[];
}

export interface SnapContext {
  previousSnappedAngle: number | null;
}

export type SnappableInclude = "points" | "metrics";

export interface SnappableQuery {
  include: readonly SnappableInclude[];
  excludedPointIds?: readonly PointId[];
}

export type SnappableObject =
  | { kind: "pointTarget"; id: PointId; point: Point2D }
  | { kind: "metricGuide"; y: number; label: string };

export interface SnapPreferencesSnapshot {
  enabled: boolean;
  angle: boolean;
  metrics: boolean;
  pointToPoint: boolean;
  pointRadiusPx: number;
  angleIncrementDeg: number;
}

export interface PointSnapStepArgs {
  point: Point2D;
  reference: Point2D;
  modifiers: { shiftKey: boolean };
  context: SnapContext;
  sources: readonly SnappableObject[];
  preferences: SnapPreferencesSnapshot;
  radius: number;
  increment: number;
}

export interface PointStepResult {
  snappedPoint: Point2D;
  source: "pointToPoint" | "metrics" | "angle";
  indicator: SnapIndicator | null;
}

export interface PointSnapStep {
  id: string;
  apply(args: PointSnapStepArgs): PointStepResult | null;
}

export interface RotateSnapStepArgs {
  delta: number;
  modifiers: { shiftKey: boolean };
  context: SnapContext;
  preferences: SnapPreferencesSnapshot;
  increment: number;
}

export interface RotateStepResult {
  snappedDelta: number;
  source: "angle";
  indicator: SnapIndicator | null;
}

export interface RotateSnapStep {
  id: string;
  apply(args: RotateSnapStepArgs): RotateStepResult | null;
}

export interface PointSnapResult {
  point: Point2D;
  indicator: SnapIndicator | null;
  source: "pointToPoint" | "metrics" | "angle" | null;
}

export interface RotateSnapResult {
  delta: number;
  source: "angle" | null;
}

export interface DragSnapSessionConfig {
  anchorPointId: PointId;
  dragStart: Point2D;
  excludedPointIds?: readonly PointId[];
}

export interface DragSnapSession {
  getAnchorPosition(): Point2D;
  snap(point: Point2D, modifiers: { shiftKey: boolean }): PointSnapResult;
  clear(): void;
}

export interface RotateSnapSession {
  snap(delta: number, modifiers: { shiftKey: boolean }): RotateSnapResult;
  clear(): void;
}

export interface EditorSnapManagerDeps {
  getGlyph: () => Glyph | null;
  getMetrics: () => FontMetrics | null;
  getPreferences: () => SnapPreferencesSnapshot;
  screenToUpmDistance: (px: number) => number;
}
