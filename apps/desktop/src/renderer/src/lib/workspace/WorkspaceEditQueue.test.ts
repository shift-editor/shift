import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type FontIntent, type GlyphName, type Unicode, mintGlyphId } from "@shift/types";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

const createGlyph = (name: string, unicode: number): FontIntent => ({
  kind: "createGlyph",
  createGlyph: { glyphId: mintGlyphId(), name: name as GlyphName, unicodes: [unicode as Unicode] },
});

const savePath = (): string => join(mkdtempSync(join(tmpdir(), "shift-save-")), "Saved.shift");

describe("WorkspaceEditQueue issues save on the committed-op lane", () => {
  let stack: WorkspaceStack;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.client.create();
  });

  it("flushes queued edits before the save so the write includes them", async () => {
    const { client, editQueue } = stack;

    editQueue.push(createGlyph("A", 65)); // queued, not yet applied
    const saved = await editQueue.save(savePath()); // flushes the push, then saves behind it

    expect(client.$workspace.peek()?.glyphs).toHaveLength(1); // the apply was folded
    expect(saved).toMatchObject({ dirty: false, needsSaveAs: false });
  });

  it("a current-target save serializes behind a later edit", async () => {
    const { client, editQueue } = stack;
    await editQueue.save(savePath()); // adopt a package target

    editQueue.push(createGlyph("B", 66));
    const saved = await editQueue.save(null); // null = save to current target

    expect(client.$workspace.peek()?.glyphs).toHaveLength(1);
    expect(saved).toMatchObject({ dirty: false });
  });
});
