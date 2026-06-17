import { BaseTool, type ToolName } from "../core";
import type { PenState } from "./types";
import { PenDownBehaviour, HandleBehavior, EscapeBehavior } from "./behaviors";
import type { CursorType } from "@/types/editor";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { PenTargets } from "./PenTargets";
import { PenPreview } from "./PenPreview";

export type { PenState };

export class Pen extends BaseTool<PenState> {
  readonly id: ToolName = "pen";

  #penPreview: PenPreview = new PenPreview(this);

  readonly behaviors = [new EscapeBehavior(), new PenDownBehaviour(), new HandleBehavior()];

  override getCursor(state: PenState): CursorType {
    if (state.type !== "ready") return { type: "pen" };

    const targets = PenTargets.active(this.editor);
    if (!targets) return { type: "pen" };

    const pos = this.editor.input.pointerCell.value;
    if (!pos) return { type: "pen" };

    const target = targets.at(pos.glyphLocal, this.editor.hitRadius);
    const activeContour = this.editor.getActiveContour();

    switch (target.type) {
      case "terminal": {
        if (activeContour && target.side == "start" && activeContour.points.length > 1) {
          return { type: "pen-end" };
        }

        if (!activeContour) {
          return { type: "pen-end" };
        }
      }
      case "segment": {
        if (!activeContour) return { type: "pen-add" };
      }
    }

    return { type: "pen" };
  }

  protected override isEditing(state: PenState): boolean {
    return state.type === "dragging";
  }

  initialState(): PenState {
    return { type: "idle" };
  }

  override activate(): void {
    this.setState({ type: "ready" });
    this.editor.clearActiveContour();
  }

  override deactivate(): void {
    this.setState({ type: "idle" });
  }

  override drawOverlay(canvas: Canvas): void {
    if (this.editor.getFocusZone() !== "canvas") return;
    this.#penPreview.draw(canvas);
  }
}
