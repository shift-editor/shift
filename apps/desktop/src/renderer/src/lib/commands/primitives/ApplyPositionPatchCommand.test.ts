import { describe, expect, it } from "vitest";
import { createBridge } from "@shift/bridge";
import type { PointId } from "@shift/types";
import { ApplyPositionPatchCommand } from "./ApplyPositionPatchCommand";
import { Font } from "@/lib/model/Font";
import type { GlyphSource } from "@/lib/model/Glyph";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import type { CommandContext } from "../core";

function editableSource(): GlyphSource {
  const bridge = createBridge();
  const font = new Font(bridge);
  font.load(MUTATORSANS_DESIGNSPACE);

  const handle = { name: "A", unicode: 65 };
  const source = font.defaultSource;
  bridge.startEditSession(handle, source.id);

  const glyphSource = font.glyphSource(handle, source);
  if (!glyphSource) throw new Error("Expected editable glyph source");

  return glyphSource;
}

function ctx(source: GlyphSource): CommandContext {
  return { source };
}

function pointPosition(source: GlyphSource, pointId: PointId): { x: number; y: number } {
  const point = source.point(pointId);
  if (!point) throw new Error("Expected point");

  return { x: point.x, y: point.y };
}

describe("ApplyPositionPatchCommand", () => {
  it("replays after positions and restores before positions", () => {
    const source = editableSource();
    const point = source.allPoints[0];
    if (!point) throw new Error("Expected point");

    const before = [
      {
        kind: "point" as const,
        id: point.id,
        ...pointPosition(source, point.id),
      },
    ];
    const after = [
      {
        kind: "point" as const,
        id: point.id,
        x: before[0].x + 15,
        y: before[0].y + 5,
      },
    ];
    const command = new ApplyPositionPatchCommand("Move Selection", before, after);

    command.execute(ctx(source));
    expect(pointPosition(source, point.id)).toEqual({
      x: after[0].x,
      y: after[0].y,
    });

    command.undo(ctx(source));
    expect(pointPosition(source, point.id)).toEqual({
      x: before[0].x,
      y: before[0].y,
    });

    command.redo(ctx(source));
    expect(pointPosition(source, point.id)).toEqual({
      x: after[0].x,
      y: after[0].y,
    });
  });

  it("derives before positions from the source", () => {
    const source = editableSource();
    const point = source.allPoints[0];
    if (!point) throw new Error("Expected point");

    const start = pointPosition(source, point.id);
    const after = [{ kind: "point" as const, id: point.id, x: start.x + 15, y: start.y + 5 }];
    const command = ApplyPositionPatchCommand.fromSource("Move Selection", source, after);
    if (!command) throw new Error("Expected command");

    command.execute(ctx(source));
    expect(pointPosition(source, point.id)).toEqual({
      x: after[0].x,
      y: after[0].y,
    });

    command.undo(ctx(source));
    expect(pointPosition(source, point.id)).toEqual(start);
  });
});
