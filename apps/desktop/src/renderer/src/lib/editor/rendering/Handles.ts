import type { Point2D, PointId } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import type { HandleState } from "@/types/graphics";
import type { Canvas } from "./Canvas";
import type { ViewportTransform } from "./Viewport";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import { packHandleInstances } from "./gpu/classifyHandles";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import {
  drawHandle,
  drawHandleFirst,
  drawHandleDirection,
  drawHandleLast,
} from "./indicators/handleDrawing";

export interface HandleStates {
  getHandleState: (pointId: PointId) => HandleState;
}

/**
 * GPU-first handle rendering. Owns the full pipeline from glyph data to GPU draw.
 * Falls back to CPU (Canvas 2D) rendering if WebGL is unavailable.
 */
export class Handles {
  #gpu: ReglHandleContext | null = null;
  #packedInstances: Float32Array | null = null;

  setGpu(gpu: ReglHandleContext | null): void {
    this.#gpu = gpu;
  }

  draw(
    glyph: Glyph,
    states: HandleStates,
    viewport: ViewportTransform,
    drawOffset: Point2D,
    gpuEnabled: boolean,
  ): boolean {
    if (gpuEnabled && this.#gpu?.isAvailable()) {
      return this.#drawGpu(glyph, states, viewport, drawOffset);
    }
    return false;
  }

  /** CPU fallback: draw handles on 2D canvas. */
  drawCpu(
    canvas: Canvas,
    glyph: Glyph,
    states: HandleStates,
  ): void {
    for (const contour of glyph.contours) {
      const numPoints = contour.points.length;
      if (numPoints === 0) continue;

      for (const { current, prev, next, isFirst, isLast } of Contours.withNeighbors(contour)) {
        const pos = { x: current.x, y: current.y };
        const handleState = states.getHandleState(current.id);

        if (numPoints === 1) {
          drawHandle(canvas, pos, "corner", handleState);
          continue;
        }

        if (isFirst) {
          const segmentAngle = Vec2.angleTo(current, next!);
          if (contour.closed) {
            drawHandleDirection(canvas, pos, segmentAngle, handleState);
          } else {
            drawHandleFirst(canvas, pos, segmentAngle, handleState);
          }
          continue;
        }

        if (isLast && !contour.closed) {
          drawHandleLast(canvas, pos, { x: prev!.x, y: prev!.y }, handleState);
          continue;
        }

        if (Validate.isOnCurve(current)) {
          drawHandle(canvas, pos, current.smooth ? "smooth" : "corner", handleState);
        } else {
          drawHandle(canvas, pos, "control", handleState);
        }
      }
    }
  }

  clear(): void {
    this.#gpu?.clear();
  }

  #drawGpu(
    glyph: Glyph,
    states: HandleStates,
    viewport: ViewportTransform,
    drawOffset: Point2D,
  ): boolean {
    if (!this.#gpu?.isAvailable()) return false;

    const { packedInstances, instanceCount } = packHandleInstances(
      glyph,
      (id) => states.getHandleState(id),
      viewport,
      drawOffset,
      this.#packedInstances,
    );
    this.#packedInstances = packedInstances;

    return this.#gpu.draw({
      packedInstances,
      instanceCount,
      viewport,
      drawOffset,
      logicalWidth: viewport.centre.x * 2,
      logicalHeight: viewport.logicalHeight,
    });
  }
}
