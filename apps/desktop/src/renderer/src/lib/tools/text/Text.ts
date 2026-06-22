import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";
import { glyphTextItem } from "@/lib/text/layout";

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
    const owner = this.editor.glyph.peek()?.handle ?? null;
    if (!owner) {
      this.state = { type: "typing" };
      this.editor.glyphDisplay;
      return;
    }

    const ownerName = owner.name;
    const record = this.editor.font.recordForName(ownerName);
    if (record) this.editor.font.requestGlyphs([record.id]);

    const run = this.editor.textRuns.switchTo(ownerName);
    run.seed(glyphTextItem(ownerName, owner.unicode ?? null), this.editor.drawOffset.x);
    run.interaction.suspend();
    run.setCursorVisible(true);

    this.state = { type: "typing" };
    this.editor.enableProofMode();
  }

  override deactivate(): void {
    const run = this.editor.textRun;
    run.setCursorVisible(false);
    run.interaction.resume();

    this.editor.disableProofMode();
    this.state = { type: "idle" };
  }
}
