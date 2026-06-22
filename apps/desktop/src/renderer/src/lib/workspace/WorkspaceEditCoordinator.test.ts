import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mintAxisId,
  mintGlyphId,
  mintLayerId,
  type FontIntent,
  type GlyphName,
  type Unicode,
} from "@shift/types";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

const createGlyph = (name: string, unicode: number): FontIntent => ({
  kind: "createGlyph",
  createGlyph: { glyphId: mintGlyphId(), name: name as GlyphName, unicodes: [unicode as Unicode] },
});

const savePath = (): string => join(mkdtempSync(join(tmpdir(), "shift-save-")), "Saved.shift");

describe("WorkspaceEditCoordinator issues save on the committed-op lane", () => {
  let stack: WorkspaceStack;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.createWorkspace();
  });

  it("flushes queued edits before the save so the write includes them", async () => {
    const { store, editCoordinator } = stack;

    editCoordinator.push(createGlyph("A", 65)); // queued, not yet applied
    const saved = await editCoordinator.save(savePath()); // flushes the push, then saves behind it

    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(1); // the apply was folded
    expect(saved).toMatchObject({ dirty: false, needsSaveAs: false });
  });

  it("a current-target save serializes behind a later edit", async () => {
    const { store, editCoordinator } = stack;
    await editCoordinator.save(savePath()); // adopt a package target

    editCoordinator.push(createGlyph("B", 66));
    const saved = await editCoordinator.save(null); // null = save to current target

    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(1);
    expect(saved).toMatchObject({ dirty: false });
  });

  it("marks locally committed edits as queued until the utility echo settles", async () => {
    const { client, editCoordinator } = stack;
    await editCoordinator.save(savePath());

    editCoordinator.push(createGlyph("C", 67));

    expect(editCoordinator.commitStateCell.peek()).toBe("queued");
    await editCoordinator.settled();
    expect(editCoordinator.commitStateCell.peek()).toBe("idle");
    expect(client.documentStateCell.peek()).toMatchObject({ dirty: true });
  });

  it("marks snapshot loads after queued workspace summary edits flush", async () => {
    const { font, store, editCoordinator } = stack;
    const glyphId = mintGlyphId();
    const layerId = mintLayerId();
    await editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId, name: "D" as GlyphName, unicodes: [68 as Unicode] },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId: font.defaultSource.id },
      },
    ]);
    await font.ensureGlyphs([glyphId]);

    const axisId = mintAxisId();
    editCoordinator.push({
      kind: "createAxis",
      createAxis: {
        axisId,
        tag: "wght",
        name: "Weight",
        min: 100,
        default: 400,
        max: 900,
        hidden: false,
      },
    });

    await font.ensureGlyphs([glyphId]);

    expect(font.getAxes().map((axis) => axis.id)).toEqual([axisId]);
    expect(store.snapshotStatus(glyphId)).toBe("loaded");
  });
});
