import { describe, expect, it } from "vitest";
import type { TextRunNode } from "@shift/editor/types";
import { TestEditor } from "@/testing/TestEditor";
import { createLayerTree } from "./createLayerTree";

/** Places a text box showing `text` on the active page. */
function addBox(editor: TestEditor, text: string): TextRunNode {
  return editor.scene.createNode<TextRunNode>({
    kind: "textRun",
    runId: editor.text.createRun(editor.text.itemsFromText(text)).id,
    size: 72,
    width: { kind: "hug" },
    height: { kind: "hug" },
    rotation: 0,
    verticalAlign: "top",
    position: { x: 0, y: 0 },
  });
}

describe("the Layers section", () => {
  it("lists the page's text boxes by their text, in drawing order", async () => {
    const editor = await new TestEditor().startSession();
    editor.pages.activate(editor.pages.create().id);
    const first = addBox(editor, "AA");
    const empty = addBox(editor, "");

    const layers = createLayerTree(
      editor,
      editor.scene.activePageIdCell.peek(),
      editor.scene.structureCell.peek(),
    );

    expect(layers.label).toBe("Layers");
    expect(layers.items).toMatchObject([
      { id: first.id, icon: "text", label: "AA", children: [] },
      { id: empty.id, icon: "text", label: "Text", children: [] },
    ]);
  });
});
