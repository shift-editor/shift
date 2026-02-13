import { BaseTool, type ToolName } from "../core/BaseTool";
import type { TextAction, TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";
import type { Point2D } from "@shift/types";
import { TypingBehavior } from "./behaviors/TypingBehaviour";

interface ResumeEditContext {
  drawOffset: Point2D;
  editingIndex: number | null;
  editingUnicode: number | null;
  activeUnicode: number | null;
}

class TextTool extends BaseTool<TextState, TextAction> {
  readonly id: ToolName = "text";

  readonly behaviors: TextBehavior[] = [new TypingBehavior()];
  #resumeContext: ResumeEditContext | null = null;
  #pendingOriginX: number | null = null;

  getCursor(_state: TextState): CursorType {
    return { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  activate(): void {
    const previous = this.editor.getTextRunState();
    const hasExistingRun = this.editor.getTextRunLength() > 0;
    const drawOffset = this.editor.getDrawOffset();
    const activeUnicode = this.editor.getActiveGlyphUnicode();
    this.#resumeContext = {
      drawOffset: { x: drawOffset.x, y: drawOffset.y },
      editingIndex: previous?.editingIndex ?? null,
      editingUnicode: previous?.editingUnicode ?? null,
      activeUnicode,
    };

    this.editor.ensureTextRunSeed(activeUnicode);
    this.#pendingOriginX = hasExistingRun ? null : drawOffset.x;
    this.editor.moveTextCursorToEnd();

    this.state = { type: "typing" };
    this.editor.resetTextRunEditingContext();
    this.editor.setTextRunCursorVisible(true);
    this.editor.setPreviewMode(true);
    this.#recompute();
  }

  deactivate(): void {
    this.editor.setTextRunCursorVisible(false);
    this.editor.setPreviewMode(false);
    this.#restoreEditingContext();
    this.state = { type: "idle" };
    this.#resumeContext = null;
    this.#pendingOriginX = null;
    // Keep typed buffer/layout persisted across tool switches.
  }

  protected executeAction(action: TextAction): void {
    switch (action.type) {
      case "insert":
        this.editor.insertTextCodepoint(action.codepoint);
        this.#recompute();
        break;
      case "delete":
        if (this.editor.deleteTextCodepoint()) {
          this.#recompute();
        }
        break;
      case "moveLeft":
        if (this.editor.moveTextCursorLeft()) {
          this.#recompute();
        }
        break;
      case "moveRight":
        if (this.editor.moveTextCursorRight()) {
          this.#recompute();
        }
        break;
      case "cancel":
        this.editor.setActiveTool("select");
        break;
    }
  }

  #restoreEditingContext(): void {
    if (!this.#resumeContext) {
      this.editor.setDrawOffset({ x: 0, y: 0 });
      this.editor.resetTextRunEditingContext();
      return;
    }

    this.editor.setDrawOffset(this.#resumeContext.drawOffset);
    const restored = this.#resolveEditingSlot();
    if (restored) {
      this.editor.setTextRunEditingSlot(restored.index, restored.unicode);
      return;
    }
    this.editor.resetTextRunEditingContext();
  }

  #resolveEditingSlot(): { index: number; unicode: number } | null {
    const resume = this.#resumeContext;
    const textRunState = this.editor.getTextRunState();
    if (!resume || !textRunState) return null;

    const slots = textRunState.layout.slots;
    if (slots.length === 0) return null;

    if (resume.editingIndex !== null) {
      const slot = slots[resume.editingIndex];
      if (slot) {
        return {
          index: resume.editingIndex,
          unicode: resume.editingUnicode ?? slot.unicode,
        };
      }
    }

    let nearestIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (resume.activeUnicode !== null && slot.unicode !== resume.activeUnicode) {
        continue;
      }

      const distance = Math.abs(slot.x - resume.drawOffset.x);
      if (distance < 0.001) {
        return { index: i, unicode: slot.unicode };
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    if (nearestIndex !== null) {
      return {
        index: nearestIndex,
        unicode: slots[nearestIndex].unicode,
      };
    }

    return null;
  }

  #recompute(): void {
    if (this.#pendingOriginX !== null) {
      this.editor.recomputeTextRun(this.#pendingOriginX);
      this.#pendingOriginX = null;
      return;
    }
    this.editor.recomputeTextRun();
  }
}

export default TextTool;
