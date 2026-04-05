import { describe, expect, it, beforeEach } from "vitest";
import { asPointId } from "@shift/types";
import { createMockFontEngine, getAllPoints } from "@/testing";
import { NodePositionPatchCommand } from "./NodePositionPatchCommand";
import type { FontEngine } from "@/engine";
import type { CommandContext } from "../core";

let fontEngine: FontEngine;

function ctx(): CommandContext {
  return { fontEngine, glyph: fontEngine.getGlyph() };
}

beforeEach(() => {
  fontEngine = createMockFontEngine();
  fontEngine.startEditSession({ glyphName: "A", unicode: 65 });
  fontEngine.addContour();
});

describe("NodePositionPatchCommand", () => {
  it("applies after positions on execute", () => {
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new NodePositionPatchCommand("Move Nodes", [
      {
        node: { kind: "point", id: p1 },
        before: { x: 10, y: 20 },
        after: { x: 30, y: 40 },
      },
    ]);

    cmd.execute(ctx());

    expect(cmd.name).toBe("Move Nodes");
    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(30);
    expect(points[0]!.y).toBe(40);
  });

  it("restores before positions on undo", () => {
    const p1 = fontEngine.addPoint({ x: 10, y: 20, pointType: "onCurve", smooth: false });
    const cmd = new NodePositionPatchCommand("Move Nodes", [
      {
        node: { kind: "point", id: p1 },
        before: { x: 10, y: 20 },
        after: { x: 30, y: 40 },
      },
    ]);

    cmd.execute(ctx());
    cmd.undo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(10);
    expect(points[0]!.y).toBe(20);
  });

  it("redo delegates to execute", () => {
    const p1 = fontEngine.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
    const cmd = new NodePositionPatchCommand("Move Nodes", [
      {
        node: { kind: "point", id: p1 },
        before: { x: 0, y: 0 },
        after: { x: 1, y: 2 },
      },
    ]);

    cmd.execute(ctx());
    cmd.undo(ctx());
    cmd.redo(ctx());

    const points = getAllPoints(fontEngine.getGlyph());
    expect(points[0]!.x).toBe(1);
    expect(points[0]!.y).toBe(2);
  });
});
