import { describe, expect, it, vi } from "vitest";
import type { AnchorId, PointId } from "@shift/types";
import { PreparedNodeTransformSession } from "./PreparedNodeTransformSession";

function asPointId(id: string): PointId {
  return id as PointId;
}

function asAnchorId(id: string): AnchorId {
  return id as AnchorId;
}

describe("PreparedNodeTransformSession", () => {
  it("uses the prepared transform fast path for translations when available", () => {
    const editing = {
      prepareNodeTransform: vi.fn(() => true),
      applyPreparedNodeTransform: vi.fn(() => true),
      syncMoveNodes: vi.fn(),
      clearPreparedNodeTransform: vi.fn(),
    };
    const session = new PreparedNodeTransformSession(
      editing as never,
      [asPointId("p1")],
      [asAnchorId("a1")],
    );

    session.commitTranslation({ x: 10, y: -4 });
    session.dispose();

    expect(editing.prepareNodeTransform).toHaveBeenCalledWith(
      [asPointId("p1")],
      [asAnchorId("a1")],
    );
    expect(editing.applyPreparedNodeTransform).toHaveBeenCalledWith({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 10,
      f: -4,
    });
    expect(editing.syncMoveNodes).not.toHaveBeenCalled();
    expect(editing.clearPreparedNodeTransform).toHaveBeenCalledTimes(1);
  });

  it("falls back to syncMoveNodes when prepared transforms are unavailable", () => {
    const editing = {
      prepareNodeTransform: vi.fn(() => false),
      applyPreparedNodeTransform: vi.fn(() => false),
      syncMoveNodes: vi.fn(),
      clearPreparedNodeTransform: vi.fn(),
    };
    const pointIds = [asPointId("p1")];
    const anchorIds = [asAnchorId("a1")];
    const session = new PreparedNodeTransformSession(editing as never, pointIds, anchorIds);

    session.commitTranslation({ x: 3, y: 7 });
    session.dispose();

    expect(editing.applyPreparedNodeTransform).not.toHaveBeenCalled();
    expect(editing.syncMoveNodes).toHaveBeenCalledWith(pointIds, anchorIds, { x: 3, y: 7 });
    expect(editing.clearPreparedNodeTransform).not.toHaveBeenCalled();
  });

  it("falls back to absolute node positions for non-translation transforms", () => {
    const editing = {
      prepareNodeTransform: vi.fn(() => false),
      applyPreparedNodeTransform: vi.fn(() => false),
      syncMoveNodes: vi.fn(),
      syncNodePositions: vi.fn(),
      clearPreparedNodeTransform: vi.fn(),
    };
    const session = new PreparedNodeTransformSession(editing as never, [asPointId("p1")], []);
    const updates = [{ node: { kind: "point" as const, id: asPointId("p1") }, x: 25, y: 10 }];

    session.commitTransform({ a: 0, b: 1, c: -1, d: 0, e: 100, f: 50 }, updates);

    expect(editing.applyPreparedNodeTransform).not.toHaveBeenCalled();
    expect(editing.syncNodePositions).toHaveBeenCalledWith(updates);
  });
});
