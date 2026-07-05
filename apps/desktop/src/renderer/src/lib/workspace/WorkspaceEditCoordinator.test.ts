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

  it("keeps separate pushes as separate undo entries", async () => {
    const { store, editCoordinator } = stack;

    editCoordinator.push(createGlyph("A", 65));
    editCoordinator.push(createGlyph("B", 66));
    await editCoordinator.settled();

    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(2);

    await editCoordinator.undo();
    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(1);

    await editCoordinator.undo();
    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(0);
  });

  it("groups transaction pushes into one undo entry", async () => {
    const { store, editCoordinator } = stack;

    editCoordinator.transaction("Create glyph pair", () => {
      editCoordinator.push(createGlyph("A", 65));
      editCoordinator.push(createGlyph("B", 66));
    });
    await editCoordinator.settled();

    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(2);

    await editCoordinator.undo();
    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(0);
  });

  it("flattens nested transaction pushes into the outer undo entry", async () => {
    const { store, editCoordinator } = stack;

    editCoordinator.transaction("Create outer pair", () => {
      editCoordinator.push(createGlyph("A", 65));
      editCoordinator.transaction("Create nested glyph", () => {
        editCoordinator.push(createGlyph("B", 66));
      });
    });
    await editCoordinator.settled();

    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(2);

    await editCoordinator.undo();
    expect(store.workspaceCell.peek()?.glyphs).toHaveLength(0);
  });

  it("loads glyph layers after queued workspace summary edits flush", async () => {
    const { font, editCoordinator } = stack;
    const glyphId = mintGlyphId();
    const layerId = mintLayerId();
    const sourceId = font.defaultSource.id;
    await editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: { glyphId, name: "D" as GlyphName, unicodes: [68 as Unicode] },
      },
      {
        kind: "createGlyphLayer",
        createGlyphLayer: { layerId, glyphId, sourceId },
      },
    ]);
    await font.loadGlyph(glyphId);

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

    await font.loadGlyph(glyphId);

    expect(font.getAxes().map((axis) => axis.id)).toEqual([axisId]);
    expect(font.layer(glyphId, sourceId)).not.toBeNull();
  });
});
