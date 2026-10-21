import { localPoint } from "@shift/editor/spaces";
import { beforeEach, describe, expect, it } from "vitest";
import { mintNodeId, type GlyphId } from "@shift/types";
import type { PageNode, TextRunNode } from "@shift/editor/types";
import { effect } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

function pageNames(editor: TestEditor): string[] {
  return editor.pages.list.map((page) => page.name);
}

function firstPage(editor: TestEditor): PageNode {
  const page = editor.pages.list[0];
  if (!page) throw new Error("Expected a page");
  return page;
}

async function addGlyph(editor: TestEditor, name: string, unicode: number): Promise<GlyphId> {
  await editor.addGlyph(name, unicode);
  const record = editor.font.recordForName(name);
  if (!record) throw new Error(`Expected glyph ${name}`);
  return record.id;
}

describe("pages hold the scene, one page shown at a time", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  it("starts with Page 1 holding the opened glyph's run", () => {
    const page = firstPage(editor);

    expect(pageNames(editor)).toEqual(["Page 1"]);
    expect(editor.pages.activeCell.peek()).toBe(page.id);
    expect(editor.pages.pageOf(editor.textRun!.id)).toBe(page);
    expect(editor.pages.pageOf(editor.runGlyph!.id)).toBe(page);
    expect(editor.pages.pageOf(page.id)).toBe(page);
  });

  it("adds pages after the last one without showing them", () => {
    const shown = editor.pages.activeCell.peek();

    editor.pages.create();
    const named = editor.pages.create("Proofs");

    expect(pageNames(editor)).toEqual(["Page 1", "Page 2", "Proofs"]);
    expect(named.parentId).toBeNull();
    expect(editor.pages.activeCell.peek()).toBe(shown);
  });

  it("publishes the list and the shown page to reactive readers", () => {
    const seen: string[][] = [];
    const shown: (string | null)[] = [];
    const listReader = effect(() => {
      seen.push(editor.pages.listCell.value.map((page) => page.name));
    });
    const activeReader = effect(() => {
      shown.push(editor.pages.activeCell.value);
    });

    const second = editor.pages.create();
    editor.history.capture("Select", () => editor.selection.clear());
    editor.pages.activate(second.id);
    listReader.dispose();
    activeReader.dispose();

    expect(seen).toEqual([["Page 1"], ["Page 1", "Page 2"]]);
    expect(shown).toEqual([firstPage(editor).id, second.id]);
  });

  it("renames a page and ignores a blank name", () => {
    const page = firstPage(editor);

    editor.pages.rename(page.id, "  Waterfall ");
    editor.pages.rename(page.id, "   ");

    expect(pageNames(editor)).toEqual(["Waterfall"]);
  });

  it("moves a page to a new position in the list", () => {
    const pages = Array.from({ length: 11 }, (_, index) => editor.pages.create(`P${index + 2}`));

    editor.pages.move(pages[10]!.id, 0);
    editor.pages.move(firstPage(editor).id, 2);

    expect(pageNames(editor).slice(0, 4)).toEqual(["Page 1", "P2", "P12", "P3"]);
    expect(pageNames(editor)).toHaveLength(12);
  });

  it("refuses to delete the last page", () => {
    const page = firstPage(editor);

    expect(editor.pages.delete(page.id)).toBe(false);
    expect(editor.pages.list).toEqual([page]);
    expect(editor.textRun).not.toBeNull();
  });

  it("deletes a page with everything on it and shows its neighbour", () => {
    const page = firstPage(editor);
    const run = editor.textRun!;
    const child = editor.runGlyph!;
    const second = editor.pages.create();

    expect(editor.pages.delete(page.id)).toBe(true);

    expect(editor.pages.list).toEqual([second]);
    expect(editor.pages.activeCell.peek()).toBe(second.id);
    expect(editor.scene.node(run.id)).toBeNull();
    expect(editor.scene.node(child.id)).toBeNull();
    expect(editor.text.run(run.runId)).toBeNull();
  });

  it("undoes and redoes each page edit as one step", async () => {
    const page = firstPage(editor);
    const run = editor.textRun!;
    const second = editor.pages.create();
    editor.pages.rename(second.id, "Spacing");
    editor.pages.delete(page.id);

    await editor.undo();
    expect(pageNames(editor)).toEqual(["Page 1", "Spacing"]);
    expect(editor.scene.node(run.id)).toEqual(run);
    expect(editor.text.run(run.runId)?.items).toHaveLength(1);

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
    const second = editor.pages.create();
    editor.pages.activate(second.id);
    editor.pages.activate(page.id);

    await editor.undo();

    expect(editor.pages.list).toEqual([page]);
    expect(editor.pages.activeCell.peek()).toBe(page.id);
  });

  it("draws and hits only the shown page's nodes", async () => {
    const page = firstPage(editor);
    const second = editor.pages.create();
    const glyphB = await addGlyph(editor, "B", 66);
    editor.pages.activate(second.id);
    const node = editor.openGlyph(glyphB);
    const [pointId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ]);
    const point = editor.toScene(node, localPoint(100, 100));

    expect(editor.getPointerTarget(point)).toMatchObject({ kind: "point", pointId });
    expect(editor.scene.nodes().map((candidate) => candidate.id)).toContain(node.id);

    editor.pages.activate(page.id);

    expect(editor.getPointerTarget(point).kind).toBe("canvas");
    expect(editor.scene.nodes().map((candidate) => candidate.id)).not.toContain(node.id);
  });

  it("opens a glyph into the shown page's run, creating it on an empty page", async () => {
    const page = firstPage(editor);
    const pageRun = editor.textRun!;
    const glyphB = await addGlyph(editor, "B", 66);
    const second = editor.pages.create();
    editor.pages.activate(second.id);

    const child = editor.openGlyph(glyphB);

    const run = editor.textRun!;
    expect(editor.pages.pageOf(run.id)).toBe(editor.scene.node(second.id));
    expect(child.glyphId).toBe(glyphB);
    expect(editor.editing.nodeIds).toEqual([child.id]);
    expect(editor.pages.pageOf(pageRun.id)).toBe(page);
    expect(editor.nodeDefinition("textRun").childGlyph(pageRun)?.glyphId).not.toBe(glyphB);
  });

  it("remembers each page's camera for the session", () => {
    const page = firstPage(editor);
    const second = editor.pages.create();
    editor.setZoom(2);
    editor.setPan({ x: 40, y: 60 });

    editor.pages.activate(second.id);
    editor.setPan({ x: -300, y: 10 });
    editor.pages.activate(page.id);

    expect(editor.zoom).toBe(2);
    expect(editor.pan).toEqual({ x: 40, y: 60 });
  });

  it("puts nodes written without a page onto Page 1", () => {
    const run = editor.textRun!;
    const loose: TextRunNode = { ...run, id: mintNodeId(), parentId: null, index: "a0" };

    editor.scene.setNodes([loose]);

    const page = firstPage(editor);
    expect(pageNames(editor)).toEqual(["Page 1"]);
    expect(editor.scene.node(loose.id)?.parentId).toBe(page.id);
    expect(editor.textRun?.id).toBe(loose.id);
  });
});
