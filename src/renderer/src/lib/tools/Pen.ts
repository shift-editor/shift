import { Editor } from '@/lib/editor/Editor';
import { IRenderer } from '@/types/graphics';
import { Point2D } from '@/types/math';
import { Tool, ToolName } from '@/types/tool';
import type { PointId } from '@/types/ids';
import type { PointSnapshot, ContourSnapshot } from '@/types/generated';

import { Point } from '../math/point';
import { DEFAULT_STYLES } from '../styles/style';

const HIT_RADIUS = 8;

/**
 * Get the first point of a contour.
 */
function getFirstPoint(contour: ContourSnapshot): PointSnapshot | null {
  return contour.points.length > 0 ? contour.points[0] : null;
}

/**
 * Check if position is near a point.
 */
function isNearPoint(x: number, y: number, point: PointSnapshot, radius: number): boolean {
  const dx = x - point.x;
  const dy = y - point.y;
  return Math.sqrt(dx * dx + dy * dy) < radius;
}

interface AddedPoint {
  point: Point2D;
  /** PointId from FontEngine (Rust ID) */
  pointId: PointId;
}

/**
 * State for bezier creation when dragging after placing a point.
 * Creates control points on either side of the anchor.
 */
interface BezierDragState {
  type: 'draggingHandle';
  /** The anchor point we're adding handles to */
  anchorPoint: Point2D;
  anchorPointId: PointId;
  /** Leading control point (in direction of drag) */
  leadingControlId: PointId | null;
  /** Trailing control point (opposite direction) */
  trailingControlId: PointId | null;
  /** Current trailing position for rendering */
  trailingPoint: Point2D;
}

export type PenState =
  | { type: 'ready' }
  | { type: 'idle' }
  | { type: 'dragging'; point: AddedPoint }
  | BezierDragState;

export class Pen implements Tool {
  public readonly name: ToolName = 'pen';

  #editor: Editor;
  #toolState: PenState;

  public constructor(editor: Editor) {
    this.#editor = editor;
    this.#toolState = { type: 'idle' };
  }

  setIdle(): void {
    this.#toolState = { type: 'idle' };
  }

  setReady(): void {
    this.#toolState = { type: 'ready' };
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return;
    if (this.#toolState.type !== 'ready') return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    // Check if clicking near the first point of an open contour to close it
    const snapshot = this.#editor.getSnapshot();
    if (snapshot) {
      const activeContourId = this.#editor.fontEngine.editing.getActiveContourId();
      const activeContour = snapshot.contours.find(c => c.id === activeContourId);

      if (activeContour && !activeContour.closed && activeContour.points.length >= 2) {
        const firstPoint = getFirstPoint(activeContour);
        if (firstPoint && isNearPoint(x, y, firstPoint, HIT_RADIUS)) {
          // Close the contour and start a new one
          this.#editor.closeContour();
          this.#editor.fontEngine.editing.addContour();
          this.#editor.requestRedraw();
          return;
        }
      }
    }

    const addedPointId = this.#editor.addPoint(x, y, 'onCurve');

    this.#toolState = {
      type: 'dragging',
      point: {
        point: { x, y },
        pointId: addedPointId,
      },
    };

    this.#editor.emit('points:added', { pointIds: [addedPointId] });
    this.#editor.requestRedraw();
  }

  onMouseUp(_: React.MouseEvent<HTMLCanvasElement>): void {
    // TODO: if we create a cubic, keep all the points here
    this.#toolState = { type: 'ready' };
    this.#editor.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    switch (this.#toolState.type) {
      case 'dragging':
        {
          const currentState = this.#toolState;
          const distance = Point.distance(
            currentState.point.point.x,
            currentState.point.point.y,
            x,
            y
          );

          // If we've dragged far enough, create control points for a bezier curve
          if (currentState.point.pointId && distance > 3) {
            const anchorX = currentState.point.point.x;
            const anchorY = currentState.point.point.y;

            // Calculate opposite position (mirror of drag position across anchor)
            const oppositeX = 2 * anchorX - x;
            const oppositeY = 2 * anchorY - y;

            // Add leading control point (in drag direction) - this will be used by the NEXT segment
            const leadingControlId = this.#editor.fontEngine.editing.addPoint(
              x, y, 'offCurve', false
            );

            // TODO: For proper bezier, we'd also add a trailing control point
            // that belongs to the PREVIOUS segment. This requires more complex
            // handling since the trailing control should be inserted BEFORE the anchor.
            // For now, we just track the position for visual feedback.

            this.#toolState = {
              type: 'draggingHandle',
              anchorPoint: currentState.point.point,
              anchorPointId: currentState.point.pointId,
              leadingControlId: leadingControlId,
              trailingControlId: null, // Would need insert-before functionality
              trailingPoint: { x: oppositeX, y: oppositeY },
            };
          }
        }
        break;

      case 'draggingHandle': {
        const anchorX = this.#toolState.anchorPoint.x;
        const anchorY = this.#toolState.anchorPoint.y;
        const oppositeX = 2 * anchorX - x;
        const oppositeY = 2 * anchorY - y;

        // Move the leading control point to follow the mouse
        if (this.#toolState.leadingControlId) {
          this.#editor.fontEngine.editing.movePointTo(
            this.#toolState.leadingControlId, x, y
          );
        }

        // Update trailing point position for visual feedback
        this.#toolState = {
          ...this.#toolState,
          trailingPoint: { x: oppositeX, y: oppositeY },
        };

        this.#editor.redrawGlyph();
      }
    }

    this.#editor.requestRedraw();
  }

  drawTrailingHandle(ctx: IRenderer, x: number, y: number) {
    this.#editor.paintHandle(ctx, x, y, 'control', 'idle');
  }

  drawInteractive(ctx: IRenderer): void {
    if (this.#toolState.type !== 'draggingHandle') return;

    ctx.setStyle({
      ...DEFAULT_STYLES,
    });

    // Draw line from trailing point through anchor to show the handle direction
    ctx.beginPath();
    ctx.moveTo(this.#toolState.trailingPoint.x, this.#toolState.trailingPoint.y);
    ctx.lineTo(this.#toolState.anchorPoint.x, this.#toolState.anchorPoint.y);
    ctx.stroke();

    // Draw the trailing handle indicator (opposite of mouse position)
    this.drawTrailingHandle(ctx, this.#toolState.trailingPoint.x, this.#toolState.trailingPoint.y);
  }
}
