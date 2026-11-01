import { describe, expect, it } from "vitest";
import { asNodeId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";

// The canvas shows one run, "A", the open glyph, at the page's origin.
describe("agents write proof text through the Text tool's edit path", () => {
  const editor = useTestEditor();

  async function runs() {
    return (await editor.agentText("text.runs", {})).value;
  }

  it("creates a run below the last one, picking /name glyphs, as one undo step", async () => {
    await editor.addGlyph("a.alt", null);

    const { value: created } = await editor.agentText("text.create", { text: "AA\n/a.alt" });

    expect(created).toMatchObject({
      items: [{ text: "A" }, { text: "A" }, { text: "\n" }, { text: "/a.alt" }],
      baselines: [0, expect.any(Number)],
    });
    expect(await runs()).toMatchObject([
      { text: "A", at: { x: 0, y: 0 } },
      { id: created.id, text: "AA\n/a.alt", at: { x: 0, y: -created.baselines[1]! } },
    ]);

    await editor.undo();

    expect(await runs()).toMatchObject([{ text: "A" }]);
  });

  it("marks the document unsaved when it adds a run to one of the user's pages", async () => {
    await editor.save();
    const [page] = editor.pageList();

    await editor.agentText("text.create", { pageId: asNodeId(page!.id), text: "A" });

    expect(await editor.documentState()).toMatchObject({ dirty: true });
  });

  it("reads a run back as the proof text it was created from", async () => {
    await editor.addGlyph("a.alt", null);

    const { value: created } = await editor.agentText("text.create", { text: "1//2 /a.alt b" });

    expect(created).toMatchObject({
      items: ["1", "/", "2", " ", "/a.alt", "b"].map((text) => ({ text })),
    });
    expect(await runs()).toMatchObject([{ text: "A" }, { text: "1//2 /a.alt b" }]);
  });

  it("replaces a run's text and deletes the run, each one undo step", async () => {
    const [run] = await runs();
    const runId = run!.id;

    await editor.agentText("text.setText", { runId, text: "AAA" });
    expect(await runs()).toMatchObject([{ id: runId, text: "AAA" }]);

    await editor.agentText("text.delete", { runId });
    expect(await runs()).toEqual([]);

    await editor.undo();
    expect(await runs()).toMatchObject([{ id: runId, text: "AAA" }]);
    await editor.undo();
    expect(await runs()).toMatchObject([{ id: runId, text: "A" }]);
  });

  it("shows the Text mode caret with a selection, as session state", async () => {
    // On one of the user's pages, where an edit would mark the document unsaved.
    const pageId = asNodeId(editor.pageList()[0]!.id);
    const { value: created } = await editor.agentText("text.create", { pageId, text: "AAA" });
    await editor.save();

    const { value: shown } = await editor.agentText("text.setCaret", {
      runId: created.id,
      position: 1,
      selection: { start: 1, end: 3 },
    });

    expect(shown).toMatchObject({ caret: { position: 1, selection: { start: 1, end: 3 } } });
    expect(editor.toolState()).toEqual({ id: "text", state: "editing" });
    expect(editor.shownPageId()).toBe(pageId);
    expect(await editor.documentState()).toMatchObject({ dirty: false });

    await editor.undo();
    const left = await editor.agentText("text.runs", { pageId });
    expect(left.value, "undo takes back the create, not the caret").toEqual([]);
  });

  it("changes no font data, so the font revision stays, undo included", async () => {
    const before = await editor.agentText("text.runs", {});
    const glyphs = await editor.glyphNames();
    const outline = await editor.outline();
    const { fontRevision } = before;

    const created = await editor.agentText("text.create", {
      text: "AA",
      ifFontRevision: fontRevision,
    });
    const runId = created.value.id;
    const edited = await editor.agentText("text.setText", {
      runId,
      text: "A",
      ifFontRevision: fontRevision,
    });
    await editor.undo();
    const after = await editor.agentText("text.runs", { ifFontRevision: fontRevision });

    expect([created.fontRevision, edited.fontRevision, after.fontRevision]).toEqual([
      fontRevision,
      fontRevision,
      fontRevision,
    ]);
    expect(await editor.glyphNames()).toEqual(glyphs);
    expect(await editor.outline()).toEqual(outline);
  });

  it("refuses a write once the font has moved past its ifFontRevision, changing nothing", async () => {
    const { fontRevision } = await editor.agentText("text.runs", {});
    const [run] = await runs();
    await editor.addGlyph("B", 66);

    await expect(
      editor.agentText("text.create", { text: "AB", ifFontRevision: fontRevision }),
    ).rejects.toMatchObject({ name: "FontChangedError" });
    await expect(
      editor.agentText("text.delete", { runId: run!.id, ifFontRevision: fontRevision }),
    ).rejects.toMatchObject({ name: "FontChangedError" });

    expect(await runs()).toMatchObject([{ id: run!.id, text: "A" }]);
  });

  it("answers what it cannot do with typed errors and leaves the text as it was", async () => {
    const [run] = await runs();
    const missing = asNodeId("missing");

    await expect(editor.agentText("text.create", { text: "A /" })).rejects.toMatchObject({
      name: "ProofTextError",
    });
    await expect(editor.agentText("text.create", { text: "A/nope" })).rejects.toMatchObject({
      name: "UnknownGlyphNameError",
      names: ["nope"],
    });
    await expect(
      editor.agentText("text.setText", { runId: missing, text: "A" }),
    ).rejects.toMatchObject({
      name: "TextRunNotFoundError",
    });
    await expect(editor.agentText("text.runs", { pageId: missing })).rejects.toMatchObject({
      name: "PageNotFoundError",
    });
    await expect(
      editor.agentText("text.setCaret", { runId: run!.id, position: 2 }),
    ).rejects.toMatchObject({ name: "TextCaretError" });

    expect(await runs()).toMatchObject([{ id: run!.id, text: "A" }]);
  });
});
