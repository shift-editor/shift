import { describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

const editor = useTestEditor();

/** Shows the page and types `text` into its canvas run, as the Text tool does on an empty page. */
async function typeOnPage(surface: EditorTestSurface, pageId: string, text: string): Promise<void> {
  surface.showPage(pageId);
  surface.selectTool("text");
  surface.typeText(text);
  await surface.pressKey("Escape");
}

describe("pages reopen with their document", () => {
  it("keeps every page and the nodes on each", async () => {
    const first = editor.pageList()[0]!;
    editor.renamePage(first.id, "Waterfall");
    const second = editor.addPage("Proofs");
    await typeOnPage(editor, first.id, "A");
    await typeOnPage(editor, second.id, "AA");

    const reopened = await editor.reopen();

    expect(reopened.pageList()).toEqual([
      { id: first.id, name: "Waterfall", role: null },
      { id: second.id, name: "Proofs", role: null },
    ]);
    reopened.showPage(first.id);
    expect(reopened.canvasText()).toMatchObject({ items: [{ text: "A" }] });
    reopened.showPage(second.id);
    expect(reopened.canvasText()).toMatchObject({ items: [{ text: "A" }, { text: "A" }] });
    await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });
    await reopened.close();
  });
});
