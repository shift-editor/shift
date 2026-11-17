import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asGlyphId, type NodeId } from "@shift/types";
import { startEmptyMemorySession } from "../../../testing/emptyMemorySession";
import type { MemoryFontSession } from "../../../types/fontSession";
import type { GlyphNode } from "../../../types/node";
import type { Editor } from "../Editor";
import type { HistoryReplay } from "../../../types/history";
import { effect } from "../../signals";

describe("EditorHistory", () => {
  let session: MemoryFontSession;
  let editor: Editor;
  let firstId: NodeId;
  let secondId: NodeId;

  beforeEach(async () => {
    session = await startEmptyMemorySession();
    editor = session.editor;
    const place = (x: number) =>
      editor.scene.createNode<GlyphNode>({
        kind: "glyph",
        glyphId: asGlyphId("glyph_A"),
        sourceId: editor.font.defaultSource.id,
        position: { x, y: 0 },
      }).id;
    firstId = place(0);
    secondId = place(700);
    editor.selection.clear();
  });
  afterEach(() => session.dispose());

  it("captures a synchronous action and returns its result", async () => {
    const result = editor.history.capture("Select", () => {
      editor.selection.select([firstId]);
      return firstId;
    });

    expect(result).toBe(firstId);
    await editor.history.undo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("announces each step undo and redo replay, by the name its action gave it", async () => {
    editor.history.capture("Select", () => editor.selection.select([firstId]));
    const seen: (HistoryReplay | null)[] = [];
    const subscription = effect(() => {
      seen.push(editor.history.replayedCell.value);
    });

    await editor.history.undo();
    await editor.history.redo();
    await editor.history.undo();
    subscription.dispose();

    expect(seen).toEqual([
      null,
      { direction: "undo", label: "Select" },
      { direction: "redo", label: "Select" },
      { direction: "undo", label: "Select" },
    ]);
  });

  it("cancels a synchronous action that throws", () => {
    expect(() =>
      editor.history.capture("Rejected selection", () => {
        editor.selection.select([firstId]);
        throw new Error("selection failed");
      }),
    ).toThrow("selection failed");

    expect(editor.selection.ids).toEqual([]);
    expect(editor.history.capturing).toBe(false);
  });

  it("captures an asynchronous action and returns its result", async () => {
    const result = await editor.history.captureAsync("Select", async () => {
      await Promise.resolve();
      editor.selection.select([firstId]);
      return firstId;
    });

    expect(result).toBe(firstId);
    await editor.history.undo();
    expect(editor.selection.ids).toEqual([]);
  });

  it("cancels an asynchronous action that rejects", async () => {
    const action = editor.history.captureAsync("Rejected selection", async () => {
      editor.selection.select([firstId]);
      await Promise.resolve();
      throw new Error("selection failed");
    });

    await expect(action).rejects.toThrow("selection failed");
    expect(editor.selection.ids).toEqual([]);
    expect(editor.history.capturing).toBe(false);
  });

  it("drops journaled net-zero writes without clearing redo", async () => {
    editor.history.capture("Select", () => editor.selection.select([firstId]));
    await editor.history.undo();

    editor.history.capture("Net-zero selection", () => {
      editor.selection.select([secondId]);
      editor.selection.clear();
    });
    await editor.history.redo();

    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("ignores stale selection identities after scene navigation", async () => {
    editor.history.capture("Select", () => editor.selection.select([firstId]));
    editor.scene.clear();
    editor.selection.clear();

    await editor.history.undo();
    await editor.history.redo();

    expect(editor.selection.ids).toEqual([]);
  });
});
