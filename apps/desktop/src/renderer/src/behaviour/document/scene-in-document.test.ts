import { describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

/** The user's pages, by name. */
function pageNames(editor: EditorTestSurface): string[] {
  return editor.pageList().map((page) => page.name);
}

/** Shows the page and returns the text on it, or null with none. */
function textOn(editor: EditorTestSurface, pageId: string): string | null {
  editor.showPage(pageId);
  const text = editor.canvasText();
  return text ? text.items.map((item) => item.text).join("") : null;
}

/** Undoes the latest edit and waits for the workspace to keep it. */
async function undo(editor: EditorTestSurface): Promise<void> {
  await editor.undo();
  await editor.settle();
}

/** Adds a page named `name`, shows it, types `text` into a new run on it, and returns the page's id. */
async function typeOnNewPage(
  editor: EditorTestSurface,
  name: string,
  text: string,
): Promise<string> {
  const page = editor.addPage(name);
  editor.showPage(page.id);
  editor.selectTool("text");
  editor.typeText(text);
  await editor.pressKey("Escape");
  editor.selectTool("select");
  await editor.settle();
  return page.id;
}

describe("the scene is part of the document", () => {
  const editor = useTestEditor();

  it("undoes scene and font edits in the order they were made, in one history", async () => {
    const { corner } = await editor.draw({
      contours: [{ closed: true, points: [{ x: 0, y: 0, name: "corner" }, [100, 0], [100, 100]] }],
    });
    const glyphPage = editor.shownPageId()!;
    const page = editor.addPage("Proofs");
    await editor.settle();
    await editor.dragPoint(corner, { x: 10, y: 0 });
    editor.renamePage(page.id, "Specimen");
    await editor.settle();

    // Each undo shows the page its edit changed: the renamed page, then the glyph's.
    await undo(editor);
    expect(pageNames(editor)).toEqual(["Page 1", "Proofs"]);
    expect(editor.shownPageId()).toBe(page.id);

    await undo(editor);
    expect(editor.shownPageId()).toBe(glyphPage);
    expect(await editor.point(corner)).toMatchObject({ x: 0, y: 0 });
    expect(pageNames(editor)).toEqual(["Page 1", "Proofs"]);

    await undo(editor);
    expect(pageNames(editor)).toEqual(["Page 1"]);

    await editor.redo();
    await editor.redo();
    await editor.redo();
    await editor.settle();
    expect(pageNames(editor)).toEqual(["Page 1", "Specimen"]);
    editor.showPage(glyphPage);
    expect(await editor.point(corner)).toMatchObject({ x: 10, y: 0 });
  });

  it("leaves the document unsaved after a scene edit, and clean once it is undone", async () => {
    await editor.save();

    editor.addPage("Proofs");
    await expect(editor.documentState()).resolves.toMatchObject({ dirty: true });

    await undo(editor);
    await expect(editor.documentState()).resolves.toMatchObject({ dirty: false });
  });

  it("keeps two pages and the text on each when the document is saved and reopened", async () => {
    const proofs = await typeOnNewPage(editor, "Proofs", "AB");
    const specimen = await typeOnNewPage(editor, "Specimen", "BA");
    await editor.openGlyph("A");
    await editor.save();

    const reopened = await editor.reopen();
    try {
      await expect(reopened.documentState()).resolves.toMatchObject({ dirty: false });
      expect(pageNames(reopened)).toEqual(["Page 1", "Proofs", "Specimen"]);
      expect(textOn(reopened, proofs)).toBe("AB");
      expect(textOn(reopened, specimen)).toBe("BA");
    } finally {
      await reopened.close();
    }
  });
});
