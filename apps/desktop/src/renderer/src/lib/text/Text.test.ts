import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import type { Editor } from "@shift/editor";
import { localPoint, scenePoint, type LocalPoint } from "@shift/editor/spaces";
import { effect, untracked } from "@shift/editor/signals";
import { trackRunLayouts } from "@shift/editor/tools";
import type { TextRunNode } from "@shift/editor/types";
import { rect } from "@/testing/fixtures";
import { startEditorWith } from "@/testing/fontFixture";
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

/** The canvas text run node, for the subject calls below. */
function runNode(editor: Editor): TextRunNode {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- the text run node the TextRunNodeDefinition subject calls take
  const node = editor.scene.nodes().find((candidate) => candidate.kind === "textRun");
  if (!node) throw new Error("Expected a text run");
  return node as TextRunNode;
}

/**
 * Scales each selected run glyph twice over from its own bottom-left, through
 * the run's transform target. No resize handle shows for several run glyphs
 * selected at the run level, so this drives the subject directly.
 */
function scaleRunGlyphsTwice(editor: Editor): void {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- the run's transform target is the subject; no resize handle shows for several run glyphs
  const edit = editor.transformTarget()!.begin("scale");
  edit.preview(({ bounds }) =>
    Mat.Compose(
      Mat.Translate(bounds.left, bounds.bottom),
      Mat.Compose(Mat.Scale(2, 2), Mat.Translate(-bounds.left, -bounds.bottom)),
    ),
  );
  edit.commit();
}

/** The caret the text run node definition maps `point`, in the run's units, to. */
function caretAt(editor: Editor, point: LocalPoint): number | null {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- TextRunNodeDefinition.caretAt is the subject
  return editor.nodeDefinition("textRun").caretAt(runNode(editor), point);
}

/** The run-local point a scene point lands on. */
function runLocal(editor: Editor, x: number): LocalPoint {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- maps a scene point into the run node for the caretAt subject call
  return editor.toLocal(runNode(editor), scenePoint(x, 0));
}

/**
 * Subject tests of `Text`'s layout cells and the text run node: when a layout
 * is rebuilt, what keeps a run's edited child in step with its items, and
 * caret hits in a scaled run, which no user can make yet.
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

  it("read a run's current layout without subscribing", async () => {
    const editor = await startTestEditor();
    editor.selectTool("text");

    const before = canvasText(editor);
    expect(before).toEqual(editor.canvasText());

    caretToStart(editor);
    editor.typeText("A");
    expect(canvasText(editor).glyphs).toHaveLength(before.glyphs.length + 1);
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
  it("scales each glyph from its own edge, and a component follows its scaled base once", async () => {
    const editor = await startEditorWith({
      glyphs: {
        B: { unicode: 66, outline: { advance: 500, contours: [rect(100, 100, 200, 200)] } },
        A: { outline: { components: [{ glyph: "B" }] } },
      },
    });
    await pasteAfterEditedGlyph(editor, "B");
    editor.select([]);
    await editor.pressKey("Escape");
    await editor.settle();

    editor.selectAll();
    scaleRunGlyphsTwice(editor.asEditor());
    await editor.settle();

    const b = await editor.drawnGlyph("B");
    expect(b.sidebearings).toEqual({ lsb: 100, rsb: 200 });
    expect(b.advanceWidth).toBe(700);
    const [component] = (await editor.layerOf("A")).components;
    expect(component?.transformation).toMatchObject({ xx: 1, yy: 1, dx: 0, dy: 0 });
    await editor.close();
  });

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

  it("maps a point in a scaled run to its caret position", async () => {
    const editor = await startTestEditor();
    caretToStart(editor);
    editor.typeText("A");
    editor.setTextSize(editor.metrics().unitsPerEm * 2);
    const advance = canvasText(editor).advance / 2;

    expect(caretAt(editor.asEditor(), localPoint(advance * 1.75, 0))).toBe(2);
    expect(caretAt(editor.asEditor(), runLocal(editor.asEditor(), advance * 3.5))).toBe(2);
    expect(caretAt(editor.asEditor(), localPoint(advance * 10, 0))).toBeNull();
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
