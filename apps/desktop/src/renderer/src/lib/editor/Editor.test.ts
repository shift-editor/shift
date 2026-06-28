import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { glyphTextItem, lineBreakTextItem } from "@/lib/text/layout";
import { mintItemId } from "@shift/types";

describe("Editor", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("S", 83);
  });

  describe("scene bootstrap", () => {
    it("places the focused glyph as one scene item with geometry shown at the origin", () => {
      const record = editor.font.recordForName("A")!;
      const itemId = editor.scene.value.items[0]?.id ?? null;
      const item = editor.scene.item(itemId);

      expect(editor.scene.value.items).toHaveLength(1);
      expect(item).toMatchObject({
        kind: "glyph",
        glyphId: record.id,
        placement: { origin: { x: 0, y: 0 } },
      });
      expect(itemId && editor.scene.isGeometryShown(itemId)).toBe(true);
      expect(itemId && editor.layerForItem(itemId)).not.toBeNull();
    });

    it("derives the preview glyph record from the geometry-shown scene item", () => {
      const record = editor.font.recordForName("S")!;

      editor.scene.clear();
      const itemId = editor.scene.addGlyph({
        glyphId: record.id,
        origin: { x: 0, y: 0 },
      });
      editor.scene.setGeometryItems([itemId]);

      expect(editor.scene.value.items).toHaveLength(1);
      expect(editor.scene.item(itemId)).toMatchObject({
        kind: "glyph",
        glyphId: record.id,
        placement: { origin: { x: 0, y: 0 } },
      });
      expect(editor.scene.isGeometryShown(itemId)).toBe(true);
      expect(editor.previewGlyphRecordCell.peek()?.id).toBe(record.id);
      expect(editor.layerForItem(itemId)).not.toBeNull();
    });

    it("clearing the scene clears the derived preview glyph record", () => {
      const record = editor.font.recordForName("S")!;

      editor.scene.clear();
      const itemId = editor.scene.addGlyph({
        glyphId: record.id,
        origin: { x: 0, y: 0 },
      });
      editor.scene.setGeometryItems([itemId]);

      expect(editor.previewGlyphRecordCell.peek()?.id).toBe(record.id);

      editor.scene.clear();

      expect(editor.scene.value.items).toEqual([]);
      expect(editor.previewGlyphRecordCell.peek()).toBeNull();
    });

    it("can place the same glyph id twice with distinct item ids", async () => {
      const record = editor.font.recordForName("A")!;
      const left = mintItemId();
      const right = mintItemId();

      editor.scene.set({
        items: [
          {
            id: left,
            kind: "glyph",
            glyphId: record.id,
            placement: { origin: { x: 0, y: 0 } },
          },
          {
            id: right,
            kind: "glyph",
            glyphId: record.id,
            placement: { origin: { x: 700, y: 0 } },
          },
        ],
        geometryItems: [left],
      });

      expect(editor.scene.item(left)?.glyphId).toBe(record.id);
      expect(editor.scene.item(right)?.glyphId).toBe(record.id);
      expect(editor.scene.toScene(right, { x: 10, y: 20 })).toEqual({
        x: 710,
        y: 20,
      });
      expect(editor.scene.toLocal(right, { x: 710, y: 20 })).toEqual({
        x: 10,
        y: 20,
      });
      expect(editor.scene.isGeometryShown(left)).toBe(true);
      expect(editor.scene.isGeometryShown(right)).toBe(false);

      editor.scene.moveItemBy(right, { x: 30, y: 5 });
      expect(editor.scene.item(right)?.placement.origin).toEqual({
        x: 730,
        y: 5,
      });
    });
  });

  // focusedGlyphVisible rule:
  //   No active text-run activity (buffer empty AND cursor not visible)
  //     → render the glyph normally. (grid → canvas open path)
  //   Active text run (typed something or Text tool active)
  //     → render the glyph only when in-place editing a slot.
  describe("focused glyph visibility follows text focus", () => {
    it("renders the glyph in initial state (no run, no cursor visible)", () => {
      expect(editor.textRun.buffer.items).toHaveLength(0);
      expect(editor.textRun.cursorVisible).toBe(false);
      expect(editor.focusedGlyphVisible()).toBe(true);
    });

    it("does not render the glyph once the run has items and no slot edit", () => {
      editor.selectTool("text");
      expect(editor.focusedGlyphVisible()).toBe(false);
    });

    it("renders the glyph again when in-place editing a slot", () => {
      editor.selectTool("text");
      const item = glyphTextItem("S", 83);
      editor.textRun.insert(item);
      editor.setGlyphFocus({ runId: editor.textRun.id, itemId: item.id });
      expect(editor.focusedGlyphVisible()).toBe(true);
    });

    it("does not render the glyph with empty buffer but cursor visible (Text tool active)", () => {
      editor.textRun.setCursorVisible(true);
      expect(editor.focusedGlyphVisible()).toBe(false);
    });
  });

  describe("glyph focus placement", () => {
    it("recomputes drawOffset from the focused item after inserting a linebreak before it", () => {
      editor.selectTool("text");
      const s = glyphTextItem("S", 83);
      editor.textRun.insert(s);
      editor.setGlyphFocus({ runId: editor.textRun.id, itemId: s.id });
      const firstLineOrigin = editor.glyphPlacement?.focused.editOrigin;

      editor.textRun.buffer.placeCaret(1);
      editor.textRun.insert(lineBreakTextItem());
      editor.selectTool("select");

      const secondLineOrigin = editor.textRun.layoutCell.peek()?.editOriginForItem(s.id);
      expect(editor.focusedGlyph?.anchor.itemId).toBe(s.id);
      expect(editor.focusedGlyph?.glyph.name).toBe("S");
      expect(secondLineOrigin?.y).toBe(editor.textRun.layoutCell.peek()?.lines[1].y);
      expect(editor.glyphPlacement?.focused.editOrigin).toEqual(secondLineOrigin);
      expect(editor.drawOffset).toEqual(secondLineOrigin);
      expect(editor.drawOffset).not.toEqual(firstLineOrigin);
    });

    it("clears derived placement when the focused item is deleted", () => {
      editor.selectTool("text");
      const s = glyphTextItem("S", 83);
      editor.textRun.insert(s);
      editor.setGlyphFocus({ runId: editor.textRun.id, itemId: s.id });

      editor.textRun.buffer.placeCaret(2);
      editor.textRun.delete();

      expect(editor.focusedGlyph).toBeNull();
      expect(editor.glyphPlacement).toBeNull();
      expect(editor.drawOffset).toEqual({ x: 0, y: 0 });
    });
  });
});
