import { describe, expect, it } from "vitest";
import { asNodeId } from "@shift/types";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// The open glyph, A, is on its tab's glyph page; the document's one page is Page 1.
describe("agents edit pages as the pages list does, and undo as Edit › Undo does", () => {
  const editor = useTestEditor();

  function pageNames() {
    return editor.pageList().map((page) => page.name);
  }

  it("creates, renames and deletes a page, each one undo step that undo and redo replay", async () => {
    const shown = editor.shownPageId();

    const { value: created } = await editor.agentDocument("pages.create", { name: "Proofs" });
    const pageId = created.page.id;
    expect(created).toEqual({
      page: { id: pageId, name: "Proofs" },
      pages: [{ id: editor.pageList()[0]!.id, name: "Page 1" }, created.page],
    });
    expect(editor.shownPageId()).toBe(shown);

    const { value: renamed } = await editor.agentDocument("pages.rename", {
      pageId,
      name: " Spacing ",
    });
    expect(renamed.page).toEqual({ id: pageId, name: "Spacing" });

    const { value: deleted } = await editor.agentDocument("pages.delete", { pageId });
    expect(deleted).toMatchObject({ page: { id: pageId, name: "Spacing" }, pages: [{}] });
    expect(pageNames()).toEqual(["Page 1"]);

    const { value: undone } = await editor.agentDocument("history.undo", {});
    expect(undone).toEqual({
      undone: true,
      location: { pageId, glyphIds: [], nodeIds: expect.arrayContaining([pageId]) },
    });
    expect(pageNames()).toEqual(["Page 1", "Spacing"]);
    // As for the user, the undo shows the page it brought back.
    expect(editor.shownPageId()).toBe(pageId);

    const { value: redone } = await editor.agentDocument("history.redo", {});
    expect(redone).toMatchObject({ redone: true, location: { pageId } });
    expect(pageNames()).toEqual(["Page 1"]);
  });

  it("undoes a text run an agent created, and redoes it", async () => {
    const { value: run } = await editor.agentText("text.create", { text: "AA" });
    const runs = async () => (await editor.agentText("text.runs", {})).value.map(({ id }) => id);
    expect(await runs()).toContain(run.id);

    const { value: undone } = await editor.agentDocument("history.undo", {});
    expect(undone).toMatchObject({
      undone: true,
      location: { pageId: run.pageId, nodeIds: expect.arrayContaining([run.id]) },
    });
    expect(await runs()).not.toContain(run.id);

    const { value: redone } = await editor.agentDocument("history.redo", {});
    expect(redone).toMatchObject({ redone: true, location: { pageId: run.pageId } });
    expect(await runs()).toContain(run.id);
  });

  it("undoes a font edit, moving the font revision as the user's undo does", async () => {
    const { fontRevision: before } = await editor.agentDocument("pages.create", {});
    await editor.addGlyph("B", 66);
    const glyphs = editor.fontOverview().glyphCount;

    const { fontRevision, value } = await editor.agentDocument("history.undo", {});

    expect(value.undone).toBe(true);
    expect(value.location?.glyphIds).toHaveLength(1);
    expect(editor.fontOverview().glyphCount).toBe(glyphs - 1);
    expect(fontRevision).not.toBe(before);
  });

  it("refuses a stale font revision, changing nothing", async () => {
    const { fontRevision } = await editor.agentDocument("pages.create", { name: "Proofs" });
    const pageId = asNodeId(editor.pageList()[1]!.id);
    await editor.addGlyph("B", 66);
    const glyphs = editor.fontOverview().glyphCount;

    for (const call of [
      editor.agentDocument("pages.create", { ifFontRevision: fontRevision }),
      editor.agentDocument("pages.rename", {
        pageId,
        name: "Spacing",
        ifFontRevision: fontRevision,
      }),
      editor.agentDocument("pages.delete", { pageId, ifFontRevision: fontRevision }),
      editor.agentDocument("history.undo", { ifFontRevision: fontRevision }),
      editor.agentDocument("history.redo", { ifFontRevision: fontRevision }),
    ]) {
      await expect(call).rejects.toMatchObject({ name: "FontChangedError" });
    }

    expect(pageNames()).toEqual(["Page 1", "Proofs"]);
    expect(editor.fontOverview().glyphCount).toBe(glyphs);
  });

  it("refuses to delete the last page, and pages the list does not have", async () => {
    const pageId = asNodeId(editor.pageList()[0]!.id);

    await expect(editor.agentDocument("pages.delete", { pageId })).rejects.toMatchObject({
      name: "LastPageError",
      pageId,
    });
    const glyphPage = asNodeId(editor.shownPageId()!);
    await expect(
      editor.agentDocument("pages.rename", { pageId: glyphPage, name: "Mine" }),
    ).rejects.toMatchObject({ name: "PageNotFoundError", pageId: glyphPage });
    await expect(
      editor.agentDocument("pages.delete", { pageId: asNodeId("node-missing") }),
    ).rejects.toMatchObject({ name: "PageNotFoundError" });

    expect(pageNames()).toEqual(["Page 1"]);
  });
});

// A saved font, opened, has no steps to undo yet.
describe("agents undo and redo nothing in a document just opened", () => {
  const editor = useTestEditor({ file: FONTS.shapingTest, glyph: "f" });

  it("answers false, changing nothing, when there is nothing to undo or redo", async () => {
    expect(await editor.agentDocument("history.undo", {})).toMatchObject({
      value: { undone: false, location: null },
    });
    expect(await editor.agentDocument("history.redo", {})).toMatchObject({
      value: { redone: false, location: null },
    });

    await editor.agentDocument("pages.create", { name: "Proofs" });
    expect(await editor.agentDocument("history.redo", {})).toMatchObject({
      value: { redone: false, location: null },
    });
    expect(editor.pageList()).toContainEqual(expect.objectContaining({ name: "Proofs" }));
  });
});

describe("a preview has no undo history for agents", () => {
  const editor = useTestEditor({ mode: "preview" });

  it("refuses undo and redo as its disabled Edit menu does", async () => {
    await expect(editor.agentDocument("history.undo", {})).rejects.toMatchObject({
      name: "HistoryUnavailableError",
    });
    await expect(editor.agentDocument("history.redo", {})).rejects.toMatchObject({
      name: "HistoryUnavailableError",
    });
  });
});
