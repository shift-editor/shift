import { describe, expect, it } from "vitest";
import { SetNodePositionsCommand } from "./SetNodePositionsCommand";
import { createMockCommandContext } from "@/testing";
import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { asAnchorId, asContourId, asPointId } from "@shift/types";

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

describe("SetNodePositionsCommand", () => {
  it("derives batched point and anchor updates from a move-only glyph diff", () => {
    const before = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [
            {
              id: asPointId("point-1"),
              x: 10,
              y: 20,
              pointType: "onCurve",
              smooth: false,
            } satisfies PointSnapshot,
            {
              id: asPointId("point-2"),
              x: 30,
              y: 40,
              pointType: "offCurve",
              smooth: false,
            } satisfies PointSnapshot,
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
            {
              id: asPointId("point-1"),
              x: 15,
              y: 25,
              pointType: "onCurve",
              smooth: false,
            } satisfies PointSnapshot,
            {
              id: asPointId("point-2"),
              x: 30,
              y: 40,
              pointType: "offCurve",
              smooth: false,
            } satisfies PointSnapshot,
          ],
        },
      ],
      anchors: [{ id: asAnchorId("anchor-1"), name: "top", x: 4, y: 5 }],
    });

    const command = SetNodePositionsCommand.fromGlyphDiff("Move Selection", before, after);

    expect(command).not.toBeNull();

    const ctx = createMockCommandContext(after);
    command!.execute(ctx);

    expect(ctx.fontEngine.editing.setNodePositions).toHaveBeenCalledWith([
      { node: { kind: "point", id: asPointId("point-1") }, x: 15, y: 25 },
      { node: { kind: "anchor", id: asAnchorId("anchor-1") }, x: 4, y: 5 },
    ]);

    command!.undo(ctx);

    expect(ctx.fontEngine.editing.setNodePositions).toHaveBeenLastCalledWith([
      { node: { kind: "point", id: asPointId("point-1") }, x: 10, y: 20 },
      { node: { kind: "anchor", id: asAnchorId("anchor-1") }, x: 1, y: 2 },
    ]);
  });

  it("falls back when the glyph diff changes topology", () => {
    const before = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [
            {
              id: asPointId("point-1"),
              x: 10,
              y: 20,
              pointType: "onCurve",
              smooth: false,
            } satisfies PointSnapshot,
          ],
        },
      ],
    });
    const after = makeGlyph({
      contours: [
        {
          id: asContourId("contour-1"),
          closed: false,
          points: [
            {
              id: asPointId("point-1"),
              x: 10,
              y: 20,
              pointType: "onCurve",
              smooth: false,
            } satisfies PointSnapshot,
            {
              id: asPointId("point-2"),
              x: 30,
              y: 40,
              pointType: "onCurve",
              smooth: false,
            } satisfies PointSnapshot,
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
          points: [
            {
              id: asPointId("point-1"),
              x: 10,
              y: 20,
              pointType: "onCurve",
              smooth: false,
            } satisfies PointSnapshot,
          ],
        },
      ],
      anchors: [{ id: asAnchorId("anchor-1"), name: "top", x: 1, y: 2 }],
    });

    const command = SetNodePositionsCommand.fromBaseGlyphAndUpdates("Move Selection", base, [
      { node: { kind: "point", id: asPointId("point-1") }, x: 15, y: 25 },
      { node: { kind: "anchor", id: asAnchorId("anchor-1") }, x: 4, y: 5 },
    ]);

    expect(command).not.toBeNull();

    const ctx = createMockCommandContext(base);
    command!.undo(ctx);

    expect(ctx.fontEngine.editing.setNodePositions).toHaveBeenCalledWith([
      { node: { kind: "point", id: asPointId("point-1") }, x: 10, y: 20 },
      { node: { kind: "anchor", id: asAnchorId("anchor-1") }, x: 1, y: 2 },
    ]);
  });
});
