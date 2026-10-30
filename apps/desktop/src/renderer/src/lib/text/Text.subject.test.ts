import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import type { Editor } from "@shift/editor";
import { localPoint, scenePoint, type LocalPoint } from "@shift/editor/spaces";
import type { TextRunNode } from "@shift/editor/types";
import { rect } from "@/testing/fixtures";
import { startEditorWith } from "@/testing/fontFixture";
import { startTestEditor } from "@/testing/TestEditor";

/** The canvas text run node, for the subject calls below. */
function runNode(editor: Editor): TextRunNode {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- the text run node the TextRunNodeDefinition subject calls take
  const node = editor.scene.nodes().find((candidate) => candidate.kind === "textRun");
  if (!node) throw new Error("Expected a text run");
  return node as TextRunNode;
}

/**
 * The canvas text run's layout as `Text.layout` reads it without subscribing,
 * and the layout its cell holds now, for the `Text` subject calls.
 */
function layoutReads(editor: Editor): { read: unknown; held: unknown } {
  const { runId } = runNode(editor);
  return {
    // oxlint-disable-next-line shift/no-editor-internals-in-tests -- Text.layout, the untracked read, is the subject
    read: editor.text.layout(runId),
    // oxlint-disable-next-line shift/no-editor-internals-in-tests -- the layout cell Text.layout must read through
    held: editor.text.layoutCell(runId).peek(),
  };
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
 * Subject tests of `Text.layout` and the text run node definition: APIs no
 * user gesture reaches, driven through the `Editor` the surface hands out.
 * The editor still comes from the desktop harness, since the cases need the
 * workspace and shaping a memory session lacks.
 */
describe("Text layout cells", () => {
  it("read a run's current layout without subscribing", async () => {
    const editor = await startTestEditor();
    editor.selectTool("text");

    const before = editor.canvasText()!;
    const { read, held } = layoutReads(editor.asEditor());
    expect(read).toBe(held);

    editor.moveCaret(-1, "line");
    editor.typeText("A");
    expect(editor.canvasText()!.glyphs).toHaveLength(before.glyphs.length + 1);
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
    editor.selectTool("text");
    editor.pasteText("B");
    await editor.pressKey("Escape");
    await editor.settle();
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

  it("maps a point in a scaled run to its caret position", async () => {
    const editor = await startTestEditor();
    editor.selectTool("text");
    editor.moveCaret(-1, "line");
    editor.typeText("A");
    editor.setTextSize(editor.metrics().unitsPerEm * 2);
    const advance = editor.canvasText()!.advance / 2;

    expect(caretAt(editor.asEditor(), localPoint(advance * 1.75, 0))).toBe(2);
    expect(caretAt(editor.asEditor(), runLocal(editor.asEditor(), advance * 3.5))).toBe(2);
    expect(caretAt(editor.asEditor(), localPoint(advance * 10, 0))).toBeNull();
    await editor.close();
  });
});
