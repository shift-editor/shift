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
    const previous = this.editor.textRunManager.state.peek();
    const hasExistingRun = this.editor.textRunManager.buffer.length > 0;
    const drawOffset = this.editor.getDrawOffset();
    const activeUnicode = this.editor.getActiveGlyphUnicode();
    this.#resumeContext = {
      drawOffset: { x: drawOffset.x, y: drawOffset.y },
      editingIndex: previous?.editingIndex ?? null,
      editingUnicode: previous?.editingUnicode ?? null,
      activeUnicode,
    };

    this.editor.textRunManager.ensureSeeded(activeUnicode);
    this.#pendingOriginX = hasExistingRun ? null : drawOffset.x;
    this.editor.textRunManager.buffer.moveTo(this.editor.textRunManager.buffer.length);

    this.state = { type: "typing" };
    this.editor.textRunManager.resetEditingContext();
    this.editor.textRunManager.setCursorVisible(true);
    this.editor.setPreviewMode(true);
    this.#recompute();
  }

  deactivate(): void {
    this.editor.textRunManager.setCursorVisible(false);
    this.editor.setPreviewMode(false);
    this.#restoreEditingContext();
    this.state = { type: "idle" };
    this.#resumeContext = null;
    this.#pendingOriginX = null;
    // Keep typed buffer/layout persisted across tool switches.
  }

  protected executeAction(action: TextAction): void {
    const buffer = this.editor.textRunManager.buffer;

    switch (action.type) {
      case "insert":
        buffer.insert(action.codepoint);
        this.#recompute();
        break;
      case "delete":
        if (buffer.delete()) {
          this.#recompute();
        }
        break;
      case "moveLeft":
        if (buffer.moveLeft()) {
          this.#recompute();
        }
        break;
      case "moveRight":
        if (buffer.moveRight()) {
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
      this.editor.textRunManager.resetEditingContext();
      return;
    }

    this.editor.setDrawOffset(this.#resumeContext.drawOffset);
    const restored = this.#resolveEditingSlot();
    if (restored) {
      this.editor.textRunManager.setEditingSlot(restored.index, restored.unicode);
      return;
    }
    this.editor.textRunManager.resetEditingContext();
  }

  #resolveEditingSlot(): { index: number; unicode: number } | null {
    const resume = this.#resumeContext;
    const textRunState = this.editor.textRunManager.state.peek();
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
      this.editor.textRunManager.recompute(this.editor.font, this.#pendingOriginX);
      this.#pendingOriginX = null;
      return;
    }
    this.editor.textRunManager.recompute(this.editor.font);
  }
}

export default TextTool;
