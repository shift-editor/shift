import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnchorId } from "@shift/types";
import { FONTS } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { openTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
afterEach(() => editor.close());

async function anchorNames(source: string): Promise<(string | null)[]> {
  return (await editor.layerAt(source)).anchors.map(({ name }) => name);
}

async function anchorId(name: string): Promise<AnchorId> {
  const anchor = await editor.anchorNamed(name);
  if (!anchor) throw new Error(`The open glyph has no ${name} anchor`);
  return anchor.id;
}

describe("adding, renaming, and deleting anchors", () => {
  beforeEach(async () => {
    editor = await openTestEditor(FONTS.anchorPropagation, "a");
  });

  it("renames an anchor in the source being edited, into composites, and undoes", async () => {
    const boldBefore = await anchorNames("Bold");

    expect(editor.renameAnchor(await anchorId("bottom"), "bottomleft")).toBe(true);
    await editor.settle();

    expect(await anchorNames("Light")).toContain("bottomleft");
    expect(await anchorNames("Bold")).toEqual(boldBefore);
    const shown = (await editor.drawnGlyph("aacute")).anchors.map(({ name }) => name);
    expect(shown).toContain("bottomleft");
    expect(shown).not.toContain("bottom");

    await editor.undo();
    await editor.settle();
    expect(await anchorNames("Light")).not.toContain("bottomleft");
    expect((await editor.drawnGlyph("aacute")).anchors.map(({ name }) => name)).toContain("bottom");
  });

  it("renames, adds, and deletes in every source selected for editing", async () => {
    await editor.editSources(["Light", "Bold"]);

    expect(editor.renameAnchor(await anchorId("bottom"), "bottomleft")).toBe(true);
    await editor.settle();
    expect(await anchorNames("Light")).toContain("bottomleft");
    expect(await anchorNames("Bold")).toContain("bottomleft");

    editor.movePointerTo({ x: 120, y: 340 });
    expect(await editor.runCommand("glyph.addAnchor")).toBe(true);
    expect(await anchorNames("Light")).toContain("new");
    expect(await anchorNames("Bold")).toContain("new");

    await editor.editSources(["Light", "Bold"]);
    editor.selectObjects([await anchorId("ogonek")]);
    expect(await editor.deleteSelection()).toBe(true);
    expect(await anchorNames("Light")).not.toContain("ogonek");
    expect(await anchorNames("Bold")).not.toContain("ogonek");
  });

  it("deletes an anchor from the source being edited as one undo step", async () => {
    const before = await anchorNames("Light");
    const boldBefore = await anchorNames("Bold");
    editor.selectObjects([await anchorId("ogonek")]);

    expect(await editor.deleteSelection()).toBe(true);

    expect(await anchorNames("Light")).not.toContain("ogonek");
    expect(await anchorNames("Bold")).toEqual(boldBefore);
    await editor.undo();
    await editor.settle();
    expect(await anchorNames("Light")).toEqual(before);
  });

  it("adds an anchor under the pointer to the source being edited and selects it", async () => {
    editor.movePointerTo({ x: 120, y: 340 });

    expect(await editor.runCommand("glyph.addAnchor")).toBe(true);

    const added = await editor.anchorNamed("new");
    expect(added).toMatchObject({ x: 120, y: 340 });
    expect(editor.selectionIds()).toEqual([added?.id]);
    expect(await anchorNames("Bold")).not.toContain("new");

    expect(await editor.runCommand("glyph.addAnchor")).toBe(true);
    expect(await anchorNames("Light")).toContain("new.1");
  });

  it("moves several anchors to one coordinate, keeping other sources relative", async () => {
    await editor.editSources(["Light", "Bold"]);
    const lightTop = await editor.anchorNamed("top");
    const boldTop = (await editor.layerAt("Bold")).anchors.filter(({ name }) => name === "top");
    expect(boldTop).toHaveLength(1);

    expect(editor.setAnchorAxis([lightTop!.id, await anchorId("ogonek")], "x", 300)).toBe(true);
    await editor.settle();

    expect(await editor.anchorNamed("top")).toMatchObject({ x: 300 });
    expect(await editor.anchorNamed("ogonek")).toMatchObject({ x: 300 });
    expect((await editor.layerAt("Bold")).anchors).toContainEqual(
      expect.objectContaining({ name: "top", x: boldTop[0]!.x + (300 - lightTop!.x) }),
    );
  });

  it("moves the components attached to a dragged anchor in the composites that use it", async () => {
    await editor.openGlyph("aacute");
    expect((await editor.components())[1]?.transformation.dx).toBe(150);

    await editor.openGlyph("a");
    await editor.dragAnchor(await anchorId("top"), { x: 30, y: 0 });

    await editor.openGlyph("aacute");
    expect((await editor.components())[1]?.transformation.dx).toBe(180);
  });

  it("shows attached components following the anchor while it is dragged", async () => {
    const before = await editor.drawnGlyph("aacute");
    expect(before.anchors).toContainEqual({ name: "top", x: 250, y: expect.any(Number) });

    editor.holdDragAnchor(await anchorId("top"), { x: 30, y: 10 });

    const dragging = await editor.drawnGlyph("aacute");
    expect(dragging.components[1]?.dx).toBe(before.components[1]!.dx + 30);
    expect(dragging.anchors).toContainEqual({ name: "top", x: 280, y: expect.any(Number) });

    editor.cancelGesture();
    expect((await editor.drawnGlyph("aacute")).components).toEqual(before.components);
  });
});

describe("aligning components to anchors", () => {
  beforeEach(async () => {
    editor = await openTestEditor(FONTS.anchorPropagation, "aacute");
  });

  async function moveTopOfA(dx: number): Promise<void> {
    await editor.openGlyph("a");
    await editor.dragAnchor(await anchorId("top"), { x: dx, y: 0 });
    await editor.openGlyph("aacute");
  }

  async function acute() {
    const component = (await editor.components())[1];
    if (!component) throw new Error("Expected the acute component");
    return component;
  }

  it("frees a component so it stays put, and anchors it back onto its anchors", async () => {
    editor.selectObjects([(await acute()).id]);
    expect(editor.selectedComponentsAnchored()).toBe(false);

    expect(await editor.setSelectedComponentsAnchored(false)).toBe(true);
    await moveTopOfA(30);
    expect((await acute()).transformation.dx).toBe(150);

    editor.selectObjects([(await acute()).id]);
    expect(await editor.setSelectedComponentsAnchored(true)).toBe(true);
    await editor.settle();
    expect((await acute()).transformation.dx).toBe(180);
    expect(editor.selectedComponentsAnchored()).toBe(true);

    await moveTopOfA(10);
    expect((await acute()).transformation.dx).toBe(190);
  });
});
