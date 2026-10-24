import { beforeEach, describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import type { GlyphNode } from "@shift/editor/types";
import { effect } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";

describe("editing readers name the nodes in edit mode", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  const placeSecondGlyph = () =>
    editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId: editor.runGlyph!.glyphId,
      sourceId: editor.font.defaultSource.id,
      position: { x: 700, y: 0 },
    });

  it("gives the edited glyph's context: its node, glyph and active-source layer", () => {
    const edited = editor.editing.only("glyph");

    expect(edited?.node).toBe(editor.runGlyph);
    expect(edited?.glyph).toBe(editor.glyphForId(editor.runGlyph!.glyphId));
    expect(edited?.layer).toBe(editor.requireGlyphLayer());
    expect(editor.editing.of("glyph")).toEqual([edited]);
  });

  it("names no single glyph when several are edited, and lists them in order", () => {
    const first = editor.runGlyph!;
    const second = placeSecondGlyph();
    editor.editing.set([second.id, first.id]);

    expect(editor.editing.only("glyph")).toBeNull();
    expect(editor.editing.of("glyph").map(({ node }) => node.id)).toEqual([second.id, first.id]);
  });

  it("keeps naming the subject while suspended, but nothing as edited", () => {
    const child = editor.runGlyph!;
    const restore = editor.editing.suspend();

    expect(editor.editing.only("glyph")).toBeNull();
    expect(editor.editing.of("glyph")).toEqual([]);
    expect(editor.editing.has(child.id)).toBe(false);
    expect(editor.editing.subject("glyph")?.node).toBe(child);

    restore();
    expect(editor.editing.only("glyph")?.node).toBe(child);
  });

  it("restores the suspended nodes minus one deleted meanwhile", () => {
    const first = editor.runGlyph!;
    const second = placeSecondGlyph();
    editor.editing.set([first.id, second.id]);

    const restore = editor.editing.suspend();
    editor.scene.deleteNode(second.id);
    restore();

    expect(editor.editing.nodeIds).toEqual([first.id]);
  });

  it("updates a held reader as editing is suspended and restored", () => {
    const onlyGlyph = editor.editing.onlyCell("glyph");
    const seen: (string | null)[] = [];
    const reader = effect(() => {
      seen.push(onlyGlyph.value?.node.id ?? null);
    });

    const restore = editor.editing.suspend();
    restore();
    reader.dispose();

    const childId = editor.runGlyph!.id;
    expect(seen).toEqual([childId, null, childId]);
  });
});

describe.each(["hand", "text"] as const)("in %s mode, editing tools act on nothing", (mode) => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  it("the pen places no point", async () => {
    editor.selectTool(mode);
    editor.requestTemporaryTool("pen");
    await editor.click(100, 200);

    expect(editor.pointCount).toBe(0);
  });

  it("the shape tool draws no contour", async () => {
    editor.selectTool(mode);
    editor.requestTemporaryTool("shape");
    await editor.dragLocal({
      down: { x: 10, y: 10 },
      start: { x: 20, y: 20 },
      end: { x: 99, y: 99 },
    });

    expect(editor.glyphContours).toHaveLength(0);
  });

  it("adding a component or an anchor changes nothing", async () => {
    await editor.addGlyph("B", 66);
    const base = editor.font.recordForName("B" as GlyphName)!;
    editor.selectTool(mode);

    expect(await editor.addComponent(base.id)).toBeNull();
    expect(editor.addAnchorAt({ x: 100, y: 100 })).toBe(false);
    await editor.settle();
    expect(editor.requireGlyphLayer().components).toHaveLength(0);
    expect(editor.requireGlyphLayer().anchors).toHaveLength(0);
  });

  it("a boolean operation leaves the contours alone", async () => {
    for (const offset of [0, 50]) {
      editor.selectTool("shape");
      await editor.dragLocal({
        down: { x: 10 + offset, y: 10 + offset },
        start: { x: 20 + offset, y: 20 + offset },
        end: { x: 100 + offset, y: 100 + offset },
      });
    }
    const [a, b] = editor.requireGlyphLayer().contours.map(({ id }) => id);
    editor.selectTool(mode);

    await editor.boolean(a!, b!, "union");
    await editor.settle();
    expect(editor.requireGlyphLayer().contours).toHaveLength(2);
  });
});

describe("in Text mode, the glyph metrics stay readable and editable", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    await editor.dragLocal({
      down: { x: 100, y: 0 },
      start: { x: 110, y: 10 },
      end: { x: 300, y: 200 },
    });
    editor.selectTool("text");
  });

  it("reads and sets the advance of the shown glyph", async () => {
    const layer = editor.requireGlyphLayer();
    const advance = layer.xAdvance;
    expect(editor.xAdvance).toBe(advance);

    editor.setXAdvance(advance + 40);
    await editor.settle();
    expect(layer.xAdvance).toBe(advance + 40);
  });

  it("sets the shown glyph's sidebearings", async () => {
    const layer = editor.requireGlyphLayer();

    editor.setLeftSidebearing(30);
    editor.setRightSidebearing(70);
    await editor.settle();
    expect(layer.sidebearings).toEqual({ lsb: 30, rsb: 70 });
  });
});
