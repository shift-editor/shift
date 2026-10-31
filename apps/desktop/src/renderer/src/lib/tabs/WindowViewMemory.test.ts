import { describe, expect, it } from "vitest";
import { asNodeId, type GlyphId } from "@shift/types";
import { signal } from "@shift/editor/signals";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { DocumentViews } from "@/lib/workspace/documentViews";
import { windowTabs } from "./WindowTabs";
import { WindowViewMemory } from "./WindowViewMemory";

const DOCUMENT = "doc-1";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

function storageOf(
  storage: Pick<Storage, "getItem" | "setItem">,
): () => Pick<Storage, "getItem" | "setItem"> {
  return () => storage;
}

/** A window's view memory over `surface`, kept in `views`, already restored. */
function rememberedWindow(surface: EditorTestSurface, views: DocumentViews): WindowViewMemory {
  const memory = new WindowViewMemory(surface.asEditor(), {
    keyCell: signal<string | null>(DOCUMENT),
    views,
  });
  memory.restore();
  return memory;
}

/** The window's tabs after the overview, as plain data. */
function tabsOf(surface: EditorTestSurface): unknown[] {
  return windowTabs(surface.asEditor())
    .view()
    .tabs.map((tab) => ({ ...tab }));
}

describe("window tabs reopen with the document", () => {
  const editor = useTestEditor();

  it("restores the open tabs, in order, and the shown page", async () => {
    const views = new DocumentViews(storageOf(memoryStorage()));
    const memory = rememberedWindow(editor, views);
    await editor.addGlyph("B", 66);
    const glyphB = editor.glyphNamed("B")!.id;
    const page = editor.addPage("Proofs");
    const tabs = windowTabs(editor.asEditor());
    tabs.openPage(asNodeId(page.id));
    tabs.openGlyph(glyphB);
    editor.showPage(page.id);
    const before = tabsOf(editor);
    memory.flush();

    const reopened = await editor.reopen();
    rememberedWindow(reopened, views);

    expect(tabsOf(reopened)).toEqual(before);
    expect(reopened.shownPage()).toMatchObject({ id: page.id, name: "Proofs" });
    await reopened.close();
  });

  it("does not mark the document unsaved when tabs or pages switch", async () => {
    const memory = rememberedWindow(editor, new DocumentViews(storageOf(memoryStorage())));
    const page = editor.addPage();
    const tabs = windowTabs(editor.asEditor());
    tabs.openPage(asNodeId(page.id));
    await editor.save();
    const glyphView = editor.shownPage()!;

    editor.showPage(page.id);
    editor.showPage(glyphView.id);
    memory.flush();
    await new Promise((resolve) => setTimeout(resolve, 700));

    await expect(editor.documentState()).resolves.toMatchObject({ dirty: false });
  });

  it("drops a tab whose glyph is no longer in the font", async () => {
    const storage = memoryStorage();
    const views = new DocumentViews(storageOf(storage));
    const page = editor.addPage();
    views.write(DOCUMENT, {
      tabs: [
        { kind: "page", pageId: asNodeId(page.id) },
        { kind: "glyph", pageId: asNodeId(page.id), glyphId: "glyph_gone" as GlyphId },
      ],
    });

    rememberedWindow(editor, views);

    expect(tabsOf(editor)).toEqual([{ kind: "page", pageId: page.id }]);
  });
});
