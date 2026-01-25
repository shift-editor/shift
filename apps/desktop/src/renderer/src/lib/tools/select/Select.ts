import { Editor } from "@/lib/editor/Editor";
import { MovePointsCommand, NudgePointsCommand } from "@/lib/commands";
import { effect, type Effect } from "@/lib/reactive/signal";
import { SELECTION_RECTANGLE_STYLES } from "@/lib/styles/style";
import { createStateMachine, type StateMachine } from "@/lib/tools/core";
import { IRenderer } from "@/types/graphics";
import { Tool, ToolName } from "@/types/tool";
import type { CursorType } from "@/types/editor";
import type { PointId, Point2D, Rect2D } from "@shift/types";

import { SelectCommands, type BoundingRectEdge } from "./commands";
import type { SelectState } from "./states";

function normalizeRect(start: Point2D, current: Point2D): Rect2D {
  const left = Math.min(start.x, current.x);
  const right = Math.max(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const bottom = Math.max(start.y, current.y);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    top,
    right,
    bottom,
  };
}

function edgeToCursor(edge: BoundingRectEdge): CursorType {
  switch (edge) {
    case "left":
    case "right":
      return { type: "ew-resize" };
    case "top":
    case "bottom":
      return { type: "ns-resize" };
    case "top-left":
    case "bottom-right":
      return { type: "nwse-resize" };
    case "top-right":
    case "bottom-left":
      return { type: "nesw-resize" };
    default:
      return { type: "default" };
  }
}

