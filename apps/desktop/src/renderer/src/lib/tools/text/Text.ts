import { BaseTool, type ToolName } from "../core/BaseTool";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";
import { TypingBehavior } from "./behaviors/TypingBehaviour";

export class Text extends BaseTool<TextState> {
  readonly id: ToolName = "text";

  readonly behaviors: TextBehavior[] = [new TypingBehavior()];
  #hadEditingSlot = false;
  #pendingOriginX: number | null = null;

  override getCursor(_state: TextState): CursorType {
    return { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  override activate(): void {
    const ctrl = this.editor.textRunController;
    const hasExistingRun = ctrl.length > 0;
    const drawOffset = this.editor.drawOffset;
    const activeGlyphName = this.editor.getActiveGlyphName();
    const activeUnicode = this.editor.getActiveGlyphUnicode();
    const activeGlyph =
      activeGlyphName !== null ? { glyphName: activeGlyphName, unicode: activeUnicode } : null;

    this.#hadEditingSlot = ctrl.state.value?.editingIndex !== null;

    if (activeGlyph) ctrl.seed(activeGlyph);
    this.#pendingOriginX = hasExistingRun ? null : drawOffset.x;

    const editingIndex = ctrl.state.value?.editingIndex;
    if (editingIndex !== null && editingIndex !== undefined) {
      ctrl.placeCaret(editingIndex + 1);
    } else {
      ctrl.moveCursorToEnd();
    }

    this.state = { type: "typing" };
    ctrl.suspendEditing();
    ctrl.setCursorVisible(true);
    this.editor.setPreviewMode(true);
    if (this.#pendingOriginX !== null) {
      ctrl.setOriginX(this.#pendingOriginX);
      this.#pendingOriginX = null;
    }
  }

  override deactivate(): void {
    const ctrl = this.editor.textRunController;
    ctrl.setCursorVisible(false);
    this.editor.setPreviewMode(false);
    this.#restoreEditingContext();
    this.state = { type: "idle" };
    this.#hadEditingSlot = false;
    this.#pendingOriginX = null;
  }

  #restoreEditingContext(): void {
    const ctrl = this.editor.textRunController;

    if (!this.#hadEditingSlot) {
      this.editor.setDrawOffset({ x: 0, y: 0 });
      ctrl.resetEditingContext();
      return;
    }

    const restored = ctrl.resumeEditing();
    if (!restored) {
      this.editor.setDrawOffset({ x: 0, y: 0 });
      ctrl.resetEditingContext();
      return;
    }

    const textRunState = ctrl.state.value;
    const slot = textRunState?.layout.slots[restored.index];
    if (slot) {
      this.editor.setDrawOffsetForGlyph(
        { x: slot.x, y: slot.y },
        restored.glyph.glyphName,
        restored.glyph.unicode,
      );
    } else {
      this.editor.setDrawOffset({ x: 0, y: 0 });
      ctrl.resetEditingContext();
    }
  }
}

export default Text;
