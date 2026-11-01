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
    expect(editor.shownPageId()).toBe(glyphTabs()[0]!.pageId);
  });

  it("records no undo step for opening a glyph", async () => {
    tabs.openGlyph(glyphA);
    const glyphPage = editor.shownPageId()!;

    await editor.undo();

    // Undo took back the edit before the open, adding tab.two; the glyph's page stays.
    expect(editor.glyphNamed("tab.two")).toBeNull();
    expect(editor.pageExists(glyphPage)).toBe(true);
  });

  it("selects a glyph on the overview's own page, which is no tab", () => {
    tabs.selectGlyph(glyphA);
    tabs.showSelection();
    const selectionPage = editor.shownPageId();
    tabs.openPage(firstPageId());
    editor.showPage(firstPageId());

    tabs.showSelection();

    expect(tabs.selectedGlyphCell.peek()).toBe(glyphA);
    expect(editor.shownPageId()).toEqual(selectionPage);
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
    expect(editor.pageExists(glyphTab.pageId)).toBe(false);
  });

  it("finds the tab holding a page, and reopens a closed page's tab for an undo", () => {
    const second = addPageId();
    tabs.openGlyph(glyphA);
    const glyphPage = glyphTabs()[0]!.pageId;

    expect(tabs.tabHolding(glyphPage)).toEqual(glyphTabs()[0]);
    expect(tabs.tabHolding(second)).toBeNull();
    expect(tabs.reopenTabFor({ pageId: second, glyphIds: [], nodeIds: [] })).toMatchObject({
      kind: "page",
      pageId: second,
    });
    expect(tabs.tabHolding(second)).toMatchObject({ kind: "page", pageId: second });
    expect(
      tabs.reopenTabFor({ pageId: asNodeId("node_gone"), glyphIds: [], nodeIds: [] }),
    ).toBeNull();
  });

  it("reopens a closed glyph tab for an undo of an edit on its glyph", () => {
    tabs.openGlyph(glyphA);
    const glyphPage = glyphTabs()[0]!.pageId;
    tabs.close(glyphTabs()[0]!.id);

    const tab = tabs.reopenTabFor({ pageId: glyphPage, glyphIds: [glyphA], nodeIds: [] });

    expect(tab).toMatchObject({ kind: "glyph", glyphId: glyphA });
  });

  it("closes a page's tab when the page is deleted, and never the overview", () => {
    const second = addPageId();
    tabs.openPage(second);

    editor.deletePage(second);
    tabs.close(GLYPHS_TAB_ID);

    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([GLYPHS_TAB_ID]);
  });

  it("reorders page and glyph tabs, keeping the overview pinned first", () => {
    const page = tabs.openPage(firstPageId());
    tabs.openGlyph(glyphA);
    const glyphTab = glyphTabs()[0]!;

    tabs.move(glyphTab.id, 0);
    tabs.move(GLYPHS_TAB_ID, 2);

    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([
      GLYPHS_TAB_ID,
      glyphTab.id,
      page.id,
    ]);
  });

  it("keeps the order through later opens and closes", () => {
    const first = tabs.openPage(firstPageId());
    const second = tabs.openPage(addPageId());
    tabs.move(second.id, 0);

    tabs.openGlyph(glyphA);
    tabs.close(glyphTabs()[0]!.id);

    expect(tabs.tabsCell.peek().map((tab) => tab.id)).toEqual([GLYPHS_TAB_ID, second.id, first.id]);
  });

  it("closes the shown glyph tab and shows its neighbour, as Close Tab does", () => {
    tabs.openGlyph(glyphA);
    tabs.openGlyph(glyphB);
    const [shown, neighbour] = glyphTabs();

    const outcome = tabs.closeShown({ kind: "glyph", glyphId: glyphA });

    expect(outcome).toEqual({ kind: "show", tab: neighbour });
    expect(glyphTabs()).toEqual([neighbour]);
    expect(editor.pageExists(shown!.pageId)).toBe(false);
  });

  it("asks to close the window when Close Tab runs on the pinned overview", () => {
    tabs.openPage(firstPageId());

    expect(tabs.closeShown({ kind: "glyphs" })).toEqual({ kind: "closeWindow" });
    expect(tabs.tabsCell.peek()).toHaveLength(2);
  });
});
