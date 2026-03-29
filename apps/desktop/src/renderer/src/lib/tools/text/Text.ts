<<<<<<< Updated upstream
import { BaseTool, type ToolName } from "../core/BaseTool";
import type { TextState } from "./types";
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

class TextTool extends BaseTool<TextState> {
  readonly id: ToolName = "text";

  readonly behaviors = [new TypingBehavior()];
  #resumeContext: ResumeEditContext | null = null;

  override getCursor(): CursorType {
    return { type: "text" };
  }
=======
import type { ToolName } from "../core/createContext";
import type { CursorType } from "@/types/editor";
import type { ToolEvent } from "../core/GestureDetector";
import type { DrawAPI } from "../core/DrawAPI";
import type { TextState, TextBehavior } from "./types";
import type { TextContent } from "@/types/textContext";
import { BaseTool } from "../core/BaseTool";
import { defineStateDiagram } from "../core/StateDiagram";
import { EscapeBehavior, DoubleClickBehavior, ClickBehavior, TypingBehavior } from "./behaviors";
import { cursorXFromIndex, layoutText } from "./TextLayout";

const CURSOR_BLINK_MS = 530;

export class Text extends BaseTool<TextState> {
  static stateSpec = defineStateDiagram<TextState["type"]>({
    states: ["idle", "ready", "typing", "editing-glyph"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "typing", event: "click" },
      { from: "typing", to: "typing", event: "keyDown" },
      { from: "typing", to: "typing", event: "click" },
      { from: "typing", to: "ready", event: "escape" },
      { from: "typing", to: "editing-glyph", event: "doubleClick" },
      { from: "editing-glyph", to: "typing", event: "return" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

  readonly id: ToolName = "text";

  #behaviors: TextBehavior[] = [
    new EscapeBehavior(),
    new DoubleClickBehavior(),
    new ClickBehavior(),
    new TypingBehavior(),
  ];

  #cursorVisible = true;
  #blinkTimer: ReturnType<typeof setInterval> | null = null;
  #savedUnicode: number | null = null;
>>>>>>> Stashed changes

  initialState(): TextState {
    return { type: "idle" };
  }

<<<<<<< Updated upstream
  override activate(): void {
=======
  activate(): void {
<<<<<<< Updated upstream
>>>>>>> Stashed changes
    const previous = this.editor.getTextRunState();
    const hasExistingRun = this.editor.getTextRunLength() > 0;
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

    this.editor.ensureTextRunSeed(activeGlyph);
    this.editor.moveTextCursorToEnd();

    this.state = { type: "typing" };
    this.editor.resetTextRunEditingContext();
    this.editor.setTextRunCursorVisible(true);
    this.editor.setPreviewMode(true);
    if (hasExistingRun) {
      this.editor.recomputeTextRun();
    } else {
      this.editor.recomputeTextRun(drawOffset.x);
    }
  }

  override deactivate(): void {
    this.editor.setTextRunCursorVisible(false);
    this.editor.setPreviewMode(false);
    this.#restoreEditingContext();
    this.state = { type: "idle" };
    this.#resumeContext = null;
    // Keep typed buffer/layout persisted across tool switches.
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
      this.editor.setTextRunEditingSlot(restored.index, restored.glyph);
      return;
    }
    this.editor.resetTextRunEditingContext();
  }

  #resolveEditingSlot(): { index: number; glyph: GlyphRef } | null {
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
}

export default TextTool;
=======
    const existing = this.editor.getTextContent();
    if (existing) {
      this.state = {
        type: "typing",
        text: existing.text,
        cursorIndex: [...existing.text].length,
        layout: existing.layout,
      };
      this.editor.setPreviewMode(true);
      this.#startBlink();
      return;
    }
    this.state = { type: "ready" };
    this.editor.setPreviewMode(true);
    this.#startBlink();
  }

  deactivate(): void {
    this.#stopBlink();
    if (this.state.type === "editing-glyph") {
      this.#updateTextContent(this.state, null);
    }
    this.editor.setPreviewMode(false);
    this.state = { type: "idle" };
  }

  getCursor(_state: TextState): CursorType {
    return { type: "text" };
  }

