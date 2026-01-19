import { Editor } from "@/lib/editor/Editor";
import { MovePointsCommand } from "@/lib/commands/PointCommands";
import { NudgePointsCommand } from "@/lib/commands/BezierCommands";
import { UPMRect } from "@/lib/math/rect";
import { effect, type Effect } from "@/lib/reactive/signal";
import { SELECTION_RECTANGLE_STYLES } from "@/lib/styles/style";
import { createStateMachine, type StateMachine } from "@/lib/tools/core";
import { IRenderer } from "@/types/graphics";
import { Tool, ToolName } from "@/types/tool";
import type { PointId } from "@/types/ids";

import { SelectCommands } from "./commands";
import type { SelectState } from "./states";

export class Select implements Tool {
  public readonly name: ToolName = "select";

  #editor: Editor;
  #sm: StateMachine<SelectState>;
  #commands: SelectCommands;
  #selectionRect: UPMRect;
  #renderEffect: Effect;
  #shiftModifierOn: boolean = false;
  #draggedPointIds: PointId[] = [];

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#sm = createStateMachine<SelectState>({ type: "idle" });
    this.#commands = new SelectCommands(editor);
    this.#selectionRect = new UPMRect(0, 0, 0, 0);

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
              anchorPointId: pointIds[0], // Use first point as anchor
              startPos: pos,
              totalDelta: { x: 0, y: 0 },
            },
          });
        } else {
          // Nothing hit - start rectangle selection
          ctx.select.setMode("preview");
          this.#editor.setCursor({ type: "crosshair" });
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
            // TODO: Toggle segment in selection
            // For now, just select it
            this.#commands.selectSegment(segmentHit.segmentId, true);
            this.#sm.transition({ type: "selected", hoveredPointId: null });
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
                totalDelta: { x: 0, y: 0 },
              },
            });
          }
        } else {
          // Nothing hit - start rectangle selection
          this.#commands.clearSelection();
          ctx.select.setMode("preview");
          this.#editor.setCursor({ type: "crosshair" });
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
      const width = pos.x - state.selection.startPos.x;
      const height = pos.y - state.selection.startPos.y;
      this.#selectionRect.changeOrigin(
        state.selection.startPos.x,
        state.selection.startPos.y,
      );
      this.#selectionRect.resize(width, height);
      this.#commands.selectPointsInRect(this.#selectionRect);
      this.#sm.transition({
        type: "selecting",
        selection: { ...state.selection, currentPos: pos },
      });
    });

    this.#sm.when("dragging", (state) => {
      const delta = this.#commands.moveSelectedPoints(
        state.drag.anchorPointId,
        pos,
      );
      this.#sm.transition({
        type: "dragging",
        drag: {
          ...state.drag,
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
      this.#sm.transition({ type: "selected", hoveredPointId: pointId });
    });
  }

  onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>): void {
    const ctx = this.#editor.createToolContext();

    this.#sm.when("selecting", () => {
      const { pointIds } = this.#commands.selectPointsInRect(
        this.#selectionRect,
      );
      this.#selectionRect.clear();
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
    this.#sm.when("selecting", () => {
      ctx.setStyle(SELECTION_RECTANGLE_STYLES);
      ctx.lineWidth = toolCtx.screen.lineWidth(
        SELECTION_RECTANGLE_STYLES.lineWidth,
      );
      ctx.fillRect(
        this.#selectionRect.x,
        this.#selectionRect.y,
        this.#selectionRect.width,
        this.#selectionRect.height,
      );
      ctx.strokeRect(
        this.#selectionRect.x,
        this.#selectionRect.y,
        this.#selectionRect.width,
        this.#selectionRect.height,
      );
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
