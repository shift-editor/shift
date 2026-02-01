import { Vec2 } from "@shift/geo";
import type { PointId, Point2D } from "@shift/types";
import { asPointId } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior, SegmentBendMode } from "../types";
import type { Segment } from "@/types/segments";

/**
 * SegmentBendBehavior - Bend curves by dragging segments with modifier keys.
 *
 * Modifier keys:
 * - Alt + drag segment: Bend mode (Inkscape-style algorithm)
 * - Alt + Shift + drag segment: Scale mode (preserves curve shape better)
 *
 * Without modifiers, segment dragging moves all points (handled by DragBehavior).
 *
 * The bending algorithm is based on Inkscape's curve-drag-point.cpp:
 * - Weight is calculated based on t parameter (0-1 position on curve)
 * - Control points are adjusted proportionally using Bernstein polynomial coefficients
 */
export class SegmentBendBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    // Handle ongoing bending
    if (state.type === "bending") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }

    // Start bending only with Alt key on segment
    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return event.altKey;
    }

    return false;
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (state.type === "bending") {
      return this.transitionBending(state, event);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartBend(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, _event: ToolEvent, editor: Editor): void {
    if (prev.type !== "bending" && next.type === "bending") {
      editor.preview.beginPreview();
    }
  }

  private transitionBending(
    state: SelectState & { type: "bending" },
    event: ToolEvent,
  ): SelectState {
    if (event.type === "drag") {
      const delta = Vec2.sub(event.point, state.bend.lastPos);
      const newTotalDelta = Vec2.add(state.bend.totalDelta, delta);

      return {
        type: "bending",
        bend: {
          ...state.bend,
          lastPos: event.point,
          totalDelta: newTotalDelta,
        },
        intent: {
          action: "bendSegment",
          segment: state.bend.segment,
          t: state.bend.t,
          delta: newTotalDelta,
          mode: state.bend.mode,
          controlPointIds: state.bend.controlPointIds,
          initialPositions: state.bend.initialPositions,
        },
      };
    }

    if (event.type === "dragEnd") {
      const hasMoved =
        state.bend.totalDelta.x !== 0 || state.bend.totalDelta.y !== 0;

      return {
        type: "selected",
        hoveredPointId: null,
        intent: hasMoved
          ? { action: "commitPreview", label: "Bend Segment" }
          : { action: "cancelPreview" },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "selected",
        hoveredPointId: null,
        intent: { action: "cancelPreview" },
      };
    }

    return state;
  }

  private tryStartBend(
    _state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: Editor,
  ): SelectState | null {
    // Only handle Alt+drag on segments
    if (!event.altKey) return null;

    // Check if we hit a segment (not a point)
    const point = editor.hitTest.getPointAt(event.point);
    if (point) return null; // Let DragBehavior handle point drags

    const segmentHit = editor.hitTest.getSegmentAt(event.point);
    if (!segmentHit) return null;

    const segment = editor.hitTest.getSegmentById(segmentHit.segmentId);
    if (!segment) return null;

    // Determine bend mode: Alt = bend, Alt+Shift = scale
    const mode: SegmentBendMode = event.shiftKey ? "scale" : "bend";

    // For line segments, we need to upgrade to cubic first
    if (segment.type === "line") {
      // Return intent to upgrade, then the next drag will work
      // For now, skip bending on lines - user should upgrade first
      return null;
    }

    // Get control point IDs and their initial positions
    const { controlPointIds, initialPositions } = this.getControlPointInfo(segment);

    return {
      type: "bending",
      bend: {
        segmentId: segmentHit.segmentId,
        segment,
        t: segmentHit.t,
        startPos: event.point,
        lastPos: event.point,
        totalDelta: { x: 0, y: 0 },
        mode,
        controlPointIds,
        initialPositions,
      },
    };
  }

  private getControlPointInfo(segment: Segment): {
    controlPointIds: PointId[];
    initialPositions: Map<PointId, Point2D>;
  } {
    const controlPointIds: PointId[] = [];
    const initialPositions = new Map<PointId, Point2D>();

    if (segment.type === "cubic") {
      const c1Id = asPointId(segment.points.control1.id);
      const c2Id = asPointId(segment.points.control2.id);
      controlPointIds.push(c1Id, c2Id);
      initialPositions.set(c1Id, { x: segment.points.control1.x, y: segment.points.control1.y });
      initialPositions.set(c2Id, { x: segment.points.control2.x, y: segment.points.control2.y });
    } else if (segment.type === "quad") {
      const cId = asPointId(segment.points.control.id);
      controlPointIds.push(cId);
      initialPositions.set(cId, { x: segment.points.control.x, y: segment.points.control.y });
    }

    return { controlPointIds, initialPositions };
  }
}

/**
 * Calculate control point offsets using Inkscape's algorithm.
 *
 * The weight determines how much each control point is affected:
 * - t near 0: mostly front control (control1) is affected
 * - t near 1: mostly back control (control2) is affected
 * - t near 0.5: both controls are affected equally
 */
export function calculateBendOffsets(
  t: number,
  delta: Point2D,
  mode: SegmentBendMode,
): { offset1: Point2D; offset2: Point2D } {
  // Clamp t to avoid division by zero at extremes
  const safeT = Math.max(0.01, Math.min(0.99, t));

  if (mode === "bend") {
    // Inkscape's weight calculation for smooth distribution
    let weight: number;
    if (safeT <= 1 / 6) {
      weight = 0;
    } else if (safeT <= 0.5) {
      weight = Math.pow((6 * safeT - 1) / 2, 3) / 2;
    } else if (safeT <= 5 / 6) {
      weight = (1 - Math.pow((6 * (1 - safeT) - 1) / 2, 3)) / 2 + 0.5;
    } else {
      weight = 1;
    }

    // Bernstein polynomial coefficients for cubic bezier
    const b1 = 3 * safeT * Math.pow(1 - safeT, 2); // coefficient for control1
    const b2 = 3 * Math.pow(safeT, 2) * (1 - safeT); // coefficient for control2

    // Offset distribution based on weight
    const scale1 = (1 - weight) / b1;
    const scale2 = weight / b2;

    return {
      offset1: Vec2.scale(delta, scale1),
      offset2: Vec2.scale(delta, scale2),
    };
  } else {
    // Scale mode: proportional scaling that preserves curve shape better
    // This mode scales handle lengths rather than adding offsets
    // For now, use a simpler weighted distribution
    const weight = safeT;
    return {
      offset1: Vec2.scale(delta, 1 - weight),
      offset2: Vec2.scale(delta, weight),
    };
  }
}

/**
 * Calculate control point offsets for quadratic bezier.
 * Single control point gets the full delta.
 */
export function calculateQuadBendOffset(
  t: number,
  delta: Point2D,
): Point2D {
  // For quadratic, the single control point gets weighted by the Bernstein coefficient
  const safeT = Math.max(0.01, Math.min(0.99, t));
  const b = 2 * safeT * (1 - safeT); // coefficient for the control point
  return Vec2.scale(delta, 1 / b);
}
