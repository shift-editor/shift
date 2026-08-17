import { describe, it, expect, beforeEach } from "vitest";
import type { GlyphName } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

/**
 * Workspace-owned undo semantics: one operation = one entry, undo/redo replay
 * in order, and a new edit truncates the redo branch.
 */
describe("workspace ledger semantics (via TestEditor)", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
  });

  const source = () => editor.glyphLayer!;

  it("undoes settled operations in reverse order", async () => {
    await editor.clickGlyphLocal(10, 10);
    await editor.clickGlyphLocal(20, 20);
    expect(editor.pointCount).toBe(2);

    await editor.undo();
    expect(editor.pointCount).toBe(1);
    expect(source().allPoints[0]).toMatchObject({ x: 10, y: 10 });

    await editor.undo();
    expect(editor.pointCount).toBe(0);
  });

  it("redoes undone entries in order", async () => {
    await editor.clickGlyphLocal(10, 10);
    await editor.clickGlyphLocal(20, 20);

    await editor.undo();
    await editor.undo();
    expect(editor.pointCount).toBe(0);

    await editor.redo();
    expect(editor.pointCount).toBe(1);
    expect(source().allPoints[0]).toMatchObject({ x: 10, y: 10 });

    await editor.redo();
    expect(editor.pointCount).toBe(2);
  });

  it("a new edit after undo truncates the redo branch", async () => {
    await editor.clickGlyphLocal(10, 10);
    await editor.clickGlyphLocal(20, 20);

    await editor.undo();
    await editor.clickGlyphLocal(30, 30);
    expect(editor.pointCount).toBe(2);

    await editor.redo();
    expect(editor.pointCount).toBe(2);
    expect(source().allPoints.map(({ x }) => x)).toEqual([10, 30]);
  });

  it("undoes the session's glyph creation, then stops at the empty ledger", async () => {
    await editor.undo();
    expect(editor.font.recordForName("A" as GlyphName)).toBe(null);

    await editor.undo();
    expect(editor.font.recordForName("A" as GlyphName)).toBe(null);

    await editor.redo();
    expect(editor.font.recordForName("A" as GlyphName)).not.toBe(null);
  });

  it("groups transaction intents into a single entry", async () => {
    const initialAdvance = source().xAdvance;

    editor.transaction("Create contour and set advance", () => {
      const contourId = source().addContour();
      source().addOnCurvePoint(contourId, { x: 1, y: 2 });
      source().setXAdvance(640);
    });
    await editor.settle();
    expect(source().contours.length).toBe(1);
    expect(source().xAdvance).toBe(640);

    await editor.undo();
    expect(source().contours.length).toBe(0);
    expect(source().xAdvance).toBe(initialAdvance);
  });
});
