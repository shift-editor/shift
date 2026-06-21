import { Vec2, type Point2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";
import type { Select } from "../Select";

export class Rotate implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #origin: Point2D | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const next = this.tryStartRotate(event, ctx.editor, ctx.tool);
    if (!next) return false;

    ctx.setState(next);
    return true;
  }

  onDrag(
    state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: ToolEventOf<"drag">,
  ): boolean {
    if (state.type !== "rotating") return false;
    if (!this.#draft || !this.#origin) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#draft?.commit();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#draft?.discard();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState, Select>): void {
    const editor = ctx.editor;
    if (prev.type !== "rotating" && next.type === "rotating") {
      // editor.setHandlesVisible(false);
      editor.hover.clear();
    }

    if (prev.type === "rotating" && next.type !== "rotating") {
      this.#cleanup();
      // editor.setHandlesVisible(true);
    }
  }

  #cleanup(): void {
    this.#draft = null;
    this.#origin = null;
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: ToolEventOf<"drag">,
  ): SelectState & { type: "rotating" } {
    const currentPos = event.coords.glyphLocal;
    const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
    const deltaAngle = rawAngle - state.rotate.startAngle;

    const currentAngle = state.rotate.startAngle + deltaAngle;

    this.#draft!.previewRotate(deltaAngle, this.#origin!);

    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
        lastPos: currentPos,
        currentAngle,
      },
    };
  }

  private tryStartRotate(
    event: ToolEventOf<"dragStart">,
    editor: Editor,
    tool: Select,
  ): SelectState | null {
    const instance = editor.glyphInstance;
    if (!instance?.layer) return null;

    const bbHit = tool.boundingBox.hit(event.coords);
    if (!bbHit) return null;

    if (bbHit.type !== "rotate") return null;

    const corner = bbHit.corner;

    const localPoint = event.coords.glyphLocal;

    const center = bbHit.center;

    const startAngle = Vec2.angleTo(center, localPoint);

    this.#draft = editor.beginGlyphLayerEditDraft({
      points: [...editor.selection.pointIds],
      anchors: [...editor.selection.anchorIds],
    });

    this.#origin = center;

    return {
      type: "rotating",
      rotate: {
        corner,
        startPos: localPoint,
        lastPos: localPoint,
        center,
        startAngle,
        currentAngle: startAngle,
      },
    };
  }
}
