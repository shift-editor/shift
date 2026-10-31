import { describe, expect, it } from "vitest";
import { screenVector } from "@shift/editor/spaces";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";
import type { PageEntry } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";

function pageNames(editor: EditorTestSurface): string[] {
  return editor.pageList().map((page) => page.name);
}

function firstPage(editor: EditorTestSurface): PageEntry {
  const page = editor.pageList()[0];
  if (!page) throw new Error("Expected a page");
  return page;
}

describe("pages hold the scene, one page shown at a time", () => {
  // The open glyph, A, is edited on its tab's glyph page, as the editor route opens it.
  const editor = useTestEditor();

  it("lists Page 1, and opens the glyph on a glyph page, which the list leaves out", () => {
    const page = firstPage(editor);
    const glyphPageId = editor.shownPageId();

    expect(pageNames(editor)).toEqual(["Page 1"]);
    expect(glyphPageId).not.toBeNull();
    expect(glyphPageId).not.toBe(page.id);
    expect(editor.pageExists(glyphPageId!)).toBe(true);
    expect(editor.editorView()).toMatchObject({ glyph: { name: "A" } });
  });

  it("adds pages after the last one without showing them", () => {
    const shown = editor.shownPageId();

    editor.addPage();
    const named = editor.addPage("Proofs");

    expect(pageNames(editor)).toEqual(["Page 1", "Page 2", "Proofs"]);
    expect(named).toMatchObject({ name: "Proofs" });
    expect(editor.shownPageId()).toEqual(shown);
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
    expect(editor.shownPageId()).toEqual(second.id);
    expect(editor.pageExists(page.id)).toBe(false);
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
    expect(editor.shownPageId()).toEqual(page.id);
  });

  it("draws and hits only the shown page's nodes", async () => {
    const page = firstPage(editor);
    const glyphPageId = editor.shownPageId()!;
    const { start } = await editor.draw({
      contours: [line({ x: 100, y: 100, name: "start" }, { x: 300, y: 100 })],
    });
    const point = editor.screenPosition({ x: 100, y: 100 });
    editor.selectTool("select");

    await editor.clickAtScreen(point);
    expect(editor.selectionIds()).toEqual([start]);

    await editor.pressKey("Escape");
    editor.showPage(page.id);
    await editor.clickAtScreen(point);

    expect(editor.selectionIds()).toEqual([]);
    expect(editor.editorView().glyph).toBeNull();
    expect(editor.canvasText()).toBeNull();

    editor.showPage(glyphPageId);

    expect(editor.editorView()).toMatchObject({ glyph: { name: "A" } });
  });

  it("opens a glyph on its own glyph page whichever page is shown, leaving pages alone", async () => {
    await editor.addGlyph("B", 66);
    const second = editor.addPage();
    editor.showPage(second.id);

    await editor.openGlyph("B");

    const glyphPageId = editor.shownPageId();
    expect(glyphPageId).not.toBe(second.id);
    expect(pageNames(editor)).toEqual(["Page 1", "Page 2"]);
    expect(editor.editorView()).toMatchObject({ glyph: { name: "B" } });

    editor.showPage(second.id);
    expect(editor.canvasText()).toBeNull();
  });

  it("remembers each page's camera for the session", () => {
    const page = firstPage(editor);
    editor.showPage(page.id);
    const second = editor.addPage();
    editor.setZoom(2);
    editor.panBy(screenVector(40, 60));
    const shown = { zoom: editor.zoomLevel(), offset: editor.canvasOffset() };

    editor.showPage(second.id);
    editor.setZoom(3);
    editor.panBy(screenVector(-300, 10));
    editor.showPage(page.id);

    expect({ zoom: editor.zoomLevel(), offset: editor.canvasOffset() }).toEqual(shown);
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
