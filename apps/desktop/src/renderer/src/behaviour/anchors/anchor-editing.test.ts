import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

describe("adding, renaming, and deleting anchors", () => {
  const editor = useTestEditor({ file: FONTS.anchorPropagation, glyph: "a" });

  it("renames an anchor in the source being edited, into composites, and undoes", async () => {
    const boldBefore = (await editor.layerAt("Bold")).anchors.map(({ name }) => ({ name }));
    const bottom = await editor.anchorNamed("bottom");

    expect(editor.renameAnchor(bottom!.id, "bottomleft")).toBe(true);
    await editor.settle();

    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "bottomleft" })]),
    });
    expect(await editor.layerAt("Bold")).toMatchObject({ anchors: boldBefore });
    const shown = (await editor.drawnGlyph("aacute")).anchors.map(({ name }) => name);
    expect(shown).toContain("bottomleft");
    expect(shown).not.toContain("bottom");

    await editor.undo();
    await editor.settle();
    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.not.arrayContaining([expect.objectContaining({ name: "bottomleft" })]),
    });
    expect(await editor.drawnGlyph("aacute")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "bottom" })]),
    });
  });

  it("renames, adds, and deletes in every source selected for editing", async () => {
    await editor.editSources(["Light", "Bold"]);

    const bottom = await editor.anchorNamed("bottom");
    expect(editor.renameAnchor(bottom!.id, "bottomleft")).toBe(true);
    await editor.settle();
    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "bottomleft" })]),
    });
    expect(await editor.layerAt("Bold")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "bottomleft" })]),
    });

    editor.movePointerTo({ x: 120, y: 340 });
    expect(await editor.runCommand("glyph.addAnchor")).toBe(true);
    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "new" })]),
    });
    expect(await editor.layerAt("Bold")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "new" })]),
    });

    await editor.editSources(["Light", "Bold"]);
    editor.selectObjects([(await editor.anchorNamed("ogonek"))!.id]);
    expect(await editor.deleteSelection()).toBe(true);
    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.not.arrayContaining([expect.objectContaining({ name: "ogonek" })]),
    });
    expect(await editor.layerAt("Bold")).toMatchObject({
      anchors: expect.not.arrayContaining([expect.objectContaining({ name: "ogonek" })]),
    });
  });

  it("deletes an anchor from the source being edited as one undo step", async () => {
    const before = (await editor.layerAt("Light")).anchors.map(({ name }) => ({ name }));
    const boldBefore = (await editor.layerAt("Bold")).anchors.map(({ name }) => ({ name }));
    editor.selectObjects([(await editor.anchorNamed("ogonek"))!.id]);

    expect(await editor.deleteSelection()).toBe(true);

    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.not.arrayContaining([expect.objectContaining({ name: "ogonek" })]),
    });
    expect(await editor.layerAt("Bold")).toMatchObject({ anchors: boldBefore });
    await editor.undo();
    await editor.settle();
    expect(await editor.layerAt("Light")).toMatchObject({ anchors: before });
  });

  it("adds an anchor under the pointer to the source being edited and selects it", async () => {
    editor.movePointerTo({ x: 120, y: 340 });

    expect(await editor.runCommand("glyph.addAnchor")).toBe(true);

    const added = await editor.anchorNamed("new");
    expect(added).toMatchObject({ x: 120, y: 340 });
    expect(editor.selectionIds()).toEqual([added?.id]);
    expect(await editor.layerAt("Bold")).toMatchObject({
      anchors: expect.not.arrayContaining([expect.objectContaining({ name: "new" })]),
    });

    expect(await editor.runCommand("glyph.addAnchor")).toBe(true);
    expect(await editor.layerAt("Light")).toMatchObject({
      anchors: expect.arrayContaining([expect.objectContaining({ name: "new.1" })]),
    });
  });

  it("moves several anchors to one coordinate, keeping other sources relative", async () => {
    await editor.editSources(["Light", "Bold"]);
    const lightTop = await editor.anchorNamed("top");
    const boldTop = await editor.anchorNamed("top", { source: "Bold" });
    expect(boldTop).not.toBeNull();

    const ogonek = await editor.anchorNamed("ogonek");
    expect(editor.setAnchorAxis([lightTop!.id, ogonek!.id], "x", 300)).toBe(true);
    await editor.settle();

    expect(await editor.anchorNamed("top")).toMatchObject({ x: 300 });
    expect(await editor.anchorNamed("ogonek")).toMatchObject({ x: 300 });
    expect((await editor.layerAt("Bold")).anchors).toContainEqual(
      expect.objectContaining({ name: "top", x: boldTop!.x + (300 - lightTop!.x) }),
    );
  });

  it("moves the components attached to a dragged anchor in the composites that use it", async () => {
    await editor.openGlyph("aacute");
    expect(await editor.components()).toMatchObject([
      expect.anything(),
      { transformation: { dx: 150 } },
    ]);

    await editor.openGlyph("a");
    await editor.dragAnchor((await editor.anchorNamed("top"))!.id, { x: 30, y: 0 });

    await editor.openGlyph("aacute");
    expect(await editor.components()).toMatchObject([
      expect.anything(),
      { transformation: { dx: 180 } },
    ]);
  });

  it("shows attached components following the anchor while it is dragged", async () => {
    const before = await editor.drawnGlyph("aacute");
    expect(before.anchors).toContainEqual({ name: "top", x: 250, y: expect.any(Number) });

    editor.holdDragAnchor((await editor.anchorNamed("top"))!.id, { x: 30, y: 10 });

    const dragging = await editor.drawnGlyph("aacute");
    expect(dragging).toMatchObject({
      components: [expect.anything(), { dx: before.components[1]!.dx + 30 }],
      anchors: expect.arrayContaining([{ name: "top", x: 280, y: expect.any(Number) }]),
    });

    editor.cancelGesture();
    expect((await editor.drawnGlyph("aacute")).components).toEqual(before.components);
  });
});

describe("aligning components to anchors", () => {
  const editor = useTestEditor({ file: FONTS.anchorPropagation, glyph: "aacute" });

  // The acute attaches to `a`'s top anchor, which each move drags in `a`.

  it("frees a component so it stays put, and anchors it back onto its anchors", async () => {
    editor.selectObjects([(await editor.components())[1]!.id]);
    expect(editor.selectedComponentsAnchored()).toBe(false);

    expect(await editor.setSelectedComponentsAnchored(false)).toBe(true);
    await editor.openGlyph("a");
    await editor.dragAnchor((await editor.anchorNamed("top"))!.id, { x: 30, y: 0 });
    await editor.openGlyph("aacute");
    expect(await editor.components()).toMatchObject([
      expect.anything(),
      { transformation: { dx: 150 } },
    ]);

    editor.selectObjects([(await editor.components())[1]!.id]);
    expect(await editor.setSelectedComponentsAnchored(true)).toBe(true);
    await editor.settle();
    expect(await editor.components()).toMatchObject([
      expect.anything(),
      { transformation: { dx: 180 } },
    ]);
    expect(editor.selectedComponentsAnchored()).toBe(true);

    await editor.openGlyph("a");
    await editor.dragAnchor((await editor.anchorNamed("top"))!.id, { x: 10, y: 0 });
    await editor.openGlyph("aacute");
    expect(await editor.components()).toMatchObject([
      expect.anything(),
      { transformation: { dx: 190 } },
    ]);
  });
});
