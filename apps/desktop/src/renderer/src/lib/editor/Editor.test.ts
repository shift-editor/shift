import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { glyphTextItem, lineBreakTextItem } from "@/lib/text/layout";
import { asItemId } from "@shift/types";

describe("Editor", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("S", 83);
  });

  describe("scene bootstrap", () => {
    it("places the opened glyph as one scene item with geometry shown at the origin", () => {
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

    it("can place the same glyph id twice with distinct item ids", async () => {
      const record = editor.font.recordForName("A")!;
      const left = asItemId("left");
      const right = asItemId("right");

      editor.scene.set({
        items: [
          {
            id: left,
            kind: "glyph",
            glyphId: record.id,
            location: editor.font.defaultLocation(),
            placement: { origin: { x: 0, y: 0 } },
          },
          {
            id: right,
            kind: "glyph",
            glyphId: record.id,
            location: editor.font.defaultLocation(),
            placement: { origin: { x: 700, y: 0 } },
          },
        ],
        geometryItems: [left],
      });

      expect(editor.scene.item(left)?.glyphId).toBe(record.id);
      expect(editor.scene.item(right)?.glyphId).toBe(record.id);
      expect(editor.scene.sceneFromItemLocal(right, { x: 10, y: 20 })).toEqual({
        x: 710,
        y: 20,
      });
      expect(editor.scene.itemLocalFromScene(right, { x: 710, y: 20 })).toEqual({
        x: 10,
        y: 20,
      });
      expect(editor.scene.isGeometryShown(left)).toBe(true);
      expect(editor.scene.isGeometryShown(right)).toBe(false);

      editor.scene.moveItemBy(right, { x: 30, y: 5 });
      expect(editor.scene.item(right)?.placement.origin).toEqual({ x: 730, y: 5 });
    });
  });

  // editableGlyphVisible rule:
  //   No active text-run activity (buffer empty AND cursor not visible)
  //     → render the glyph normally. (grid → canvas open path)
  //   Active text run (typed something or Text tool active)
  //     → render the glyph only when in-place editing a slot.
  describe("editable glyph visibility follows text focus", () => {
    it("renders the glyph in initial state (no run, no cursor visible)", () => {
      expect(editor.textRun.buffer.items).toHaveLength(0);
      expect(editor.textRun.cursorVisible).toBe(false);
      expect(editor.editableGlyphVisible()).toBe(true);
    });

    it("does not render the glyph once the run has items and no slot edit", () => {
      editor.selectTool("text");
      expect(editor.editableGlyphVisible()).toBe(false);
    });

    it("renders the glyph again when in-place editing a slot", () => {
      editor.selectTool("text");
      const item = glyphTextItem("S", 83);
      editor.textRun.insert(item);
      editor.setGlyphFocus({ runId: editor.textRun.id, itemId: item.id });
      expect(editor.editableGlyphVisible()).toBe(true);
    });

    it("does not render the glyph with empty buffer but cursor visible (Text tool active)", () => {
      editor.textRun.setCursorVisible(true);
      expect(editor.editableGlyphVisible()).toBe(false);
    });
  });

  // Regression: the text run is owned by the *main* glyph (the one opened
  // from the grid), not by the *active* editing glyph. Double-clicking a
  // slot to drill into editing switches the active glyph but the run owner
  // stays put. So switching tools (Select↔Text) mid-slot-edit must keep
  // the run intact.
  describe("text-run owner = main glyph (not active editing glyph)", () => {
    it("keeps the run's items when switching back to Text after a slot drill-in", () => {
      // A is the main glyph (the one the user "opened from the grid").
      const owner = editor.font.glyphHandleForUnicode(65)!;
      const ownerKey = owner.name;
      editor.setRootGlyphHandle(owner);

      editor.selectTool("text");
      editor.textRun.insert(glyphTextItem("S", 83));
      expect(editor.textRun.buffer.items).toHaveLength(2);

      // Drill into slot 1 (the S): mirrors what TextRunEdit does on dblclick.
      editor.selectTool("select");
      const sItem = editor.textRun.buffer.items[1];
      expect(sItem.kind).toBe("glyph");
      editor.setGlyphFocus({ runId: editor.textRun.id, itemId: sItem.id });
      expect(editor.getActiveGlyphName()).toBe("S");
      // Main glyph (run owner) hasn't moved.
      expect(editor.rootGlyphHandle!.name).toBe(ownerKey);

      // Toggle back to Text. The run should still be the A-keyed run, with
      // its items preserved — not a fresh S-keyed run.
      editor.selectTool("text");

      expect(editor.textRun.buffer.items).toHaveLength(2);
      expect(editor.textRun.buffer.items[0]).toMatchObject({
        kind: "glyph",
        glyphName: ownerKey,
        codepoint: 65,
      });
      expect(editor.textRun.buffer.items[1]).toBe(sItem);
    });
  });

  describe("glyph focus placement", () => {
    it("recomputes drawOffset from the focused item after inserting a linebreak before it", () => {
      const owner = editor.font.glyphHandleForUnicode(65)!;
      editor.setRootGlyphHandle(owner);
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

    it("opens direct glyphs through the implicit editor run", () => {
      editor.openGlyph({ name: "S", unicode: 83 });

      expect(editor.focusedGlyph?.glyph.name).toBe("S");
      expect(editor.textRuns.resolveAnchor(editor.focusedGlyph!.anchor)).toEqual(
        editor.focusedGlyph,
      );
      expect(editor.drawOffset).toEqual(editor.glyphPlacement?.focused.editOrigin);
    });
  });
});
