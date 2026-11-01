import { describe, expect, it } from "vitest";
import { asNodeId, type GlyphId } from "@shift/types";
import { signal } from "@shift/editor/signals";
import { screenVector } from "@shift/editor/spaces";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { DocumentViews } from "@/lib/workspace/documentViews";
import { WindowTabs } from "./WindowTabs";
import { WindowViewMemory } from "./WindowViewMemory";

const DOCUMENT = "doc-1";

function memoryStorage(): () => Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
  return () => storage;
}

/** A window's tabs over `surface` and their view memory in `views`, already restored. */
function rememberedWindow(surface: EditorTestSurface, views: DocumentViews) {
  const tabs = new WindowTabs(surface.asEditor());
  const memory = new WindowViewMemory(surface.asEditor(), tabs, {
    keyCell: signal<string | null>(DOCUMENT),
    views,
  });
  memory.restore();
  return { tabs, memory };
}

/** The window's page and glyph tabs as plain data, without their session ids. */
function tabsOf(tabs: WindowTabs): unknown[] {
  return tabs.view().tabs.map((tab) => ({ ...tab }));
}

describe("window tabs reopen with the window", () => {
  const editor = useTestEditor();

  it("restores the open tabs, in order, and the shown page", async () => {
    const views = new DocumentViews(memoryStorage());
    const first = rememberedWindow(editor, views);
    await editor.addGlyph("B", 66);
    const page = editor.addPage("Proofs");
    first.tabs.openPage(asNodeId(page.id));
    const glyphTab = first.tabs.openGlyph(editor.glyphNamed("B")!.id);
    first.tabs.move(first.tabs.tabsCell.peek().at(-1)!.id, 0);
    editor.showPage(page.id);
    const before = tabsOf(first.tabs);
    first.memory.flush();
    expect(glyphTab.placed).toBe(true);

    // A window reloaded over the same document: its tabs start empty, then reopen.
    editor.showPage(editor.pageList()[0]!.id);
    const reopened = rememberedWindow(editor, views);

    expect(tabsOf(reopened.tabs)).toEqual(before);
    expect(editor.shownPageId()).toBe(page.id);
  });

  it("reopens each page's camera, a glyph page's too, without refitting the glyph", async () => {
    const views = new DocumentViews(memoryStorage());
    const first = rememberedWindow(editor, views);
    await editor.addGlyph("B", 66);
    const page = editor.addPage("Proofs");
    first.tabs.openPage(asNodeId(page.id));
    editor.showPage(page.id);
    editor.setZoom(2);
    editor.panBy(screenVector(40, 60));
    const pageCamera = { zoom: editor.zoomLevel(), offset: editor.canvasOffset() };
    first.tabs.openGlyph(editor.glyphNamed("B")!.id);
    editor.setZoom(3);
    editor.panBy(screenVector(-20, 10));
    const glyphCamera = { zoom: editor.zoomLevel(), offset: editor.canvasOffset() };
    first.memory.flush();

    // A window reloaded over the same document, its view reset.
    editor.showPage(editor.pageList()[0]!.id);
    editor.setZoom(1);
    const reopened = rememberedWindow(editor, views);

    expect(editor.shownPageId()).toBe(first.tabs.glyphTab(editor.glyphNamed("B")!.id)!.pageId);
    expect({ zoom: editor.zoomLevel(), offset: editor.canvasOffset() }).toEqual(glyphCamera);
    expect(reopened.tabs.openGlyph(editor.glyphNamed("B")!.id).placed).toBe(false);
    editor.showPage(page.id);
    expect({ zoom: editor.zoomLevel(), offset: editor.canvasOffset() }).toEqual(pageCamera);
  });

  it("drops the camera of a page that no longer exists", () => {
    const views = new DocumentViews(memoryStorage());
    const page = asNodeId(editor.addPage().id);
    const gone = asNodeId("node_gone");
    const camera = { pan: { x: 10, y: 20 }, zoom: 2 };
    views.write(DOCUMENT, { cameras: { [page]: camera, [gone]: camera } });

    rememberedWindow(editor, views).memory.flush();

    expect(Object.keys(views.read(DOCUMENT)?.cameras ?? {})).not.toContain(gone);
    expect(views.read(DOCUMENT)?.cameras?.[page]).toEqual(camera);
  });

  it("does not mark the document unsaved when tabs or pages switch", async () => {
    const { tabs, memory } = rememberedWindow(editor, new DocumentViews(memoryStorage()));
    const page = editor.addPage();
    tabs.openPage(asNodeId(page.id));
    await editor.save();
    const glyphPage = editor.shownPageId()!;

    editor.showPage(page.id);
    tabs.move(tabs.tabsCell.peek().at(-1)!.id, 0);
    editor.showPage(glyphPage);
    memory.flush();
    await new Promise((resolve) => setTimeout(resolve, 700));

    await expect(editor.documentState()).resolves.toMatchObject({ dirty: false });
  });

  it("drops a tab whose glyph is no longer in the font", () => {
    const views = new DocumentViews(memoryStorage());
    const page = editor.addPage();
    views.write(DOCUMENT, {
      tabs: [
        { kind: "page", pageId: asNodeId(page.id) },
        { kind: "glyph", pageId: asNodeId(page.id), glyphId: "glyph_gone" as GlyphId },
      ],
    });

    const { tabs } = rememberedWindow(editor, views);

    expect(tabsOf(tabs)).toEqual([{ kind: "page", pageId: page.id }]);
  });
});
