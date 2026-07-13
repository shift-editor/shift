import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createBridge } from "@shift/bridge";
import {
  mintAxisId,
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  type FontIntent,
  type GlyphName,
  type Unicode,
} from "@shift/types";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

const createGlyph = (
  name: string,
  unicode: number,
  glyphId: ReturnType<typeof mintGlyphId> = mintGlyphId(),
): FontIntent => ({
  kind: "createGlyph",
  createGlyph: {
    glyphId,
    name: name as GlyphName,
    unicodes: [unicode as Unicode],
  },
});

const savePath = (): string => join(mkdtempSync(join(tmpdir(), "shift-save-")), "Saved.shift");

function queueOutlinedGlyph(stack: WorkspaceStack, name: string, unicode: number): void {
  const glyphId = mintGlyphId();
  const layerId = mintLayerId();
  const contourId = mintContourId();
  const intents: FontIntent[] = [
    createGlyph(name, unicode, glyphId),
    {
      kind: "createGlyphLayer",
      createGlyphLayer: {
        glyphId,
        layerId,
        sourceId: stack.font.defaultSource.id,
      },
    },
    { kind: "setXAdvance", setXAdvance: { layerId, width: 600 } },
    { kind: "addContour", addContour: { layerId, contourId, closed: true } },
    {
      kind: "addPoints",
      addPoints: {
        layerId,
        contourId,
        points: [
          {
            id: mintPointId(),
            x: 100,
            y: 0,
            pointType: "onCurve",
            smooth: false,
          },
          {
            id: mintPointId(),
            x: 300,
            y: 700,
            pointType: "onCurve",
            smooth: false,
          },
          {
            id: mintPointId(),
            x: 500,
            y: 0,
            pointType: "onCurve",
            smooth: false,
          },
        ],
      },
    },
  ];

  stack.editCoordinator.transaction(`Create ${name}`, () => {
    for (const intent of intents) stack.editCoordinator.push(intent);
  });
}

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

  it("exports queued edits from one immutable snapshot while later edits continue", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-export-"));
    const outputPath = join(outputRoot, "Queued.ttf");
    queueOutlinedGlyph(stack, "A", 65);

    const exporting = stack.editCoordinator.export(outputPath);
    queueOutlinedGlyph(stack, "B", 66);
    await exporting;
    await stack.editCoordinator.settled();

    const compiled = createBridge();
    compiled.openWorkspace(outputPath, join(outputRoot, "compiled.sqlite3"));
    const unicodes = compiled.getGlyphs().flatMap((glyph) => glyph.unicodes);
    expect(unicodes).toEqual([65]);
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
        createGlyph: {
          glyphId,
          name: "D" as GlyphName,
          unicodes: [68 as Unicode],
        },
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
        axis: {
          id: axisId,
          tag: "wght",
          name: "Weight",
          role: "external",
          axisType: "continuous",
          minimum: 100,
          default: 400,
          maximum: 900,
          labels: [],
          hidden: false,
        },
      },
    });

    await font.loadGlyph(glyphId);

    expect(font.getAxes().map((axis) => axis.id)).toEqual([axisId]);
    expect(font.layer(glyphId, sourceId)).not.toBeNull();
  });
});
