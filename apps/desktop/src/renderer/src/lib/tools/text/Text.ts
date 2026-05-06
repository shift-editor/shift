import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";
import { glyphCell } from "@/lib/text/layout";

export class TextTool extends BaseTool<TextState> {
  readonly id: ToolName = "text";
  readonly behaviors: TextBehavior[] = [new TypingBehavior()];

  override getCursor(state: TextState): CursorType {
    if (state.type === "typing") return { type: "text" };
    return { type: "default" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  override activate(): void {
    // Run owner = MAIN glyph, not the currently-active editing glyph.
    // Double-clicking a slot changes the active glyph (so its outline becomes
    // editable in place) but the run still belongs to whoever owned it —
    // the main glyph the user opened from the grid. Keying on activeGlyph
    // here would silently switch to a fresh per-active-glyph run when the
    // user toggles tools mid-slot-edit, wiping the run they were in.
    const owner = this.editor.rootGlyphHandle;
    if (!owner) {
      this.state = { type: "typing" };
      this.editor.setPreviewMode(true);
      return;
    }

    const ownerName = owner.name;
    const run = this.editor.textRuns.switchTo(ownerName);
    run.seed(glyphCell(ownerName, owner.unicode ?? null), this.editor.drawOffset.x);
    run.interaction.suspend();
    run.setCursorVisible(true);

    this.state = { type: "typing" };
    this.editor.setPreviewMode(true);
  }

  override deactivate(): void {
    const run = this.editor.textRun;
    run.setCursorVisible(false);
    run.interaction.resume();
    this.editor.setPreviewMode(false);
    this.state = { type: "idle" };
  }
}
