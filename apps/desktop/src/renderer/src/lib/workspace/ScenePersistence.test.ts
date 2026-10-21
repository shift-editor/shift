import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlyphName } from "@shift/types";
import { characterTextItem } from "@shift/editor/text";
import { TestEditor } from "@/testing/TestEditor";

const outputRoots: string[] = [];

afterEach(() => {
  for (const root of outputRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function savePath(): string {
  const root = mkdtempSync(join(tmpdir(), "shift-scene-persistence-"));
  outputRoots.push(root);
  return join(root, "Scene.shift");
}

/** Starts on `A` with `B` loaded, types `B` after `A`, and edits the typed `B`. */
async function editedRun(editor: TestEditor): Promise<void> {
  await editor.startSession("A", 65);
  await editor.addGlyph("B", 66);
  editor.selectTool("text");
  editor.textEditing.insert([characterTextItem(66)]);
  editor.selectTool("select");
  const run = editor.textRun!;
  const typed = editor.text.run(run.runId)!.items[1]!;
  editor.history.capture("Edit glyph", () => {
    const child = editor.nodeDefinition("textRun").editItem(run, typed.id);
    if (child) editor.enterNode(child.id);
  });
}

function runCodepoints(editor: TestEditor): number[] {
  const items = editor.text.run(editor.textRun!.runId)?.items ?? [];
  return items.flatMap((item) => (item.kind === "character" ? [item.codepoint] : []));
}

describe("the canvas reopens with its document", () => {
  it("restores the run text and the edited glyph", async () => {
    const path = savePath();
    const original = new TestEditor();
    await editedRun(original);
    const editedItemId = original.runGlyph!.itemId;
    await original.saveAs(path);
    await original.closeSession();

    const reopened = new TestEditor();
    await reopened.openSession(path, "B");

    const b = reopened.font.recordForName("B" as GlyphName)!;
    expect(runCodepoints(reopened)).toEqual([65, 66]);
    expect(reopened.runGlyph).toMatchObject({ glyphId: b.id, itemId: editedItemId });
    await expect(reopened.font.editCoordinator.state()).resolves.toMatchObject({ dirty: false });
    await reopened.closeSession();
  });

  it("keeps selection and the text caret out of the document", async () => {
    const path = savePath();
    const original = new TestEditor();
    await editedRun(original);
    original.selectTool("text");
    expect(original.textEditing.state).not.toBeNull();
    await original.saveAs(path);
    await original.closeSession();

    const reopened = new TestEditor();
    await reopened.openSession(path, "B");

    expect(reopened.textEditing.state).toBeNull();
    expect(reopened.selection.ids).toEqual([]);
    await reopened.closeSession();
  });

  it("drops a stored child glyph whose run item is gone", async () => {
    const path = savePath();
    const original = new TestEditor();
    await editedRun(original);
    await original.saveAs(path);
    const stored = (await original.storedSceneState())!;
    const payload = JSON.parse(stored.payload) as {
      records: { type: string; items?: unknown[] }[];
    };
    for (const record of payload.records) {
      if (record.type === "textrun") record.items = record.items?.slice(0, 1);
    }
    await original.workspaceEditCoordinator.setSceneState({
      version: stored.version,
      payload: JSON.stringify(payload),
    });
    await original.save();
    await original.closeSession();

    const reopened = new TestEditor();
    await reopened.openSession(path, "A");

    expect(runCodepoints(reopened)).toEqual([65]);
    expect(reopened.runGlyph?.glyphId).toBe(reopened.font.recordForName("A" as GlyphName)!.id);
    await reopened.closeSession();
  });
});

describe("canvas writes", () => {
  it("are flushed into a save issued before their quiet period ends", async () => {
    const path = savePath();
    const editor = new TestEditor("workspace", { sceneDelayMs: 60_000 });
    await editor.startSession("A", 65);
    await editor.saveAs(path);
    editor.selectTool("text");
    editor.textEditing.insert([characterTextItem(65)]);
    await expect(editor.font.editCoordinator.state()).resolves.toMatchObject({ dirty: false });

    await editor.save();
    await editor.closeSession();

    const reopened = new TestEditor();
    await reopened.openSession(path, "A");
    expect(runCodepoints(reopened)).toEqual([65, 65]);
    await reopened.closeSession();
  });

  it("mark the document dirty once the canvas is quiet", async () => {
    const editor = new TestEditor("workspace", { sceneDelayMs: 5 });
    await editor.startSession("A", 65);
    await editor.saveAs(savePath());
    editor.selectTool("text");
    editor.textEditing.insert([characterTextItem(65)]);

    await vi.waitFor(async () => {
      expect(await editor.font.editCoordinator.state()).toMatchObject({ dirty: true });
    });

    expect(await editor.storedSceneState()).not.toBeNull();
    await editor.save();
    await editor.closeSession();
  });
});
