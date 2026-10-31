import { afterEach, describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import { square, triangle } from "@/testing/fixtures";
import { startEditorWith, WEIGHT, type FontFixture } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
afterEach(() => editor.close());

/** Open on `root`, with `base` drawn as a 100-unit square. */
const WITH_BASE = {
  glyphs: { base: { outline: { contours: [square(100)] } }, root: {} },
  open: "root",
} satisfies FontFixture;

describe("component references become removable or editable local contours", () => {
  it("removes a nested component, restores it, and decomposes it into its outline", async () => {
    editor = await startEditorWith({
      glyphs: {
        leaf: { outline: { contours: [triangle([40, 25], [60, 25], [60, 45])] } },
        middle: { outline: { components: [{ glyph: "leaf" }] } },
        root: { outline: { components: [{ glyph: "middle" }] } },
      },
      open: "root",
    });
    const [component] = await editor.components();
    const drawn = (await editor.drawnGlyph()).bounds;
    expect(drawn).toEqual({ min: { x: 40, y: 25 }, max: { x: 60, y: 45 } });

    editor.selectObjects([component!.id]);
    expect(await editor.deleteSelection()).toBe(true);
    expect(await editor.components()).toEqual([]);
    expect((await editor.drawnGlyph()).bounds).toBeNull();

    await editor.undo();
    await editor.settle();
    expect(await editor.components()).toMatchObject([{ id: component!.id }]);
    expect((await editor.drawnGlyph()).bounds).toEqual(drawn);

    editor.selectObjects([component!.id]);
    expect(await editor.runCommand("glyph.decomposeComponents")).toBe(true);
    expect(await editor.components()).toEqual([]);
    expect((await editor.outline()).flatMap(({ points }) => points)).toMatchObject([
      { x: 40, y: 25 },
      { x: 60, y: 25 },
      { x: 60, y: 45 },
    ]);

    await editor.undo();
    await editor.settle();
    expect(await editor.components()).toMatchObject([{ id: component!.id }]);
    expect(await editor.outline()).toEqual([]);
    expect((await editor.drawnGlyph()).bounds).toEqual(drawn);
  });

  it("creates a missing glyph and its component as one undoable edit", async () => {
    editor = await startTestEditor();

    const componentId = await editor.createGlyphAndAddComponent("aacute" as GlyphName);
    const created = editor.glyphNamed("aacute");
    expect(componentId).not.toBeNull();
    expect(created).toMatchObject({ unicodes: [0x00e1] });
    expect(await editor.components()).toMatchObject([{ baseGlyphId: created?.id }]);

    await editor.undo();
    await editor.settle();
    expect(editor.glyphNamed("aacute")).toBeNull();
    expect(await editor.components()).toEqual([]);

    await editor.redo();
    await editor.settle();
    expect(editor.glyphNamed("aacute")).toMatchObject({ id: created?.id });
    expect(await editor.components()).toMatchObject([{ baseGlyphId: created?.id }]);
  });

  it("deletes a selected component of an empty glyph, which has no bounds", async () => {
    editor = await startEditorWith({ glyphs: { "empty-base": {} } });
    await editor.draw({ components: [{ glyph: "empty-base" }] });
    editor.selectObjects((await editor.components()).map(({ id }) => id));

    expect(await editor.deleteSelection()).toBe(true);
    expect(await editor.components()).toEqual([]);
  });

  it("adds and deletes matching components in every source being edited, as one edit", async () => {
    editor = await startEditorWith({
      ...WITH_BASE,
      axes: [{ ...WEIGHT, name: "Weight" }],
      sources: { Bold: { wght: 700 } },
    });
    const regular = editor.fontOverview().sources[0]!.name;
    await editor.editSources([regular, "Bold"]);

    await editor.draw({ components: [{ glyph: "base" }] });
    expect((await editor.layerAt(regular)).components).toHaveLength(1);
    expect((await editor.layerAt("Bold")).components).toHaveLength(1);

    await editor.editSources([regular, "Bold"]);
    editor.selectObjects((await editor.components()).map(({ id }) => id));
    expect(await editor.deleteSelection()).toBe(true);
    expect((await editor.layerAt(regular)).components).toEqual([]);
    expect((await editor.layerAt("Bold")).components).toEqual([]);

    await editor.undo();
    await editor.settle();
    expect((await editor.layerAt(regular)).components).toHaveLength(1);
    expect((await editor.layerAt("Bold")).components).toHaveLength(1);

    await editor.redo();
    await editor.settle();
    expect((await editor.layerAt(regular)).components).toEqual([]);
    expect((await editor.layerAt("Bold")).components).toEqual([]);
  });
});

describe("Decompose Components replaces selected components with outlines", () => {
  it("decomposes the selection as one undoable edit", async () => {
    editor = await startEditorWith(WITH_BASE);
    await editor.draw({ components: [{ glyph: "base" }] });
    const ids = (await editor.components()).map(({ id }) => id);
    editor.selectObjects(ids);

    expect(editor.canDecomposeSelection()).toBe(true);
    expect(await editor.runCommand("glyph.decomposeComponents")).toBe(true);
    expect(await editor.components()).toEqual([]);
    expect(await editor.outline()).toMatchObject([
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ]);

    await editor.undo();
    await editor.settle();
    expect(await editor.components()).toMatchObject(ids.map((id) => ({ id })));
    expect(await editor.outline()).toEqual([]);
  });

  it("does nothing when the selection is not components", async () => {
    editor = await startTestEditor();
    const { only } = await editor.draw({ contours: [{ points: [{ x: 0, y: 0, name: "only" }] }] });
    editor.select([only]);
    const before = await editor.outline();

    expect(editor.canDecomposeSelection()).toBe(false);
    expect(await editor.runCommand("glyph.decomposeComponents")).toBe(false);
    expect(await editor.outline()).toEqual(before);
  });
});

describe("components of glyphs not yet loaded this session", () => {
  it("draws a newly added component's outline as soon as it is added", async () => {
    const setup = await startEditorWith(WITH_BASE);
    const reopened = await setup.reopen();
    await setup.close();
    editor = reopened;

    await editor.draw({ components: [{ glyph: "base" }] });

    const drawn = await editor.drawnGlyph();
    expect(drawn).toMatchObject({
      components: [expect.anything()],
      bounds: { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
    });
  });
});