export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #sm: StateMachine<SelectState>;
  #commands: SelectCommands;
  #renderEffect: Effect;
  #shiftModifierOn: boolean = false;
  #draggedPointIds: PointId[] = [];

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#sm = createStateMachine<SelectState>({ type: "idle" });
    this.#commands = new SelectCommands(editor);

    this.#renderEffect = effect(() => {
      if (!this.#sm.isIn("idle")) {
        editor.requestRedraw();
      }
    });
  }

  setIdle(): void {
    this.#sm.transition({ type: "idle" });
  }

  setReady(): void {
    this.#sm.transition({ type: "ready", hoveredPointId: null });
    this.#editor.setCursor({ type: "default" });
  }

  dispose(): void {
    this.#renderEffect.dispose();
  }

  getState(): SelectState {
    return this.#sm.current;
  }

  #getMouseUpm(e: React.MouseEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } {
    const screenPos = this.#editor.getMousePosition(e.clientX, e.clientY);
    return this.#editor.projectScreenToUpm(screenPos.x, screenPos.y);
  }

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    const { pointId } = this.#commands.hitTest(pos);
    const ctx = this.#editor.createToolContext();

    this.#sm.when("ready", () => {
      if (pointId) {
        // Point hit - select and start dragging
        this.#commands.selectPoint(pointId, false);
        const freshCtx = this.#editor.createToolContext();
        this.#draggedPointIds = [...freshCtx.selectedPoints];
        this.#editor.setCursor({ type: "move" });
        this.#sm.transition({
          type: "dragging",
          drag: {
            anchorPointId: pointId,
            startPos: pos,
            lastPos: pos,
            totalDelta: { x: 0, y: 0 },
          },
        });
      } else {
        // No point hit - check for segment hit
        const segmentHit = this.#commands.hitTestSegment(pos);
        if (segmentHit) {
          // Segment hit - select and start dragging
          const pointIds = this.#commands.selectSegment(
            segmentHit.segmentId,
            false,
          );
          this.#draggedPointIds = pointIds;
          this.#editor.setCursor({ type: "move" });
          this.#sm.transition({
            type: "dragging",
            drag: {
              anchorPointId: pointIds[0],
              startPos: pos,
              lastPos: pos,
              totalDelta: { x: 0, y: 0 },
            },
          });
        } else {
          // Nothing hit - start rectangle selection
          ctx.select.setMode("preview");
          this.#editor.setCursor({ type: "default" });
          this.#sm.transition({
            type: "selecting",
            selection: { startPos: pos, currentPos: pos },
          });
        }
      }
    });

    this.#sm.when("selected", () => {
      if (pointId) {
        // Point hit
        const isSelected = this.#commands.isPointSelected(pointId);
        if (this.#shiftModifierOn) {
          this.#commands.togglePointInSelection(pointId);
          if (this.#commands.hasSelection()) {
            this.#sm.transition({ type: "selected", hoveredPointId: pointId });
          } else {
            this.#sm.transition({ type: "ready", hoveredPointId: pointId });
          }
        } else {
          if (!isSelected) {
            this.#commands.selectPoint(pointId, false);
          }
          const freshCtx = this.#editor.createToolContext();
          this.#draggedPointIds = [...freshCtx.selectedPoints];
          this.#editor.setCursor({ type: "move" });
          this.#sm.transition({
            type: "dragging",
            drag: {
              anchorPointId: pointId,
              startPos: pos,
              lastPos: pos,
              totalDelta: { x: 0, y: 0 },
            },
          });
        }
      } else {
        // No point hit - check for segment hit
        const segmentHit = this.#commands.hitTestSegment(pos);
        if (segmentHit) {
          // Segment hit
          const isSelected = this.#commands.isSegmentSelected(
            segmentHit.segmentId,
          );
          if (this.#shiftModifierOn) {
            this.#commands.toggleSegment(segmentHit.segmentId);
            if (this.#commands.hasSelection()) {
              this.#sm.transition({ type: "selected", hoveredPointId: null });
            } else {
              this.#sm.transition({ type: "ready", hoveredPointId: null });
            }
          } else {
            if (!isSelected) {
              this.#commands.selectSegment(segmentHit.segmentId, false);
            }
            const freshCtx = this.#editor.createToolContext();
            this.#draggedPointIds = [...freshCtx.selectedPoints];
            this.#editor.setCursor({ type: "move" });
            this.#sm.transition({
              type: "dragging",
              drag: {
                anchorPointId: this.#draggedPointIds[0],
                startPos: pos,
                lastPos: pos,
                totalDelta: { x: 0, y: 0 },
              },
            });
          }
        } else {
          // Nothing hit - start rectangle selection
          this.#commands.clearSelection();
          ctx.select.setMode("preview");
          this.#editor.setCursor({ type: "default" });
          this.#sm.transition({
            type: "selecting",
            selection: { startPos: pos, currentPos: pos },
          });
        }
      }
    });

    ctx.requestRedraw();
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);

    this.#sm.when("selecting", (state) => {
      const rect = normalizeRect(state.selection.startPos, pos);
      this.#commands.selectPointsInRect(rect);
      this.#sm.transition({
        type: "selecting",
        selection: { ...state.selection, currentPos: pos },
      });
    });

    this.#sm.when("dragging", (state) => {
      const delta = {
        x: pos.x - state.drag.lastPos.x,
        y: pos.y - state.drag.lastPos.y,
      };
      this.#commands.moveSelectedPointsByDelta(delta);
      this.#sm.transition({
        type: "dragging",
        drag: {
          ...state.drag,
          lastPos: pos,
          totalDelta: {
            x: state.drag.totalDelta.x + delta.x,
            y: state.drag.totalDelta.y + delta.y,
          },
        },
      });
    });

    this.#sm.when("ready", () => {
      const { pointId } = this.#commands.hitTest(pos);
      this.#commands.updateHover(pos);
      this.#sm.transition({ type: "ready", hoveredPointId: pointId });
    });

    this.#sm.when("selected", () => {
      const { pointId } = this.#commands.hitTest(pos);
      this.#commands.updateHover(pos);

      // Check for bounding rect edge hover
      const edge = this.#commands.hitTestBoundingRectEdge(pos);
      if (edge && !pointId) {
        this.#editor.setCursor(edgeToCursor(edge));
      } else {
        this.#editor.setCursor({ type: "default" });
      }

      this.#sm.transition({ type: "selected", hoveredPointId: pointId });
    });
  }

  onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>): void {
    const ctx = this.#editor.createToolContext();

    this.#sm.when("selecting", (state) => {
      const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
      const { pointIds } = this.#commands.selectPointsInRect(rect);
      ctx.select.setMode("committed");
      this.#editor.setCursor({ type: "default" });

      if (pointIds.size > 0) {
        this.#sm.transition({ type: "selected", hoveredPointId: null });
      } else {
        this.#sm.transition({ type: "ready", hoveredPointId: null });
      }
    });

    this.#sm.when("dragging", (state) => {
      const { totalDelta } = state.drag;

      if (
        (totalDelta.x !== 0 || totalDelta.y !== 0) &&
        this.#draggedPointIds.length > 0
      ) {
        const cmd = new MovePointsCommand(
          this.#draggedPointIds,
          totalDelta.x,
          totalDelta.y,
        );
        ctx.commands.record(cmd);
      }

      this.#draggedPointIds = [];
      this.#editor.setCursor({ type: "default" });
      this.#sm.transition({ type: "selected", hoveredPointId: null });
    });
  }

  drawInteractive(ctx: IRenderer): void {
    const toolCtx = this.#editor.createToolContext();
    this.#sm.when("selecting", (state) => {
      const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
      ctx.setStyle(SELECTION_RECTANGLE_STYLES);
      ctx.lineWidth = toolCtx.screen.lineWidth(
        SELECTION_RECTANGLE_STYLES.lineWidth,
      );
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    });
  }

  keyDownHandler(e: KeyboardEvent): void {
    this.#shiftModifierOn = e.shiftKey;

    if (!this.#sm.isIn("selected")) return;

    const modifier = e.metaKey ? "large" : e.shiftKey ? "medium" : "small";
    const nudgeValue = this.#commands.getNudgeValue(modifier);
    const ctx = this.#editor.createToolContext();
    const pointIds = [...ctx.selectedPoints];

    if (pointIds.length === 0) return;

    let dx = 0;
    let dy = 0;

    switch (e.key) {
      case "ArrowLeft":
        dx = -nudgeValue;
        break;
      case "ArrowRight":
        dx = nudgeValue;
        break;
      case "ArrowUp":
        dy = nudgeValue;
        break;
      case "ArrowDown":
        dy = -nudgeValue;
        break;
      default:
        return;
    }

    const cmd = new NudgePointsCommand(pointIds, dx, dy);
    ctx.commands.execute(cmd);
    ctx.requestRedraw();
  }

  keyUpHandler(_e: KeyboardEvent): void {
    this.#shiftModifierOn = false;
  }

  onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const pos = this.#getMouseUpm(e);
    this.#commands.toggleSmooth(pos);
  }
}
