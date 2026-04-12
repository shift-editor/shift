import { describe, expect, it, beforeEach } from "vitest";
import { SetNodePositionsCommand } from "./SetNodePositionsCommand";
import { createBridge } from "@/testing";
import type { GlyphSnapshot } from "@shift/types";
import { asAnchorId, asContourId, asPointId } from "@shift/types";
import type { NativeBridge } from "@/bridge";
import type { CommandContext } from "../core";

function makeGlyph(input: {
  contours?: GlyphSnapshot["contours"];
  anchors?: GlyphSnapshot["anchors"];
}): GlyphSnapshot {
  return {
    unicode: 65,
    name: "A",
    xAdvance: 500,
    contours: input.contours ?? [],
    anchors: input.anchors ?? [],
    compositeContours: [],
    activeContourId: input.contours?.[0]?.id ?? null,
  };
}

let bridge: NativeBridge;

function ctx(): CommandContext {
  return { glyph: bridge.$glyph.peek()! };
}

beforeEach(() => {
  bridge = createBridge();
  bridge.startEditSession("A");
  bridge.addContour();
});

describe("SetNodePositionsCommand", () => {
  it("derives batched point and anchor updates from a move-only glyph diff", () => {
    const before = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [
            { id: asPointId("point-1"), x: 10, y: 20, pointType: "onCurve", smooth: false },
            { id: asPointId("point-2"), x: 30, y: 40, pointType: "offCurve", smooth: false },
          ],
        },
      ],
      anchors: [{ id: asAnchorId("anchor-1"), name: "top", x: 1, y: 2 }],
    });
    const after = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [
            { id: asPointId("point-1"), x: 15, y: 25, pointType: "onCurve", smooth: false },
            { id: asPointId("point-2"), x: 30, y: 40, pointType: "offCurve", smooth: false },
          ],
        },
      ],
      anchors: [{ id: asAnchorId("anchor-1"), name: "top", x: 4, y: 5 }],
    });

    const command = SetNodePositionsCommand.fromGlyphDiff("Move Selection", before, after);

    expect(command).not.toBeNull();

    // Load the "after" state into the engine so undo can move it back to "before"
    bridge.restoreSnapshot(after);
    command!.execute(ctx());

    // Verify the after positions were applied
    const glyph = bridge.getEditingSnapshot()!;
    const p1 = glyph.contours[0]!.points.find((p) => p.id === asPointId("point-1"))!;
    expect(p1.x).toBe(15);
    expect(p1.y).toBe(25);

    command!.undo(ctx());

    // Verify the before positions were restored
    const undoGlyph = bridge.getEditingSnapshot()!;
    const p1Undo = undoGlyph.contours[0]!.points.find((p) => p.id === asPointId("point-1"))!;
    expect(p1Undo.x).toBe(10);
    expect(p1Undo.y).toBe(20);
  });

  it("falls back when the glyph diff changes topology", () => {
    const before = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [{ id: asPointId("point-1"), x: 10, y: 20, pointType: "onCurve", smooth: false }],
        },
      ],
    });
    const after = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [
            { id: asPointId("point-1"), x: 10, y: 20, pointType: "onCurve", smooth: false },
            { id: asPointId("point-2"), x: 30, y: 40, pointType: "onCurve", smooth: false },
          ],
        },
      ],
    });

    expect(SetNodePositionsCommand.fromGlyphDiff("Move Selection", before, after)).toBeNull();
  });

  it("derives before updates directly from a base glyph and known updates", () => {
    const base = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [{ id: asPointId("point-1"), x: 10, y: 20, pointType: "onCurve", smooth: false }],
        },
      ],
      anchors: [{ id: asAnchorId("anchor-1"), name: "top", x: 1, y: 2 }],
    });

    const command = SetNodePositionsCommand.fromBaseGlyphAndUpdates("Move Selection", base, [
      { node: { kind: "point", id: asPointId("point-1") }, x: 15, y: 25 },
      { node: { kind: "anchor", id: asAnchorId("anchor-1") }, x: 4, y: 5 },
    ]);

    expect(command).not.toBeNull();

    // Load the base state and apply the "after" updates, then undo
    bridge.restoreSnapshot(base);
    command!.execute(ctx());

    const glyph = bridge.getEditingSnapshot()!;
    const p1 = glyph.contours[0]!.points.find((p) => p.id === asPointId("point-1"))!;
    expect(p1.x).toBe(15);
    expect(p1.y).toBe(25);

    command!.undo(ctx());

    const undoGlyph = bridge.getEditingSnapshot()!;
    const p1Undo = undoGlyph.contours[0]!.points.find((p) => p.id === asPointId("point-1"))!;
    expect(p1Undo.x).toBe(10);
    expect(p1Undo.y).toBe(20);
  });
});
