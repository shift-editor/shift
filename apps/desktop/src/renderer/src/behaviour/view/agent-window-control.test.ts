import { describe, expect, it } from "vitest";
import { asNodeId, asSelectableId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";

// The canvas shows glyph A, open in its tab, at the default source.
describe("agents change what the window shows without touching the font", () => {
  const editor = useTestEditor();

  /** The font revision now, as any control call reports it. */
  async function fontRevision(surface: EditorTestSurface = editor): Promise<string> {
    const { fontRevision } = await surface.agentControl("editor.select", {
      ids: surface.editorView().selectionIds,
    });
    return fontRevision;
  }

  it("switches tools as the toolbar does, a tool from a slot's menu included", async () => {
    const { value: pen } = await editor.agentControl("editor.setTool", { tool: "pen" });
    const { value: kerning } = await editor.agentControl("editor.setTool", { tool: "kerning" });

    expect(pen.tool).toEqual({ id: "pen", state: "ready" });
    expect(kerning.tool).toMatchObject({ id: "kerning" });
    expect(editor.toolState()).toMatchObject({ id: "kerning" });
  });

  it("refuses a tool the window does not have and keeps the active one", async () => {
    await editor.agentControl("editor.setTool", { tool: "pen" });

    await expect(editor.agentControl("editor.setTool", { tool: "lasso" })).rejects.toMatchObject({
      name: "ToolNotFoundError",
      available: expect.arrayContaining(["select", "pen", "kerning"]),
    });
    expect(editor.toolState()).toMatchObject({ id: "pen" });
  });

  it("shows a page in a tab of its own from a glyph tab, as the pages list does", async () => {
    const proofs = editor.addPage("Proofs");

    const { value } = await editor.agentControl("editor.showPage", {
      pageId: asNodeId(proofs.id),
    });

    expect(value).toMatchObject({ shownPageId: proofs.id, route: "/canvas", glyph: null });
    expect(editor.shownPageId()).toBe(proofs.id);
  });

  it("refuses a page the document does not have and stays where it is", async () => {
    const shown = editor.shownPageId();

    await expect(
      editor.agentControl("editor.showPage", { pageId: asNodeId("node-missing") }),
    ).rejects.toMatchObject({ name: "PageNotFoundError", pageId: "node-missing" });
    expect(editor.shownPageId()).toBe(shown);
  });

  it("opens a glyph in its own tab and routes to it, as the glyph overview does", async () => {
    await editor.addGlyph("B", 66);
    const proofs = editor.addPage("Proofs");
    await editor.agentControl("editor.showPage", { pageId: asNodeId(proofs.id) });

    const { value } = await editor.agentControl("editor.openGlyph", {
      glyph: { name: "B" },
    });

    expect(value.glyph).toMatchObject({ name: "B" });
    expect(value.route).toBe(`/editor/${encodeURIComponent(value.glyph!.glyphId)}`);
    expect(value.shownPageId).not.toBe(proofs.id);
  });

  it("refuses a glyph the font does not have and keeps the open one", async () => {
    await expect(
      editor.agentControl("editor.openGlyph", { glyph: { name: "missing" } }),
    ).rejects.toMatchObject({ name: "GlyphNotFoundError", glyph: "missing" });
    expect(editor.editorView().glyph).toMatchObject({ name: "A" });
  });

  it("zooms and centres the camera on a point in the open glyph's units", async () => {
    editor.resizeCanvas(800, 600);

    const { value } = await editor.agentControl("editor.setView", {
      zoom: 2,
      center: { x: 250, y: 350 },
    });

    expect(value.viewport.zoom).toBe(2);
    expect(value.viewport.center!.x).toBeCloseTo(250);
    expect(value.viewport.center!.y).toBeCloseTo(350);
    expect(editor.zoomLevel()).toBe(2);
  });

  it("refuses to centre a canvas that has no size yet, and leaves the zoom", async () => {
    const zoom = editor.zoomLevel();

    await expect(
      editor.agentControl("editor.setView", { zoom: 3, center: { x: 0, y: 0 } }),
    ).rejects.toMatchObject({ name: "CanvasHiddenError" });
    expect(editor.zoomLevel()).toBe(zoom);
    expect(editor.editorView().viewport.center).toBeNull();
  });

  it("replaces the selection with the given objects, and an empty list clears it", async () => {
    const { a, b } = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 100, name: "a" },
            { x: 200, y: 200, name: "b" },
          ],
        },
      ],
    });
    editor.select([a]);

    const { value } = await editor.agentControl("editor.select", { ids: [b, a] });
    expect(value.selectionIds).toEqual([b, a]);

    await editor.agentControl("editor.select", { ids: [] });
    expect(editor.selectionIds()).toEqual([]);
  });

  it("refuses ids that name nothing and keeps the selection", async () => {
    const { a } = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 100, name: "a" },
            { x: 200, y: 200 },
          ],
        },
      ],
    });
    editor.select([a]);
    const missing = asSelectableId("point-missing");

    await expect(editor.agentControl("editor.select", { ids: [a, missing] })).rejects.toMatchObject(
      { name: "ObjectNotFoundError", ids: [missing] },
    );
    expect(editor.selectionIds()).toEqual([a]);
  });

  it("changes no font data: the revision stays and the document stays saved", async () => {
    const { a } = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 100, name: "a" },
            { x: 200, y: 200 },
          ],
        },
      ],
    });
    await editor.addGlyph("B", 66);
    const proofs = editor.addPage("Proofs");
    await editor.save();
    editor.resizeCanvas(800, 600);
    const before = await fontRevision();
    const outline = await editor.outline();

    const revisions = [
      (await editor.agentControl("editor.setTool", { tool: "hand" })).fontRevision,
      (await editor.agentControl("editor.select", { ids: [a] })).fontRevision,
      (await editor.agentControl("editor.setView", { zoom: 4 })).fontRevision,
      (await editor.agentControl("editor.showPage", { pageId: asNodeId(proofs.id) })).fontRevision,
      (await editor.agentControl("editor.openGlyph", { glyph: { name: "A" } })).fontRevision,
    ];

    expect(revisions).toEqual(Array(revisions.length).fill(before));
    expect(await editor.documentState()).toMatchObject({ dirty: false });
    expect(await editor.outline()).toEqual(outline);
  });

  it("does nothing when the font changed since ifFontRevision", async () => {
    const stale = await fontRevision();
    await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ],
    });
    const tool = editor.toolState();

    await expect(
      editor.agentControl("editor.setTool", { tool: "pen", ifFontRevision: stale }),
    ).rejects.toMatchObject({ name: "FontChangedError", expectedRevision: stale });
    expect(editor.toolState()).toEqual(tool);
  });
});
