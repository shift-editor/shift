import { BaseTool, type ToolName } from "../core/BaseTool";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";
import type { Point2D } from "@shift/types";
import { TypingBehavior } from "./behaviors/TypingBehaviour";
import type { GlyphRef } from "./layout";

interface ResumeEditContext {
  drawOffset: Point2D;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
  activeUnicode: number | null;
  activeGlyphName: string | null;
}

export class Text extends BaseTool<TextState> {
  readonly id: ToolName = "text";

  readonly behaviors: TextBehavior[] = [new TypingBehavior()];
  #resumeContext: ResumeEditContext | null = null;
  #pendingOriginX: number | null = null;

  override getCursor(_state: TextState): CursorType {
    return { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  override activate(): void {
    const ctrl = this.editor.textRunController;
    const previous = ctrl.state.value;
    const hasExistingRun = ctrl.length > 0;
    const drawOffset = this.editor.getDrawOffset();
    const activeUnicode = this.editor.getActiveGlyphUnicode();
    const activeGlyphName = this.editor.getActiveGlyphName();
    const activeGlyph =
      activeGlyphName !== null ? { glyphName: activeGlyphName, unicode: activeUnicode } : null;
    this.#resumeContext = {
      drawOffset: { x: drawOffset.x, y: drawOffset.y },
      editingIndex: previous?.editingIndex ?? null,
      editingGlyph: previous?.editingGlyph ?? null,
      activeUnicode,
      activeGlyphName,
    };

    if (activeGlyph) ctrl.seed(activeGlyph);
    this.#pendingOriginX = hasExistingRun ? null : drawOffset.x;
    ctrl.moveCursorToEnd();

    this.state = { type: "typing" };
    ctrl.resetEditingContext();
    ctrl.setCursorVisible(true);
    this.editor.setPreviewMode(true);
    this.#recompute();
  }

  override deactivate(): void {
    const ctrl = this.editor.textRunController;
    ctrl.setCursorVisible(false);
    this.editor.setPreviewMode(false);
    this.#restoreEditingContext();
    this.state = { type: "idle" };
    this.#resumeContext = null;
    this.#pendingOriginX = null;
  }

  #restoreEditingContext(): void {
    const ctrl = this.editor.textRunController;

    if (!this.#resumeContext) {
      this.editor.setDrawOffset({ x: 0, y: 0 });
      ctrl.resetEditingContext();
      return;
    }

    this.editor.setDrawOffset(this.#resumeContext.drawOffset);
    const restored = this.#resolveEditingSlot();
    if (restored) {
      ctrl.setEditingSlot(restored.index, restored.glyph);
      return;
    }
    ctrl.resetEditingContext();
  }

  #resolveEditingSlot(): { index: number; glyph: GlyphRef } | null {
    const resume = this.#resumeContext;
    const textRunState = this.editor.textRunController.state.value;
    if (!resume || !textRunState) return null;

    const slots = textRunState.layout.slots;
    if (slots.length === 0) return null;

    if (resume.editingIndex !== null) {
      const slot = slots[resume.editingIndex];
      if (slot) {
        return {
          index: resume.editingIndex,
          glyph: resume.editingGlyph ?? slot.glyph,
        };
      }
    }

    let nearestIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [i, slot] of slots.entries()) {
      if (
        resume.activeGlyphName !== null &&
        slot.glyph.glyphName !== resume.activeGlyphName &&
        (resume.activeUnicode === null || slot.glyph.unicode !== resume.activeUnicode)
      ) {
        continue;
      }

      const distance = Math.abs(slot.x - resume.drawOffset.x);
      if (distance < 0.001) {
        return { index: i, glyph: slot.glyph };
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    if (nearestIndex !== null) {
      const nearestSlot = slots[nearestIndex];
      if (!nearestSlot) {
        return null;
      }
      return {
        index: nearestIndex,
        glyph: nearestSlot.glyph,
      };
    }

    return null;
  }

  #recompute(): void {
    const ctrl = this.editor.textRunController;
    if (this.#pendingOriginX !== null) {
      ctrl.recompute(this.#pendingOriginX);
      this.#pendingOriginX = null;
      return;
    }
    ctrl.recompute();
  }
}

export default Text;
