import { describe, expect, it } from "vitest";
import { asAnchorId, asPointId } from "@shift/types";
import { createMockCommandContext } from "@/testing";
import { NodePositionPatchCommand } from "./NodePositionPatchCommand";

describe("NodePositionPatchCommand", () => {
  it("applies after positions on execute", () => {
    const ctx = createMockCommandContext();
    const cmd = new NodePositionPatchCommand("Move Nodes", [
      {
        node: { kind: "point", id: asPointId("p1") },
        before: { x: 10, y: 20 },
        after: { x: 30, y: 40 },
      },
      {
        node: { kind: "anchor", id: asAnchorId("a1") },
        before: { x: -5, y: 9 },
        after: { x: 15, y: 19 },
      },
    ]);

    cmd.execute(ctx);

    expect(cmd.name).toBe("Move Nodes");
    expect(ctx.fontEngine.setNodePositions).toHaveBeenCalledWith([
      { node: { kind: "point", id: asPointId("p1") }, x: 30, y: 40 },
      { node: { kind: "anchor", id: asAnchorId("a1") }, x: 15, y: 19 },
    ]);
  });

  it("restores before positions on undo", () => {
    const ctx = createMockCommandContext();
    const cmd = new NodePositionPatchCommand("Move Nodes", [
      {
        node: { kind: "point", id: asPointId("p1") },
        before: { x: 10, y: 20 },
        after: { x: 30, y: 40 },
      },
    ]);

    cmd.undo(ctx);

    expect(ctx.fontEngine.setNodePositions).toHaveBeenCalledWith([
      { node: { kind: "point", id: asPointId("p1") }, x: 10, y: 20 },
    ]);
  });

  it("redo delegates to execute", () => {
    const ctx = createMockCommandContext();
    const cmd = new NodePositionPatchCommand("Move Nodes", [
      {
        node: { kind: "point", id: asPointId("p1") },
        before: { x: 0, y: 0 },
        after: { x: 1, y: 2 },
      },
    ]);

    cmd.execute(ctx);
    cmd.undo(ctx);
    cmd.redo(ctx);

    expect(ctx.fontEngine.setNodePositions).toHaveBeenLastCalledWith([
      { node: { kind: "point", id: asPointId("p1") }, x: 1, y: 2 },
    ]);
  });
});
