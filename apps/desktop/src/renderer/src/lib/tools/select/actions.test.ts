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

  it("arms composite slot on first double-click edit action", () => {
    const ctx = createMockToolContext();
    ctx.textRunManager.buffer.insert({ glyphName: "comp", unicode: 65 });
    ctx.recomputeTextRun(0);

    (
      ctx.getGlyphCompositeComponents as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue({
      glyphName: "comp",
      components: [
        {
          componentGlyphName: "mark",
          sourceUnicodes: [769],
          contours: [
            {
              closed: true,
              points: [
                { x: 0, y: 0, pointType: "onCurve", smooth: false },
                { x: 100, y: 0, pointType: "onCurve", smooth: false },
                { x: 100, y: 100, pointType: "onCurve", smooth: false },
              ],
            },
          ],
        },
      ],
    });

    executeAction({ type: "editTextRunSlot", index: 0, point: { x: 20, y: 20 } }, ctx);

    const state = ctx.getTextRunState();
    expect(state?.compositeInspection?.slotIndex).toBe(0);
    expect(state?.editingIndex).toBeNull();
  });

  it("inserts component on second composite double-click action", () => {
    const ctx = createMockToolContext();
    ctx.textRunManager.buffer.insert({ glyphName: "comp", unicode: 65 });
    ctx.recomputeTextRun(0);
    ctx.setTextRunInspectionSlot(0);

    (
      ctx.getGlyphCompositeComponents as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue({
      glyphName: "comp",
      components: [
        {
          componentGlyphName: "acutecomb",
          sourceUnicodes: [769],
          contours: [
            {
              closed: true,
              points: [
                { x: 0, y: 0, pointType: "onCurve", smooth: false },
                { x: 100, y: 0, pointType: "onCurve", smooth: false },
                { x: 100, y: 100, pointType: "onCurve", smooth: false },
              ],
            },
          ],
        },
      ],
    });

    executeAction({ type: "editTextRunSlot", index: 0, point: { x: 20, y: 20 } }, ctx);

    const state = ctx.getTextRunState();
    expect(state?.layout.slots.length).toBe(2);
    expect(state?.editingIndex).toBe(1);
    expect(state?.compositeInspection).toBeNull();
    expect(ctx.startEditSession).toHaveBeenCalledWith({
      glyphName: "acutecomb",
      unicode: 769,
    });
  });
});
