import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { createLayerTree } from "./createLayerTree";

describe("the Layers section", () => {
  it("lists the page's boxes by their text or name, nesting a frame's children", async () => {
    const editor = await new TestEditor().startSession();
    editor.pages.activate(editor.pages.create().id);
    const frame = editor.frames.create(null, { name: "Hero" })!;
    const inFrame = editor.frames.addText(frame.id, "AA")!;
    const empty = editor.frames.addText(null, "")!;

    const layers = createLayerTree(
      editor,
      editor.scene.activePageIdCell.peek(),
      editor.scene.structureCell.peek(),
    );

    expect(layers.label).toBe("Layers");
    expect(layers.items).toMatchObject([
      {
        id: frame.id,
        icon: "frame",
        label: "Hero",
        children: [{ id: inFrame.id, icon: "text", label: "AA" }],
      },
      { id: empty.id, icon: "text", label: "Text", children: [] },
    ]);
  });
});
