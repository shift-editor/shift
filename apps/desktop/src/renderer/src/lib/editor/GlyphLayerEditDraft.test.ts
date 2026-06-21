import { describe, expect, it, beforeEach } from "vitest";
import type { PointId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";
import { TestEditor } from "@/testing/TestEditor";
import { GlyphLayerEditDraft } from "./GlyphLayerEditDraft";

// Restored from the WS6 behavioral inventory (git show ef037c6e^); drafts no
// longer record commands — the movePoints intent from commit IS the ledger
// entry, so undo goes through the workspace.
function pointPosition(source: GlyphLayer, pointId: PointId): { x: number; y: number } {
  const point = source.point(pointId);
  if (!point) throw new Error("Expected point");

  return { x: point.x, y: point.y };
}

function pointBase(draft: GlyphLayerEditDraft, pointId: PointId): { x: number; y: number } {
  const position = draft.basePositions.find(
    (position) => position.kind === "point" && position.id === pointId,
  );
  if (!position) throw new Error("Expected draft base point");

  return { x: position.x, y: position.y };
}

describe("glyph layer edit drafts preserve committed preview bases", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(100, 100);
    await editor.settle();
    editor.clickGlyphLocal(300, 200);
    await editor.settle();
  });

  const source = () => editor.editingGlyphLayer!;

  it("previews, commits, and undoes a layer edit through the real glyph layer", async () => {
    const point = source().allPoints[0]!;
    const start = pointPosition(source(), point.id);
    const draft = new GlyphLayerEditDraft(source(), { points: [point.id] });

    draft.previewTranslate({ x: 25, y: -10 });
    expect(pointPosition(source(), point.id)).toEqual({ x: start.x + 25, y: start.y - 10 });

    draft.commit();
    await editor.settle();
    expect(pointPosition(source(), point.id)).toEqual({ x: start.x + 25, y: start.y - 10 });

    await editor.undoAndSettle();
    expect(pointPosition(source(), point.id)).toEqual(start);
  });

  it("discards rule-driven previews that include points outside the initial subject", () => {
    const [first, second] = source().allPoints;
    const firstStart = pointPosition(source(), first!.id);
    const secondStart = pointPosition(source(), second!.id);
    const draft = new GlyphLayerEditDraft(source(), { points: [first!.id] });

    draft.previewPositionPatch([
      { kind: "point", id: first!.id, x: firstStart.x + 10, y: firstStart.y },
      { kind: "point", id: second!.id, x: secondStart.x + 20, y: secondStart.y },
    ]);

    expect(pointPosition(source(), first!.id).x).toBe(firstStart.x + 10);
    expect(pointPosition(source(), second!.id).x).toBe(secondStart.x + 20);

    draft.discard();

    expect(pointPosition(source(), first!.id)).toEqual(firstStart);
    expect(pointPosition(source(), second!.id)).toEqual(secondStart);
  });

  it("starts the next draft from a committed preview position", async () => {
    const point = source().allPoints[0]!;
    const start = pointPosition(source(), point.id);
    const firstDraft = new GlyphLayerEditDraft(source(), { points: [point.id] });

    firstDraft.previewTranslate({ x: 25, y: -10 });
    firstDraft.commit();
    await editor.settle();

    const secondDraft = new GlyphLayerEditDraft(source(), { points: [point.id] });

    expect(pointBase(secondDraft, point.id)).toEqual({ x: start.x + 25, y: start.y - 10 });
  });

  it("starts later drafts from rule-expanded committed preview positions", async () => {
    const [first, second] = source().allPoints;
    const firstStart = pointPosition(source(), first!.id);
    const secondStart = pointPosition(source(), second!.id);
    const draft = new GlyphLayerEditDraft(source(), { points: [first!.id] });

    draft.previewPositionPatch([
      { kind: "point", id: first!.id, x: firstStart.x + 10, y: firstStart.y },
      { kind: "point", id: second!.id, x: secondStart.x + 20, y: secondStart.y },
    ]);
    draft.commit();
    await editor.settle();

    const nextDraft = new GlyphLayerEditDraft(source(), { points: [second!.id] });

    expect(pointBase(nextDraft, second!.id)).toEqual({ x: secondStart.x + 20, y: secondStart.y });
  });
});
