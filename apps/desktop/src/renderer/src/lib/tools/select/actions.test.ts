import { describe, it, expect } from "vitest";
import { asAnchorId } from "@shift/types";
import { createMockToolContext } from "@/testing";
import { executeAction } from "./actions";

describe("select actions", () => {
  it("moves anchors through moveAnchors during drag deltas", () => {
    const ctx = createMockToolContext();
    const anchorId = asAnchorId("a-missing");

    ctx.mocks.edit.mocks.moveAnchors.mockClear();
    ctx.mocks.edit.mocks.setAnchorPositions.mockClear();

    executeAction(
      {
        type: "moveSelectionDelta",
        delta: { x: 25, y: -10 },
        pointIds: [],
        anchorIds: [anchorId],
      },
      ctx,
    );

    expect(ctx.mocks.edit.moveAnchors).toHaveBeenCalledWith([anchorId], 25, -10);
    expect(ctx.mocks.edit.setAnchorPositions).not.toHaveBeenCalled();
  });
});
