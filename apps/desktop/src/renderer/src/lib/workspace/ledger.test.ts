import { describe, it, expect, beforeEach } from "vitest";
import type { GlyphName } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

/**
 * The undo contracts that CommandHistory.test.ts protected before WS6, now
 * owned by the workspace ledger: one settled tick = one entry, undo/redo
 * replay in order, and a new edit truncates the redo branch.
 */
describe("workspace ledger semantics (via TestEditor)", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
  });

  const source = () => editor.glyphLayer!;

  it("undoes settled ticks in reverse order", async () => {
    editor.clickGlyphLocal(10, 10);
    await editor.settle();
    editor.clickGlyphLocal(20, 20);
    await editor.settle();
    expect(editor.pointCount).toBe(2);

    await editor.undoAndSettle();
    expect(editor.pointCount).toBe(1);
    expect(source().allPoints[0]).toMatchObject({ x: 10, y: 10 });

    await editor.undoAndSettle();
    expect(editor.pointCount).toBe(0);
  });

  it("redoes undone entries in order", async () => {
    editor.clickGlyphLocal(10, 10);
    await editor.settle();
    editor.clickGlyphLocal(20, 20);
    await editor.settle();

    await editor.undoAndSettle();
    await editor.undoAndSettle();
    expect(editor.pointCount).toBe(0);

    await editor.redoAndSettle();
    expect(editor.pointCount).toBe(1);
    expect(source().allPoints[0]).toMatchObject({ x: 10, y: 10 });

    await editor.redoAndSettle();
    expect(editor.pointCount).toBe(2);
  });

  it("a new edit after undo truncates the redo branch", async () => {
    editor.clickGlyphLocal(10, 10);
    await editor.settle();
    editor.clickGlyphLocal(20, 20);
    await editor.settle();

    await editor.undoAndSettle();
    editor.clickGlyphLocal(30, 30);
    await editor.settle();
    expect(editor.pointCount).toBe(2);

    await editor.redoAndSettle();
    expect(editor.pointCount).toBe(2);
    expect(source().allPoints.map(({ x }) => x)).toEqual([10, 30]);
  });

  it("undoes the session's glyph creation, then stops at the empty ledger", async () => {
    await editor.undoAndSettle();
    expect(editor.font.recordForName("A" as GlyphName)).toBe(null);

    await editor.undoAndSettle();
    expect(editor.font.recordForName("A" as GlyphName)).toBe(null);

    await editor.redoAndSettle();
    expect(editor.font.recordForName("A" as GlyphName)).not.toBe(null);
  });

  it("coalesces every intent in one tick into a single entry", async () => {
    const initialAdvance = source().xAdvance;

    const contourId = source().addContour();
    source().addOnCurvePoint(contourId, { x: 1, y: 2 });
    source().setXAdvance(640);
    await editor.settle();
    expect(source().contours.length).toBe(1);
    expect(source().xAdvance).toBe(640);

    await editor.undoAndSettle();
    expect(source().contours.length).toBe(0);
    expect(source().xAdvance).toBe(initialAdvance);
  });
});
