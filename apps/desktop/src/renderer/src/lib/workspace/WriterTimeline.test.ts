// SPIKE: the renderer engine as the only history for the edits it applies.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

interface EngineStats {
  applies: number;
  engineUndos: number;
  workspaceUndos: number;
  echoMismatches: number;
}

function engineStats(): EngineStats {
  const engine = (globalThis as { __shiftEngine?: { stats: EngineStats } }).__shiftEngine;
  if (!engine) throw new Error("engine is not loaded");
  return { ...engine.stats };
}

describe.runIf(process.env.SHIFT_WASM_ENGINE === "writer")("single undo timeline", () => {
  it("undoes and redoes engine edits without the workspace ledger, and persists them", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-writer-timeline-"));
    const savePath = join(outputRoot, "Timeline.shift");
    const editor = new TestEditor();
    try {
      await editor.startSession();
      await editor.saveAs(savePath);
      const before = engineStats();

      const points = await editor.drawOpenContour([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 0 },
      ]);
      await editor.settle();
      const drawn = editor.requireGlyphLayer().state;
      await expect(editor.font.editCoordinator.state()).resolves.toMatchObject({ dirty: true });

      // Undo everything back to the saved document, then redo it all.
      let undos = 0;
      while (editor.requireGlyphLayer().contours.length > 0) {
        await editor.undo();
        undos += 1;
      }
      await editor.settle();
      await expect(editor.font.editCoordinator.state()).resolves.toMatchObject({ dirty: false });
      for (let redo = 0; redo < undos; redo++) await editor.redo();
      await editor.settle();

      expect(editor.requireGlyphLayer().state).toEqual(drawn);
      const after = engineStats();
      expect(after.applies - before.applies).toBeGreaterThan(0);
      expect(after.engineUndos - before.engineUndos).toBe(undos * 2);
      expect(after.workspaceUndos - before.workspaceUndos).toBe(0);
      expect(after.echoMismatches).toBe(0);

      await editor.saveAs(savePath);
      await editor.closeSession();

      const reopened = new TestEditor();
      await reopened.openSession(savePath, "A");
      expect(reopened.requireGlyphLayer().state).toEqual(drawn);
      expect(reopened.requireGlyphLayer().point(points[1])).not.toBeNull();
      await reopened.closeSession();
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
