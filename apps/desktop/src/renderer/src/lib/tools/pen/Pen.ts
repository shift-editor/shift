import { Vec2, type Point2D } from "@shift/geo";
import { BaseTool, type ToolName, defineStateDiagram, type ToolEvent } from "../core";
import type { PenState } from "./types";
import { PenDownBehaviour, HandleBehavior, EscapeBehavior } from "./behaviors";
import type { CursorType } from "@/types/editor";
import { isContourEndpointHit, isMiddlePointHit, isSegmentHit } from "@/types/hitResult";
import type { Canvas } from "@/lib/editor/rendering/Canvas";

export type { PenState };

export class Pen extends BaseTool<PenState> {
  /** @knipclassignore — declarative state spec for tool docs/debugging. */
  static stateSpec = defineStateDiagram<PenState["type"]>({
    states: ["idle", "ready", "anchored", "dragging"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "anchored", event: "click" },
      { from: "anchored", to: "dragging", event: "drag" },
      { from: "dragging", to: "anchored", event: "release" },
      { from: "anchored", to: "ready", event: "commit" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

  readonly id: ToolName = "pen";

  readonly behaviors = [new EscapeBehavior(), new PenDownBehaviour(), new HandleBehavior()];

  override getCursor(state: PenState): CursorType {
    if (state.type !== "ready") return { type: "pen" };

    const pos = state.mousePos;

    if (this.hasActiveDrawingContour()) {
      if (this.shouldCloseContour(pos.x, pos.y)) {
        return { type: "pen-end" };
      }
      return { type: "pen" };
    }

    const hit = this.editor.hitTest(this.editor.fromGlyphLocal(pos));
    if (isContourEndpointHit(hit) && !hit.contour.closed) return { type: "pen-end" };
    if (isMiddlePointHit(hit)) return { type: "pen-end" };
    if (isSegmentHit(hit)) return { type: "pen-add" };

    return { type: "pen" };
  }

  initialState(): PenState {
    return { type: "idle" };
  }

  override activate(): void {
    const pos = this.editor.sceneToGlyphLocal(this.editor.getMousePosition());
    this.state = { type: "ready", mousePos: pos };
    this.editor.clearActiveContour();
  }

  override deactivate(): void {
    this.state = this.initialState();
  }

  protected override preTransition(state: PenState, event: ToolEvent) {
    if (state.type === "ready" && event.type === "pointerMove") {
      return {
        state: { type: "ready" as const, mousePos: event.coords.glyphLocal },
      };
    }
    return null;
  }

  private shouldCloseContour(x: number, y: number): boolean {
    const contour = this.editor.getActiveContour();
    if (!contour || contour.closed || contour.points.length < 2) {
      return false;
    }

    const firstPoint = contour.firstPoint;
    if (!firstPoint) return false;

    return Vec2.isWithin({ x, y }, firstPoint, this.editor.hitRadius);
  }

  private hasActiveDrawingContour(): boolean {
    const contour = this.editor.getActiveContour();
    if (!contour) return false;
    return !contour.closed && !contour.isEmpty;
  }

  private getLastOnCurvePoint(): Point2D | null {
    const contour = this.editor.getActiveContour();
    if (!contour || contour.isEmpty || contour.closed) {
      return null;
    }

    const lastOnCurve = contour.lastOnCurvePoint;
    if (!lastOnCurve) return null;

    return { x: lastOnCurve.x, y: lastOnCurve.y };
  }

  override renderOverlay(canvas: Canvas): void {
    if (this.editor.getFocusZone() !== "canvas") return;

    // Preview line from last point to cursor
    if (this.state.type === "ready") {
      const lastPoint = this.getLastOnCurvePoint();
      if (lastPoint) {
        canvas.line(
          lastPoint,
          this.state.mousePos,
          canvas.theme.preview.color,
          canvas.theme.preview.widthPx,
        );
      }

      // Draw pen ready circle
      const { fill, stroke, size, widthPx } = canvas.theme.penReady;
      canvas.filledStrokeCircle(this.state.mousePos, size, fill, stroke, widthPx);
    }

    // Control handle preview during drag
    if (this.state.type === "dragging") {
      const { anchor, mousePos } = this.state;
      const effectivePos = mousePos;
      const mirrorPos = Vec2.mirror(effectivePos, anchor.position);

      const { stroke, widthPx } = canvas.theme.glyph;
      canvas.line(effectivePos, anchor.position, stroke, widthPx);
      canvas.line(anchor.position, mirrorPos, stroke, widthPx);

      // Draw control handle previews
      const controlStyle = canvas.theme.handle.control.idle;
      canvas.filledStrokeCircle(
        effectivePos,
        controlStyle.size,
        controlStyle.fill,
        controlStyle.stroke,
        controlStyle.lineWidth,
      );
      canvas.filledStrokeCircle(
        mirrorPos,
        controlStyle.size,
        controlStyle.fill,
        controlStyle.stroke,
        controlStyle.lineWidth,
      );
    }
  }
}
