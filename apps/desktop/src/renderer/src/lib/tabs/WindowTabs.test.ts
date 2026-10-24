import { beforeEach, describe, expect, it } from "vitest";
import type { GlyphId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { GLYPHS_TAB_ID, WindowTabs } from "./WindowTabs";

async function addGlyph(editor: TestEditor, name: string, unicode: number): Promise<GlyphId> {
  await editor.addGlyph(name, unicode);
  const record = editor.font.recordForName(name);
  if (!record) throw new Error(`Expected glyph ${name}`);
  return record.id;
}

describe("window tabs", () => {
  let editor: TestEditor;
  let tabs: WindowTabs;
  let glyphA: GlyphId;
  let glyphB: GlyphId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    tabs = new WindowTabs(editor);
    glyphA = await addGlyph(editor, "tab.one", 0xe000);
    glyphB = await addGlyph(editor, "tab.two", 0xe001);
  });

  const open = (glyphId: GlyphId) => editor.history.withoutRecording(() => tabs.openGlyph(glyphId));
  const glyphTabs = () => tabs.tabsCell.peek().filter((tab) => tab.kind === "glyph");

  it("starts with only the font overview", () => {
    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([GLYPHS_TAB_ID]);
  });

  it("opens each glyph in a tab of its own, and shows one already open there", () => {
    const first = open(glyphA);
    open(glyphB);
    const again = open(glyphA);

    expect(glyphTabs().map((tab) => tab.kind === "glyph" && tab.glyphId)).toEqual([glyphA, glyphB]);
    expect([first.placed, again.placed]).toEqual([true, false]);
    expect(editor.pages.activeCell.peek()).toBe(glyphTabs()[0]!.pageId);
  });

  it("selects a glyph on the overview's own page, which is no tab", () => {
    editor.history.withoutRecording(() => tabs.selectGlyph(glyphA));
    const selectionPage = editor.pages.activeCell.peek();
    const page = tabs.openPage(editor.pages.list[0]!.id);
    editor.pages.activate(page.kind === "page" ? page.pageId : selectionPage!);

    tabs.showSelection();

    expect(tabs.selectedGlyphCell.peek()).toBe(glyphA);
    expect(editor.pages.activeCell.peek()).toBe(selectionPage);
    expect(editor.scene.nodesOfKind("glyph").map((node) => node.glyphId)).toEqual([glyphA]);
    expect(glyphTabs()).toEqual([]);
  });

  it("gives a page one tab however often it is opened", () => {
    const page = editor.pages.list[0]!;

    tabs.openPage(page.id);
    tabs.openPage(page.id);

    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(1);
    expect(tabs.activeTab({ kind: "canvas", pageId: page.id })).toMatchObject({ pageId: page.id });
  });

  it("follows a page into the shown page tab, as a browser follows a link", () => {
    const first = editor.pages.list[0]!;
    const second = editor.pages.create();
    const shown = tabs.openPage(first.id);

    const next = tabs.navigateToPage(second.id, shown);

    expect(next).toMatchObject({ id: shown.id, pageId: second.id });
    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(1);
  });

  it("gives a page its own tab from the overview, a glyph tab, or when asked for a new tab", () => {
    const first = editor.pages.list[0]!;
    const second = editor.pages.create();
    const third = editor.pages.create();
    const overview = tabs.tabsCell.peek()[0]!;

    const fromOverview = tabs.navigateToPage(first.id, overview);
    open(glyphA);
    const fromGlyph = tabs.navigateToPage(second.id, glyphTabs()[0]!);
    const asked = tabs.navigateToPage(third.id, fromGlyph, true);

    expect(
      [fromOverview, fromGlyph, asked].map((tab) => tab.kind === "page" && tab.pageId),
    ).toEqual([first.id, second.id, third.id]);
    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(3);
  });

  it("shows a page that already has a tab there, so no page has two", () => {
    const first = editor.pages.list[0]!;
    const second = editor.pages.create();
    const firstTab = tabs.openPage(first.id);
    const secondTab = tabs.openPage(second.id);

    expect(tabs.navigateToPage(first.id, secondTab)).toEqual(firstTab);
    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(2);
  });

  it("closes a glyph tab with its page and returns the neighbour to show", () => {
    const page = tabs.openPage(editor.pages.list[0]!.id);
    open(glyphA);
    const glyphTab = glyphTabs()[0]!;

    const next = tabs.close(glyphTab.id);

    expect(next).toEqual(page);
    expect(glyphTabs()).toEqual([]);
    expect(glyphTab.kind === "glyph" && editor.scene.node(glyphTab.pageId)).toBeNull();
  });

  it("closes a page's tab when the page is deleted, and never the overview", () => {
    const second = editor.pages.create();
    tabs.openPage(second.id);

    editor.pages.delete(second.id);
    tabs.close(GLYPHS_TAB_ID);

    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([GLYPHS_TAB_ID]);
  });
});