  handleModifier(key: string, pressed: boolean): boolean {
    if (key === "Space" && this.state.type !== "typing") {
      if (pressed) {
        this.editor.requestTemporaryTool("hand", {
          onActivate: () => this.editor.setPreviewMode(true),
          onReturn: () => this.editor.setPreviewMode(true),
        });
      } else {
        this.editor.returnFromTemporaryTool();
      }
      return true;
    }
    return false;
  }

  transition(state: TextState, event: ToolEvent): TextState {
    if (state.type === "idle") return state;

    for (const behavior of this.#behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.editor);
        if (result !== null) {
          return result;
        }
      }
    }

    return state;
  }

  onTransition(prev: TextState, next: TextState, _event: ToolEvent): void {
    if (next.type === "typing") {
      this.#resetBlink();
      this.#updateTextContent(next, null);
    }

    if (next.type === "editing-glyph" && prev.type === "typing") {
      this.#savedUnicode = this.#getCurrentEditingUnicode();
      this.editor.switchEditSession(next.originalUnicode);
      this.#updateTextContent(next, next.editingIndex);
      this.editor.setPreviewMode(false);
      this.editor.requestTemporaryTool("select", {
        onReturn: () => this.#returnFromGlyphEdit(),
      });
    }

    if (next.type === "ready" && prev.type === "typing") {
      this.#updateTextContent(prev, null);
    }
  }

  render(draw: DrawAPI): void {
    if (this.state.type !== "typing") return;

    const { layout } = this.state;
    const metrics = this.editor.getFontMetrics();

    if (this.#cursorVisible) {
      const baseGlyph = this.editor.getGlyph();
      const cursorX =
        layout.length === 0
          ? (baseGlyph?.xAdvance ?? 0)
          : cursorXFromIndex(layout, this.state.cursorIndex);
      const ascender = metrics.ascender;
      const descender = metrics.descender;

      draw.line(
        { x: cursorX, y: descender },
        { x: cursorX, y: ascender },
        { strokeStyle: "#0066FF", strokeWidth: 1 },
      );
    }
  }

  #updateTextContent(state: TextState, editingGlyphIndex: number | null): void {
    if (state.type !== "typing" && state.type !== "editing-glyph") return;

    const baseGlyphUnicode =
      editingGlyphIndex !== null && this.#savedUnicode !== null
        ? this.#savedUnicode
        : (this.editor.getGlyph()?.unicode ?? 0);

    const editingXOffset =
      editingGlyphIndex !== null && state.type === "editing-glyph"
        ? state.layout[state.editingIndex].xOffset
        : 0;

    const content: TextContent = {
      text: state.text,
      layout: state.layout,
      baseGlyphUnicode,
      editingGlyphIndex,
      editingXOffset,
    };
    this.editor.setTextContent(content);
  }

  #getCurrentEditingUnicode(): number | null {
    const glyph = this.editor.getGlyph();
    return glyph?.unicode ?? null;
  }

  #returnFromGlyphEdit(): void {
    if (this.state.type !== "editing-glyph") return;

    if (this.#savedUnicode !== null) {
      this.editor.switchEditSession(this.#savedUnicode);
    }

    const newLayout = layoutText(this.state.text, this.editor);
    this.state = {
      type: "typing",
      text: this.state.text,
      cursorIndex: this.state.cursorIndex,
      layout: newLayout,
    };
    this.editor.setActiveToolState(this.state);
    this.editor.setPreviewMode(true);
    this.#updateTextContent(this.state, null);
    this.#savedUnicode = null;
  }

  #startBlink(): void {
    this.#stopBlink();
    this.#cursorVisible = true;
    this.#blinkTimer = setInterval(() => {
      this.#cursorVisible = !this.#cursorVisible;
      this.editor.requestRedraw();
    }, CURSOR_BLINK_MS);
  }

  #stopBlink(): void {
    if (this.#blinkTimer !== null) {
      clearInterval(this.#blinkTimer);
      this.#blinkTimer = null;
    }
  }

  #resetBlink(): void {
    this.#cursorVisible = true;
    this.#startBlink();
  }
}
>>>>>>> Stashed changes
