import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effect, untracked } from "@shift/editor/signals";
import { trackRunLayouts } from "@shift/editor/tools";
import type { EditorTestSurface } from "@/testing/surface";
import { openTestEditor, startTestEditor } from "@/testing/TestEditor";

const FONTS = resolve(process.cwd(), "../../fixtures/fonts");

/** Pastes `text` after the edited glyph in Text mode, then goes back to editing it. */
async function pasteAfterEditedGlyph(editor: EditorTestSurface, text: string): Promise<void> {
  editor.selectTool("text");
  editor.pasteText(text);
  await editor.pressKey("Escape");
  await editor.settle();
}

/** Puts the Text mode caret before the first item, as Command-Left does. */
function caretToStart(editor: EditorTestSurface): void {
  editor.selectTool("text");
  editor.moveCaret(-1, "line");
}

/** The canvas text, which a test expects to be there. */
function canvasText(editor: EditorTestSurface) {
  const text = editor.canvasText();
  if (!text) throw new Error("Expected canvas text");
  return text;
}

/**
 * When a run's layout is rebuilt, and what keeps a run's edited child in step
 * with its items, observed through the surface. Calls on `Text` and the text
 * run node themselves are in `Text.subject.test.ts`.
 */
describe("Text layout cells", () => {
  it("keep a run's layout while a point moves, since only anchors place marks", async () => {
    const editor = await openTestEditor(resolve(FONTS, "AnchorPropagation.glyphs"), "a");
    const { point } = await editor.draw({
      contours: [{ points: [{ x: 0, y: 0, name: "point" }] }],
    });
    await pasteAfterEditedGlyph(editor, "/acutecomb");
    // Counting holds the layout the way the canvas holds a run's layout.
    const before = editor.textLayoutCount();

    editor.selectTool("select");
    editor.holdDrag(point, { x: 40, y: 0 });

    expect(editor.textLayoutCount()).toBe(before);
    await editor.close();
  });

  it("keep a run's layout while the caret moves, and rebuild it when items change", async () => {
    const editor = await startTestEditor();
    editor.selectTool("text");
    const initial = editor.textLayoutCount();

    caretToStart(editor);
    expect(editor.textLayoutCount()).toBe(initial);
    editor.typeText("A");
    const populated = editor.textLayoutCount();
    expect(populated).not.toBe(initial);
    editor.moveCaret(-1, "character");
    expect(editor.textLayoutCount()).toBe(populated);
    await editor.close();
  });

  it("redraw an overlay tracking every run's layout when the active source changes", async () => {
    const editor = await openTestEditor(
      resolve(FONTS, "mutatorsans-variable/MutatorSans.designspace"),
      "T",
    );
    await pasteAfterEditedGlyph(editor, "A");
    const drawn: number[] = [];
    const overlay = effect(() => {
      trackRunLayouts(editor.asEditor());
      drawn.push(untracked(() => canvasText(editor).glyphs[1]!.left));
    });

    editor.clickSource("BoldWide");
    overlay.dispose();

    expect(drawn).toHaveLength(2);
    expect(drawn[1]).not.toBe(drawn[0]);
    await editor.close();
  });
});

describe("TextRunNodeDefinition", () => {
  it("deletes the edited child when any writer removes its item, in the same undo step", async () => {
    const editor = await startTestEditor();
    const childItemId = canvasText(editor).editedItemId;
    if (!childItemId) throw new Error("Expected the edited glyph's item");

    editor.selectTool("text");
    editor.selectAllText();
    editor.deleteBackward();
    // In Text mode the open glyph is the edited child; none is open once its item is gone.
    expect(canvasText(editor)).toMatchObject({ items: [], openItemId: null });

    await editor.undo();
    expect(canvasText(editor).items[0]?.id).toBe(childItemId);
    expect(canvasText(editor)).toMatchObject({ openItemId: childItemId });
    await editor.close();
  });
});

describe("TextEditing", () => {
  it("shows the caret, its selection and where it draws only in the edited node", async () => {
    const editor = await startTestEditor();
    caretToStart(editor);
    editor.typeText("AB");
    editor.moveCaret(-1, "character", true);
    const glyph = canvasText(editor).glyphs[1]!;

    expect(canvasText(editor).caret).toEqual({
      position: 1,
      selection: { start: 1, end: 2 },
      x: glyph.left,
      y: glyph.baseline,
    });

    await editor.pressKey("Escape");
    expect(canvasText(editor).caret).toBeNull();
    await editor.close();
  });
});
