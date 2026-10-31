import { beforeEach, describe, expect, it } from "vitest";
import { asNodeId, type GlyphId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import { GLYPHS_TAB_ID, WindowTabs } from "./WindowTabs";

describe("window tabs", () => {
  const editor = useTestEditor();
  let tabs: WindowTabs;
  let glyphA: GlyphId;
  let glyphB: GlyphId;

  beforeEach(async () => {
    tabs = new WindowTabs(editor.asEditor());
    await editor.addGlyph("tab.one", 0xe000);
    await editor.addGlyph("tab.two", 0xe001);
    glyphA = editor.glyphNamed("tab.one")!.id;
    glyphB = editor.glyphNamed("tab.two")!.id;
  });

  const glyphTabs = () => tabs.tabsCell.peek().filter((tab) => tab.kind === "glyph");
  const firstPageId = () => asNodeId(editor.pageList()[0]!.id);
  const addPageId = () => asNodeId(editor.addPage().id);

  it("starts with only the font overview", () => {
    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([GLYPHS_TAB_ID]);
  });

  it("opens each glyph in a tab of its own, and shows one already open there", () => {
    const first = tabs.openGlyph(glyphA);
    tabs.openGlyph(glyphB);
    const again = tabs.openGlyph(glyphA);

    expect(glyphTabs().map((tab) => tab.kind === "glyph" && tab.glyphId)).toEqual([glyphA, glyphB]);
    expect([first.placed, again.placed]).toEqual([true, false]);
    expect(editor.shownPage()?.id).toBe(glyphTabs()[0]!.pageId);
  });

  it("records no undo step for opening a glyph", async () => {
    tabs.openGlyph(glyphA);
    const shown = editor.shownPage();

    await editor.undo();

    expect(editor.shownPage()).toEqual(shown);
    expect(editor.editorView().glyph?.name).toBe("tab.one");
  });

  it("selects a glyph on the overview's own page, which is no tab", () => {
    tabs.selectGlyph(glyphA);
    const selectionPage = editor.shownPage();
    tabs.openPage(firstPageId());
    editor.showPage(firstPageId());

    tabs.showSelection();

    expect(tabs.selectedGlyphCell.peek()).toBe(glyphA);
    expect(editor.shownPage()).toEqual(selectionPage);
    expect(editor.editorView().glyph?.name).toBe("tab.one");
    expect(glyphTabs()).toEqual([]);
  });

  it("gives a page one tab however often it is opened", () => {
    const pageId = firstPageId();

    tabs.openPage(pageId);
    tabs.openPage(pageId);

    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(1);
    expect(tabs.activeTab({ kind: "canvas", pageId })).toMatchObject({ pageId });
  });

  it("follows a page into the shown page tab, as a browser follows a link", () => {
    const first = firstPageId();
    const second = addPageId();
    const shown = tabs.openPage(first);

    const next = tabs.navigateToPage(second, shown);

    expect(next).toMatchObject({ id: shown.id, pageId: second });
    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(1);
  });

  it("gives a page its own tab from the overview, a glyph tab, or when asked for a new tab", () => {
    const first = firstPageId();
    const second = addPageId();
    const third = addPageId();
    const overview = tabs.tabsCell.peek()[0]!;

    const fromOverview = tabs.navigateToPage(first, overview);
    tabs.openGlyph(glyphA);
    const fromGlyph = tabs.navigateToPage(second, glyphTabs()[0]!);
    const asked = tabs.navigateToPage(third, fromGlyph, true);

    expect(
      [fromOverview, fromGlyph, asked].map((tab) => tab.kind === "page" && tab.pageId),
    ).toEqual([first, second, third]);
    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(3);
  });

  it("shows a page that already has a tab there, so no page has two", () => {
    const first = firstPageId();
    const second = addPageId();
    const firstTab = tabs.openPage(first);
    const secondTab = tabs.openPage(second);

    expect(tabs.navigateToPage(first, secondTab)).toEqual(firstTab);
    expect(tabs.tabsCell.peek().filter((tab) => tab.kind === "page")).toHaveLength(2);
  });

  it("closes a glyph tab with its page and returns the neighbour to show", () => {
    const page = tabs.openPage(firstPageId());
    tabs.openGlyph(glyphA);
    const glyphTab = glyphTabs()[0]!;

    const next = tabs.close(glyphTab.id);

    expect(next).toEqual(page);
    expect(glyphTabs()).toEqual([]);
    expect(glyphTab.kind === "glyph" && editor.page(glyphTab.pageId)).toBeNull();
  });

  it("closes a page's tab when the page is deleted, and never the overview", () => {
    const second = addPageId();
    tabs.openPage(second);

    editor.deletePage(second);
    tabs.close(GLYPHS_TAB_ID);

    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([GLYPHS_TAB_ID]);
  });
});
