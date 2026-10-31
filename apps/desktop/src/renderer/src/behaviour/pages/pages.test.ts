import { describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface, PageListing } from "@/testing/surface";

function pageNames(editor: EditorTestSurface): string[] {
  return editor.pageList().map((page) => page.name);
}

function firstPage(editor: EditorTestSurface): PageListing {
  const page = editor.pageList()[0];
  if (!page) throw new Error("Expected a page");
  return page;
}

/** The node id of the glyph the canvas edits, or null. */
function openGlyphNodeId(editor: EditorTestSurface): string | null {
  return editor.editorView().glyph?.nodeId ?? null;
}

describe("pages hold the scene, one page shown at a time", () => {
  // The open glyph, A, is edited on the glyph view's page.
  const editor = useTestEditor();

  it("lists Page 1, and opens the glyph on the glyph view's page, which the list leaves out", () => {
    const page = firstPage(editor);
    const glyphView = editor.shownPage();

    expect(pageNames(editor)).toEqual(["Page 1"]);
    expect(glyphView).toMatchObject({ role: "glyph" });
    expect(glyphView?.id).not.toBe(page.id);
    expect(editor.pageOf(openGlyphNodeId(editor)!)).toEqual(glyphView);
    expect(editor.pageOf(page.id)).toEqual(page);
  });

  it("adds pages after the last one without showing them", () => {
    const shown = editor.shownPage();

    editor.addPage();
    const named = editor.addPage("Proofs");

    expect(pageNames(editor)).toEqual(["Page 1", "Page 2", "Proofs"]);
    expect(named).toMatchObject({ name: "Proofs", role: null });
    expect(editor.shownPage()).toEqual(shown);
  });

  it("renames a page and ignores a blank name", () => {
    const page = firstPage(editor);

    editor.renamePage(page.id, "  Waterfall ");
    editor.renamePage(page.id, "   ");

    expect(pageNames(editor)).toEqual(["Waterfall"]);
  });

  it("moves a page to a new position in the list", () => {
    const pages = Array.from({ length: 11 }, (_, index) => editor.addPage(`P${index + 2}`));

    editor.movePage(pages[10]!.id, 0);
    editor.movePage(firstPage(editor).id, 2);

    expect(pageNames(editor).slice(0, 4)).toEqual(["Page 1", "P2", "P12", "P3"]);
    expect(pageNames(editor)).toHaveLength(12);
  });

  it("refuses to delete the last page", () => {
    const page = firstPage(editor);

    expect(editor.deletePage(page.id)).toBe(false);
    expect(editor.pageList()).toEqual([page]);
  });

  it("deletes a page with everything on it and shows its neighbour", async () => {
    const page = firstPage(editor);
    editor.showPage(page.id);
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    const second = editor.addPage();

    expect(editor.deletePage(page.id)).toBe(true);

    expect(editor.pageList()).toEqual([second]);
    expect(editor.shownPage()).toEqual(second);
    expect(editor.page(page.id)).toBeNull();
    expect(editor.canvasText()).toBeNull();
  });

  it("undoes and redoes each page edit as one step", async () => {
    const page = firstPage(editor);
    editor.showPage(page.id);
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    const second = editor.addPage();
    editor.renamePage(second.id, "Spacing");
    editor.deletePage(page.id);

    await editor.undo();
    expect(pageNames(editor)).toEqual(["Page 1", "Spacing"]);
    editor.showPage(page.id);
    expect(editor.canvasText()).toMatchObject({ items: [expect.anything()] });

    await editor.undo();
    expect(pageNames(editor)).toEqual(["Page 1", "Page 2"]);
    await editor.undo();
    expect(pageNames(editor)).toEqual(["Page 1"]);

    await editor.redo();
    await editor.redo();
    expect(pageNames(editor)).toEqual(["Page 1", "Spacing"]);
  });

  it("does not record switching pages as an undo step", async () => {
    const page = firstPage(editor);
    const second = editor.addPage();
    editor.showPage(second.id);
    editor.showPage(page.id);

    await editor.undo();

    expect(editor.pageList()).toEqual([page]);
    expect(editor.shownPage()).toEqual(page);
  });

  it("shows only the shown page's nodes", async () => {
    const page = firstPage(editor);
    await editor.addGlyph("B", 66);
    await editor.openGlyph("B");
    const glyphView = editor.shownPage();

    expect(editor.editorView()).toMatchObject({ glyph: { name: "B" } });
    expect(editor.canvasText()).not.toBeNull();

    editor.showPage(page.id);

    expect(editor.editorView().glyph).toBeNull();
    expect(editor.canvasText()).toBeNull();

    editor.showPage(glyphView!.id);

    expect(editor.editorView()).toMatchObject({ glyph: { name: "B" } });
  });

  it("opens glyphs on the glyph view's page whichever page is shown, leaving pages alone", async () => {
    const glyphView = editor.shownPage();
    await editor.addGlyph("B", 66);
    const second = editor.addPage();
    editor.showPage(second.id);

    await editor.openGlyph("B");

    expect(editor.shownPage()).toEqual(glyphView);
    expect(editor.editorView()).toMatchObject({ glyph: { name: "B" } });
    expect(editor.pageOf(openGlyphNodeId(editor)!)).toEqual(glyphView);

    editor.showPage(second.id);
    expect(editor.canvasText()).toBeNull();
  });

  it("remembers each page's camera for the session", () => {
    const page = firstPage(editor);
    editor.showPage(page.id);
    const second = editor.addPage();
    editor.setZoom(2);

    editor.showPage(second.id);
    editor.setZoom(3);
    editor.showPage(page.id);

    expect(editor.zoomLevel()).toBe(2);
  });
});

describe("Text tool on an empty page", () => {
  const editor = useTestEditor();

  const showEmptyPage = () => editor.showPage(editor.addPage().id);

  it("places an empty run in view with a caret, so typing can start", () => {
    showEmptyPage();

    editor.selectTool("text");

    expect(editor.canvasText()).toMatchObject({ items: [], caret: { position: 0 } });
    expect(editor.toolState()).toEqual({ id: "text", state: "editing" });
  });

  it("removes the run again when nothing was typed", async () => {
    showEmptyPage();

    editor.selectTool("text");
    await editor.pressKey("Escape");

    expect(editor.canvasText()).toBeNull();
  });

  it("keeps the run once something is typed into it", async () => {
    showEmptyPage();

    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");

    expect(editor.canvasText()).toMatchObject({ items: [expect.anything()] });
  });
});
