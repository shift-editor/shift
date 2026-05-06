import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { glyphCell, linebreakCell } from "@/lib/text/layout";

describe("Editor", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
  });

  // shouldRenderGlyph rule:
  //   No active text-run activity (buffer empty AND cursor not visible)
  //     → render the glyph normally. (grid → canvas open path)
  //   Active text run (typed something or Text tool active)
  //     → render the glyph only when in-place editing a slot.
  describe("shouldRenderGlyph", () => {
    it("renders the glyph in initial state (no run, no cursor visible)", () => {
      expect(editor.textRun.buffer.cells).toHaveLength(0);
      expect(editor.textRun.cursorVisible).toBe(false);
      expect(editor.shouldRenderGlyph()).toBe(true);
    });

    it("does not render the glyph once the run has cells and no slot edit", () => {
      editor.selectTool("text");
      expect(editor.shouldRenderGlyph()).toBe(false);
    });

    it("renders the glyph again when in-place editing a slot", () => {
      editor.selectTool("text");
      const cell = glyphCell("S", 83);
      editor.textRun.insert(cell);
      editor.setGlyphFocus({ runId: editor.textRun.id, cellId: cell.id });
      expect(editor.shouldRenderGlyph()).toBe(true);
    });

    it("does not render the glyph with empty buffer but cursor visible (Text tool active)", () => {
      editor.textRun.setCursorVisible(true);
      expect(editor.shouldRenderGlyph()).toBe(false);
    });
  });

  // Regression: the text run is owned by the *main* glyph (the one opened
  // from the grid), not by the *active* editing glyph. Double-clicking a
  // slot to drill into editing switches the active glyph but the run owner
  // stays put. So switching tools (Select↔Text) mid-slot-edit must keep
  // the run intact.
  describe("text-run owner = main glyph (not active editing glyph)", () => {
    it("keeps the run's cells when switching back to Text after a slot drill-in", () => {
      // A is the main glyph (the one the user "opened from the grid").
      const owner = editor.font.glyphHandleForUnicode(65)!;
      const ownerKey = owner.name;
      editor.setRootGlyphHandle(owner);

      editor.selectTool("text");
      editor.textRun.insert(glyphCell("S", 83));
      expect(editor.textRun.buffer.cells).toHaveLength(2);

      // Drill into slot 1 (the S): mirrors what TextRunEdit does on dblclick.
      editor.selectTool("select");
      const sCell = editor.textRun.buffer.cells[1];
      expect(sCell.kind).toBe("glyph");
      editor.setGlyphFocus({ runId: editor.textRun.id, cellId: sCell.id });
      expect(editor.getActiveGlyphName()).toBe("S");
      // Main glyph (run owner) hasn't moved.
      expect(editor.rootGlyphHandle!.name).toBe(ownerKey);

      // Toggle back to Text. The run should still be the A-keyed run, with
      // its cells preserved — not a fresh S-keyed run.
      editor.selectTool("text");

      expect(editor.textRun.buffer.cells).toHaveLength(2);
      expect(editor.textRun.buffer.cells[0]).toMatchObject({
        kind: "glyph",
        glyphName: ownerKey,
        codepoint: 65,
      });
      expect(editor.textRun.buffer.cells[1]).toBe(sCell);
    });
  });

  describe("glyph focus placement", () => {
    it("recomputes drawOffset from the focused cell after inserting a linebreak before it", () => {
      const owner = editor.font.glyphHandleForUnicode(65)!;
      editor.setRootGlyphHandle(owner);
      editor.selectTool("text");
      const s = glyphCell("S", 83);
      editor.textRun.insert(s);
      editor.setGlyphFocus({ runId: editor.textRun.id, cellId: s.id });
      const firstLineOrigin = editor.glyphPlacement?.focused.editOrigin;

      editor.textRun.buffer.placeCaret(1);
      editor.textRun.insert(linebreakCell());
      editor.selectTool("select");

      const secondLineOrigin = editor.textRun.$layout.peek()?.editOriginForCell(s.id);
      expect(editor.focusedGlyph?.anchor.cellId).toBe(s.id);
      expect(editor.focusedGlyph?.glyph.name).toBe("S");
      expect(secondLineOrigin?.y).toBe(editor.textRun.$layout.peek()?.lines[1].y);
      expect(editor.glyphPlacement?.focused.editOrigin).toEqual(secondLineOrigin);
      expect(editor.drawOffset).toEqual(secondLineOrigin);
      expect(editor.drawOffset).not.toEqual(firstLineOrigin);
    });

    it("clears derived placement when the focused cell is deleted", () => {
      editor.selectTool("text");
      const s = glyphCell("S", 83);
      editor.textRun.insert(s);
      editor.setGlyphFocus({ runId: editor.textRun.id, cellId: s.id });

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
