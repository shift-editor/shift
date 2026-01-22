import { Editor } from "@/lib/editor/Editor";
import { Vec2 } from "@shift/geo";
import { effect, type Effect } from "@/lib/reactive/signal";
import { createStateMachine, type StateMachine } from "@/lib/tools/core";
import { IRenderer } from "@/types/graphics";
import { Tool, ToolName } from "@/types/tool";
import type { PointHitResult, ContourContext, PenState } from "@/types/pen";
import { DRAG_THRESHOLD } from "@/types/pen";
import type { ContourSnapshot, PointSnapshot, Point2D, ContourId } from "@shift/types";

import { DEFAULT_STYLES, PREVIEW_LINE_STYLE } from "../../styles/style";
import { PenCommands } from "./commands";

function getFirstPoint(contour: ContourSnapshot): PointSnapshot | null {
  return contour.points.length > 0 ? contour.points[0] : null;
}

function isNearPoint(
  pos: { x: number; y: number },
  point: PointSnapshot,
  radius: number,
): boolean {
  return Vec2.dist(pos, point) < radius;
}

export class Pen implements Tool {
  public readonly name: ToolName = "pen";

  #editor: Editor;
  #sm: StateMachine<PenState>;
  #commands: PenCommands;
  #renderEffect: Effect;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#sm = createStateMachine<PenState>({ type: "idle" });
    this.#commands = new PenCommands(editor);

