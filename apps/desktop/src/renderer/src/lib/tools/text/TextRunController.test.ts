import { describe, it, expect, beforeEach } from "vitest";
import { TextRunController } from "./TextRunController";

function glyph(name: string, unicode: number | null = null) {
  return { glyphName: name, unicode };
}

describe("TextRunController", () => {
  let ctrl: TextRunController;

  beforeEach(() => {
    ctrl = new TextRunController();
  });

  describe("insert and cursor", () => {
    it("inserts glyphs and advances cursor", () => {
      ctrl.insert(glyph("A", 65));
      ctrl.insert(glyph("B", 66));

      expect(ctrl.length).toBe(2);
      expect(ctrl.cursor).toBe(2);
      expect(ctrl.glyphs.map((g) => g.glyphName)).toEqual(["A", "B"]);
    });

    it("inserts at cursor position, not at end", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("C"));
      ctrl.moveCursorLeft();
      ctrl.insert(glyph("B"));

      expect(ctrl.glyphs.map((g) => g.glyphName)).toEqual(["A", "B", "C"]);
      expect(ctrl.cursor).toBe(2);
    });
  });

  describe("delete (backspace)", () => {
    it("deletes glyph before cursor", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.delete();

      expect(ctrl.length).toBe(1);
      expect(ctrl.glyphs[0].glyphName).toBe("A");
      expect(ctrl.cursor).toBe(1);
    });

    it("returns false at start of buffer", () => {
      expect(ctrl.delete()).toBe(false);
    });

    it("deletes entire selection", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.selectAll();
      ctrl.delete();

      expect(ctrl.length).toBe(0);
      expect(ctrl.cursor).toBe(0);
    });
  });

  describe("deleteForward", () => {
    it("deletes glyph after cursor", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.moveCursorToStart();
      ctrl.deleteForward();

      expect(ctrl.length).toBe(1);
      expect(ctrl.glyphs[0].glyphName).toBe("B");
      expect(ctrl.cursor).toBe(0);
    });

    it("returns false at end of buffer", () => {
      ctrl.insert(glyph("A"));
      expect(ctrl.deleteForward()).toBe(false);
    });
  });

  describe("cursor movement", () => {
    beforeEach(() => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
    });

    it("moveCursorLeft moves left by one", () => {
      ctrl.moveCursorLeft();
      expect(ctrl.cursor).toBe(2);
    });

    it("moveCursorRight does nothing at end", () => {
      ctrl.moveCursorRight();
      expect(ctrl.cursor).toBe(3);
    });

    it("moveCursorToStart jumps to 0", () => {
      ctrl.moveCursorToStart();
      expect(ctrl.cursor).toBe(0);
    });

    it("moveCursorToEnd jumps to length", () => {
      ctrl.moveCursorToStart();
      ctrl.moveCursorToEnd();
      expect(ctrl.cursor).toBe(3);
    });

    it("clamps at boundaries", () => {
      ctrl.moveCursorToStart();
      ctrl.moveCursorLeft();
      expect(ctrl.cursor).toBe(0);
    });
  });

  describe("selection via shift+arrow", () => {
    beforeEach(() => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
    });

    it("shift+left creates selection", () => {
      ctrl.moveCursorLeft(true);

      expect(ctrl.hasSelection).toBe(true);
      expect(ctrl.selection).toEqual({ start: 2, end: 3 });
      expect(ctrl.anchor).toBe(3);
      expect(ctrl.cursor).toBe(2);
    });

    it("multiple shift+left grows selection", () => {
      ctrl.moveCursorLeft(true);
      ctrl.moveCursorLeft(true);

      expect(ctrl.selection).toEqual({ start: 1, end: 3 });
    });

    it("shift+right from middle extends forward", () => {
      ctrl.moveCursorToStart();
      ctrl.moveCursorRight(true);
      ctrl.moveCursorRight(true);

      expect(ctrl.selection).toEqual({ start: 0, end: 2 });
    });

    it("arrow without shift collapses selection", () => {
      ctrl.moveCursorLeft(true);
      ctrl.moveCursorLeft(true);
      ctrl.moveCursorLeft(); // collapse to start

      expect(ctrl.hasSelection).toBe(false);
      expect(ctrl.cursor).toBe(1);
    });

    it("right arrow collapses to end of selection", () => {
      ctrl.moveCursorLeft(true);
      ctrl.moveCursorLeft(true);
      ctrl.moveCursorRight(); // collapse to end

      expect(ctrl.hasSelection).toBe(false);
      expect(ctrl.cursor).toBe(3);
    });
  });

  describe("selectAll", () => {
    it("selects entire buffer", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.selectAll();

      expect(ctrl.selection).toEqual({ start: 0, end: 2 });
      expect(ctrl.selectedGlyphs.map((g) => g.glyphName)).toEqual(["A", "B"]);
    });
  });

  describe("selectRange", () => {
    it("selects a sub-range", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.selectRange(1, 2);

      expect(ctrl.selection).toEqual({ start: 1, end: 2 });
      expect(ctrl.selectedGlyphs.map((g) => g.glyphName)).toEqual(["B"]);
    });

    it("clamps out-of-bounds values", () => {
      ctrl.insert(glyph("A"));
      ctrl.selectRange(-5, 100);

      expect(ctrl.selection).toEqual({ start: 0, end: 1 });
    });
  });

  describe("click placement", () => {
    beforeEach(() => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
    });

    it("placeCaret collapses selection and moves cursor", () => {
      ctrl.selectAll();
      ctrl.placeCaret(1);

      expect(ctrl.hasSelection).toBe(false);
      expect(ctrl.cursor).toBe(1);
    });

    it("extendSelection keeps anchor, moves focus", () => {
      ctrl.placeCaret(0);
      ctrl.extendSelection(2);

      expect(ctrl.selection).toEqual({ start: 0, end: 2 });
      expect(ctrl.anchor).toBe(0);
      expect(ctrl.cursor).toBe(2);
    });
  });

  describe("insert replaces selection", () => {
    it("replaces selected text on insert", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.selectAll();
      ctrl.insert(glyph("X"));

      expect(ctrl.length).toBe(1);
      expect(ctrl.glyphs[0].glyphName).toBe("X");
      expect(ctrl.cursor).toBe(1);
      expect(ctrl.hasSelection).toBe(false);
    });

    it("replaces partial selection", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.selectRange(1, 2);
      ctrl.insert(glyph("X"));

      expect(ctrl.glyphs.map((g) => g.glyphName)).toEqual(["A", "X", "C"]);
    });
  });

  describe("insertMany (paste)", () => {
    it("inserts multiple glyphs and replaces selection", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("D"));
      ctrl.selectRange(1, 1); // no selection, cursor at 1
      ctrl.placeCaret(1);
      ctrl.insertMany([glyph("B"), glyph("C")]);

      expect(ctrl.glyphs.map((g) => g.glyphName)).toEqual(["A", "B", "C", "D"]);
      expect(ctrl.cursor).toBe(3);
    });
  });

  describe("seed", () => {
    it("seeds empty buffer with initial glyph", () => {
      ctrl.seed(glyph("A"));

      expect(ctrl.length).toBe(1);
      expect(ctrl.cursor).toBe(1);
    });

    it("does nothing if buffer is non-empty", () => {
      ctrl.insert(glyph("X"));
      ctrl.seed(glyph("A"));

      expect(ctrl.length).toBe(1);
      expect(ctrl.glyphs[0].glyphName).toBe("X");
    });
  });

  describe("snapshot / restore", () => {
    it("roundtrips state", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.moveCursorLeft(true); // select B
      ctrl.setOriginX(500);

      const snap = ctrl.snapshot();
      const ctrl2 = new TextRunController();
      ctrl2.restore(snap);

      expect(ctrl2.length).toBe(2);
      expect(ctrl2.cursor).toBe(1);
      expect(ctrl2.anchor).toBe(2);
      expect(ctrl2.selection).toEqual({ start: 1, end: 2 });
    });
  });

  describe("collapseSelection", () => {
    it("collapses to start", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.selectAll();
      ctrl.collapseSelection("start");

      expect(ctrl.cursor).toBe(0);
      expect(ctrl.hasSelection).toBe(false);
    });

    it("collapses to end", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.selectAll();
      ctrl.collapseSelection("end");

      expect(ctrl.cursor).toBe(2);
      expect(ctrl.hasSelection).toBe(false);
    });
  });

  describe("clear", () => {
    it("resets all state", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.selectAll();
      ctrl.setOriginX(100);
      ctrl.clear();

      expect(ctrl.length).toBe(0);
      expect(ctrl.cursor).toBe(0);
      expect(ctrl.hasSelection).toBe(false);
      expect(ctrl.state.peek()).toBe(null);
    });
  });

  describe("suspendEditing / resumeEditing", () => {
    it("suspends and resumes editing index", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.setEditingSlot(1, glyph("B"));

      ctrl.suspendEditing();

      const restored = ctrl.resumeEditing();
      expect(restored).toEqual({ index: 1, glyph: glyph("B") });
    });

    it("tracks editing index through insert before", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.setEditingSlot(1, glyph("B"));

      ctrl.suspendEditing();
      ctrl.placeCaret(0);
      ctrl.insert(glyph("X"));

      const restored = ctrl.resumeEditing();
      expect(restored?.index).toBe(2);
      expect(restored?.glyph).toEqual(glyph("B"));
    });

    it("tracks editing index through insert after", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.setEditingSlot(0, glyph("A"));

      ctrl.suspendEditing();
      ctrl.insert(glyph("C"));

      const restored = ctrl.resumeEditing();
      expect(restored?.index).toBe(0);
    });

    it("nulls editing index when editing glyph is deleted", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.setEditingSlot(1, glyph("B"));

      ctrl.suspendEditing();
      ctrl.placeCaret(2);
      ctrl.delete();

      const restored = ctrl.resumeEditing();
      expect(restored).toBeNull();
    });

    it("tracks editing index through deleteForward", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.setEditingSlot(2, glyph("C"));

      ctrl.suspendEditing();
      ctrl.placeCaret(0);
      ctrl.deleteForward();

      const restored = ctrl.resumeEditing();
      expect(restored?.index).toBe(1);
    });

    it("tracks editing index through selection delete", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.insert(glyph("C"));
      ctrl.insert(glyph("D"));
      ctrl.setEditingSlot(3, glyph("D"));

      ctrl.suspendEditing();
      ctrl.selectRange(0, 2);
      ctrl.delete();

      const restored = ctrl.resumeEditing();
      expect(restored?.index).toBe(1);
    });

    it("tracks editing index through insertMany", () => {
      ctrl.insert(glyph("A"));
      ctrl.insert(glyph("B"));
      ctrl.setEditingSlot(1, glyph("B"));

      ctrl.suspendEditing();
      ctrl.placeCaret(0);
      ctrl.insertMany([glyph("X"), glyph("Y")]);

      const restored = ctrl.resumeEditing();
      expect(restored?.index).toBe(3);
    });
  });
});
