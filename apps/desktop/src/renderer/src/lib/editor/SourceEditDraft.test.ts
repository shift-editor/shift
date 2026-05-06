import { describe, expect, it } from "vitest";
import { createBridge } from "@shift/bridge";
import type { PointId } from "@shift/types";
import { signal } from "@/lib/signals/signal";
import { CommandHistory } from "@/lib/commands/core/CommandHistory";
import { Font } from "@/lib/model/Font";
import type { GlyphSource } from "@/lib/model/Glyph";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import { SourceEditDraft } from "./SourceEditDraft";

function editableSource(): GlyphSource {
  const bridge = createBridge();
  const font = new Font(bridge);
  font.load(MUTATORSANS_DESIGNSPACE);

  const handle = { name: "A", unicode: 65 };
  const source = font.sourceAt(font.defaultLocation());
  if (!source) throw new Error("Expected editable source");
  bridge.startEditSession(handle, source.id);

  const glyphSource = font.glyphSource(handle, source);
  if (!glyphSource) throw new Error("Expected editable glyph source");

  return glyphSource;
}

function pointPosition(source: GlyphSource, pointId: PointId): { x: number; y: number } {
  const point = source.point(pointId);
  if (!point) throw new Error("Expected point");

  return { x: point.x, y: point.y };
}

describe("SourceEditDraft", () => {
  it("previews, commits, and undoes a source edit through the real glyph source", () => {
    const source = editableSource();
    const point = source.allPoints[0];
    if (!point) throw new Error("Expected point");

    const start = pointPosition(source, point.id);
    const history = new CommandHistory(signal<GlyphSource | null>(source));
    const draft = new SourceEditDraft(source, history, { points: [point.id] });

    draft.previewTranslate({ x: 25, y: -10 });
    expect(pointPosition(source, point.id)).toEqual({ x: start.x + 25, y: start.y - 10 });

    draft.commit("Move Point");
    expect(pointPosition(source, point.id)).toEqual({ x: start.x + 25, y: start.y - 10 });

    history.undo();
    expect(pointPosition(source, point.id)).toEqual(start);
  });

  it("discards rule-driven previews that include points outside the initial subject", () => {
    const source = editableSource();
    const [first, second] = source.allPoints;
    if (!first || !second) throw new Error("Expected points");

    const firstStart = pointPosition(source, first.id);
    const secondStart = pointPosition(source, second.id);
    const history = new CommandHistory(signal<GlyphSource | null>(source));
    const draft = new SourceEditDraft(source, history, { points: [first.id] });

    draft.previewPositions([
      { kind: "point", id: first.id, x: firstStart.x + 10, y: firstStart.y },
      { kind: "point", id: second.id, x: secondStart.x + 20, y: secondStart.y },
    ]);

    expect(pointPosition(source, first.id).x).toBe(firstStart.x + 10);
    expect(pointPosition(source, second.id).x).toBe(secondStart.x + 20);

    draft.discard();

    expect(pointPosition(source, first.id)).toEqual(firstStart);
    expect(pointPosition(source, second.id)).toEqual(secondStart);
  });
});