    this.#renderEffect = effect(() => {
      if (this.#sm.isIn("dragging", "ready")) {
        editor.requestRedraw();
      }
    });
  }

  setIdle(): void {
    this.#sm.transition({ type: "idle" });
  }

  setReady(): void {
    this.#sm.transition({ type: "ready", mousePos: { x: 0, y: 0 } });
    this.#editor.setCursor({ type: "pen" });
  }

  dispose(): void {
    this.#renderEffect.dispose();
  }

  cancel(): void {
    const ctx = this.#editor.createToolContext();

    if (this.#sm.isIn("anchored", "dragging")) {
      if (ctx.commands.isBatching) {
        ctx.commands.cancelBatch();
      }
      this.#sm.transition({ type: "ready", mousePos: { x: 0, y: 0 } });
      return;
    }

    this.#sm.when("ready", (state) => {
      this.#commands.abandonContour();
      this.#sm.transition({ type: "ready", mousePos: state.mousePos });
    });
  }

  getState(): PenState {
    return this.#sm.current;
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return;
    if (!this.#sm.isIn("ready")) return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);
    const ctx = this.#editor.createToolContext();

    if (this.shouldCloseContour(x, y)) {
      ctx.commands.beginBatch("Close Contour");
      this.#commands.closeContour();
      ctx.commands.endBatch();
      return;
    }

    if (!this.hasActiveDrawingContour()) {
      const hitResult = this.findHitPoint(x, y);
      if (hitResult && !hitResult.contour.closed) {
        if (hitResult.position === "start" || hitResult.position === "end") {
          ctx.commands.beginBatch("Continue Contour");
          try {
            this.#commands.continueContour(
              hitResult.contourId,
              hitResult.position === "start",
            );
            ctx.commands.endBatch();
          } catch (e) {
            ctx.commands.cancelBatch();
            throw e;
          }
          return;
        } else if (hitResult.position === "middle") {
          ctx.commands.beginBatch("Split Contour");
          try {
            this.#commands.splitContour(
              hitResult.contourId,
              hitResult.pointIndex,
            );
            ctx.commands.endBatch();
          } catch (e) {
            ctx.commands.cancelBatch();
            throw e;
          }
          return;
        }
      }
    }

    ctx.commands.beginBatch("Add Point");

    const context = this.buildContourContext();

    const result = this.#commands.placeAnchor({ x, y });

    this.#sm.transition({
      type: "anchored",
      anchor: {
        position: { x, y },
        pointId: result.pointId,
        context,
      },
    });
  }

  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void {
    const ctx = this.#editor.createToolContext();
    if (this.#sm.isIn("anchored", "dragging")) {
      if (ctx.commands.isBatching) {
        ctx.commands.endBatch();
      }
      const position = this.#editor.getMousePosition(e.clientX, e.clientY);
      const mousePos = this.#editor.projectScreenToUpm(position.x, position.y);
      this.#sm.transition({ type: "ready", mousePos });
    }
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const mousePos = this.#editor.projectScreenToUpm(position.x, position.y);

    this.#sm.when("ready", () => {
      if (!this.hasActiveDrawingContour()) {
        const hitResult = this.findHitPoint(mousePos.x, mousePos.y);
        if (hitResult && !hitResult.contour.closed) {
          if (hitResult.position === "start" || hitResult.position === "end") {
            this.#editor.setCursor({ type: "pen-end" });
          } else if (hitResult.position === "middle") {
            this.#editor.setCursor({ type: "pen-end" });
          } else {
            this.#editor.setCursor({ type: "pen" });
          }
          this.#sm.transition({ type: "ready", mousePos });
          return;
        }
      }

      const isOverPoint = this.isNearAnyPoint(mousePos.x, mousePos.y);
      if (isOverPoint) {
        this.#editor.setCursor({ type: "pen-end" });
      } else {
        this.#editor.setCursor({ type: "pen" });
      }
      this.#sm.transition({ type: "ready", mousePos });
    });

    this.#sm.when("anchored", (state) => {
      const { anchor } = state;
      const dist = Vec2.dist(anchor.position, mousePos);

      if (dist > DRAG_THRESHOLD) {
        const result = this.#commands.createHandles(anchor, mousePos);

        this.#sm.transition({
          type: "dragging",
          anchor,
          handles: result.handles,
          mousePos,
        });
      }
    });

    this.#sm.when("dragging", (state) => {
      const { anchor, handles } = state;

      this.#commands.updateHandles(anchor, handles, mousePos);

      this.#sm.transition({
        ...state,
        mousePos,
      });
    });
  }

  private buildContourContext(): ContourContext {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    if (!snapshot) {
      return {
        previousPointType: "none",
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find(
      (c) => c.id === activeContourId,
    );
    if (!activeContour || activeContour.points.length === 0) {
      return {
        previousPointType: "none",
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const points = activeContour.points;
    const lastPoint = points[points.length - 1];

    let previousOnCurvePosition: { x: number; y: number } | null = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].pointType === "onCurve") {
        previousOnCurvePosition = { x: points[i].x, y: points[i].y };
        break;
      }
    }

    return {
      previousPointType:
        lastPoint.pointType === "offCurve" ? "offCurve" : "onCurve",
      previousOnCurvePosition,
      isFirstPoint: false,
    };
  }

  private shouldCloseContour(x: number, y: number): boolean {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot?.contours.find(
      (c) => c.id === activeContourId,
    );

    if (
      !activeContour ||
      activeContour.closed ||
      activeContour.points.length < 2
    ) {
      return false;
    }

    const hitRadius = ctx.screen.hitRadius;
    const firstPoint = getFirstPoint(activeContour);
    return firstPoint !== null && isNearPoint({ x, y }, firstPoint, hitRadius);
  }

  private isNearAnyPoint(x: number, y: number): boolean {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    if (!snapshot) return false;

    const hitRadius = ctx.screen.hitRadius;
    for (const contour of snapshot.contours) {
      for (const point of contour.points) {
        if (isNearPoint({ x, y }, point, hitRadius)) {
          return true;
        }
      }
    }
    return false;
  }

  private findHitPoint(x: number, y: number): PointHitResult | null {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    if (!snapshot) return null;

    const hitRadius = ctx.screen.hitRadius;
    for (const contour of snapshot.contours) {
      for (let i = 0; i < contour.points.length; i++) {
        const point = contour.points[i];
        if (isNearPoint({ x, y }, point, hitRadius)) {
          let position: "start" | "end" | "middle";
          if (i === 0) {
            position = "start";
          } else if (i === contour.points.length - 1) {
            position = "end";
          } else {
            position = "middle";
          }
          return {
            contourId: contour.id as ContourId,
            pointIndex: i,
            position,
            contour,
          };
        }
      }
    }
    return null;
  }

  private hasActiveDrawingContour(): boolean {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    if (!snapshot) return false;

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find(
      (c) => c.id === activeContourId,
    );

    return (
      activeContour !== undefined &&
      !activeContour.closed &&
      activeContour.points.length > 0
    );
  }

  private getLastOnCurvePoint(): Point2D | null {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.snapshot;
    if (!snapshot) return null;

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find(
      (c) => c.id === activeContourId,
    );

    if (
      !activeContour ||
      activeContour.points.length === 0 ||
      activeContour.closed
    ) {
      return null;
    }

    for (let i = activeContour.points.length - 1; i >= 0; i--) {
      if (activeContour.points[i].pointType === "onCurve") {
        return {
          x: activeContour.points[i].x,
          y: activeContour.points[i].y,
        };
      }
    }
    return null;
  }

  drawInteractive(ctx: IRenderer): void {
    const toolCtx = this.#editor.createToolContext();

    this.#sm.when("ready", (state) => {
      const lastPoint = this.getLastOnCurvePoint();
      if (!lastPoint) return;

      ctx.setStyle(PREVIEW_LINE_STYLE);
      ctx.lineWidth = toolCtx.screen.lineWidth(PREVIEW_LINE_STYLE.lineWidth);
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(state.mousePos.x, state.mousePos.y);
      ctx.stroke();
    });

    this.#sm.when("dragging", (state) => {
      const { anchor, mousePos } = state;

      ctx.setStyle(DEFAULT_STYLES);
      ctx.lineWidth = toolCtx.screen.lineWidth(DEFAULT_STYLES.lineWidth);

      const anchorX = anchor.position.x;
      const anchorY = anchor.position.y;
      const mouseX = mousePos.x;
      const mouseY = mousePos.y;

      const mirrorPos = Vec2.mirror(mousePos, anchor.position);

      ctx.beginPath();
      ctx.moveTo(mouseX, mouseY);
      ctx.lineTo(anchorX, anchorY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(mirrorPos.x, mirrorPos.y);
      ctx.stroke();

      this.drawHandle(ctx, mouseX, mouseY);
      this.drawHandle(ctx, mirrorPos.x, mirrorPos.y);
    });
  }

  private drawHandle(ctx: IRenderer, x: number, y: number): void {
    this.#editor.paintHandle(ctx, x, y, "control", "idle");
  }
}
