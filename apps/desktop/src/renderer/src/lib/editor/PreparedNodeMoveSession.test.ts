import { describe, expect, it, vi } from "vitest";
import type { AnchorId, PointId } from "@shift/types";
import { PreparedNodeMoveSession } from "./PreparedNodeMoveSession";

function asPointId(id: string): PointId {
  return id as PointId;
}

function asAnchorId(id: string): AnchorId {
  return id as AnchorId;
}

describe("PreparedNodeMoveSession", () => {
  it("uses the prepared move fast path when available", () => {
    const editing = {
      prepareNodeTranslation: vi.fn(() => true),
      applyPreparedNodeTranslation: vi.fn(() => true),
      syncMoveNodes: vi.fn(),
      clearPreparedNodeTranslation: vi.fn(),
    };
    const session = new PreparedNodeMoveSession(
      editing as never,
      [asPointId("p1")],
      [asAnchorId("a1")],
    );

    session.commitUniformDelta({ x: 10, y: -4 });
    session.dispose();

    expect(editing.prepareNodeTranslation).toHaveBeenCalledWith(
      [asPointId("p1")],
      [asAnchorId("a1")],
    );
    expect(editing.applyPreparedNodeTranslation).toHaveBeenCalledWith({ x: 10, y: -4 });
    expect(editing.syncMoveNodes).not.toHaveBeenCalled();
    expect(editing.clearPreparedNodeTranslation).toHaveBeenCalledTimes(1);
  });

  it("falls back to syncMoveNodes when prepared move is unavailable", () => {
    const editing = {
      prepareNodeTranslation: vi.fn(() => false),
      applyPreparedNodeTranslation: vi.fn(() => false),
      syncMoveNodes: vi.fn(),
      clearPreparedNodeTranslation: vi.fn(),
    };
    const pointIds = [asPointId("p1")];
    const anchorIds = [asAnchorId("a1")];
    const session = new PreparedNodeMoveSession(editing as never, pointIds, anchorIds);

    session.commitUniformDelta({ x: 3, y: 7 });
    session.dispose();

    expect(editing.applyPreparedNodeTranslation).not.toHaveBeenCalled();
    expect(editing.syncMoveNodes).toHaveBeenCalledWith(pointIds, anchorIds, { x: 3, y: 7 });
    expect(editing.clearPreparedNodeTranslation).not.toHaveBeenCalled();
  });
});
