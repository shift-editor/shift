import { describe, it, expect, vi } from "vitest";
import { asAnchorId } from "@shift/types";
import { createTestEditor, expectDefined } from "@/testing";
import { executeAction } from "./actions";

describe("select actions", () => {
  it("moves anchors through moveAnchors during drag deltas", () => {
    const ctx = createTestEditor();
    const anchorId = asAnchorId("a-missing");

    expectDefined(ctx.mocks.edit.mocks.moveAnchors, "edit.moveAnchors mock").mockClear();
    expectDefined(ctx.mocks.edit.mocks.setNodePositions, "edit.setNodePositions mock").mockClear();

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
    expect(ctx.mocks.edit.setNodePositions).not.toHaveBeenCalled();
  });

  it("arms composite slot on first double-click edit action", () => {
    const ctx = createTestEditor();
    ctx.textRunManager.buffer.insert({ glyphName: "comp", unicode: 65 });
    ctx.recomputeTextRun(0);

    vi.mocked(ctx.getGlyphCompositeComponents).mockReturnValue({
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
    const ctx = createTestEditor();
    ctx.textRunManager.buffer.insert({ glyphName: "comp", unicode: 65 });
    ctx.recomputeTextRun(0);
    ctx.setTextRunInspectionSlot(0);

    vi.mocked(ctx.getGlyphCompositeComponents).mockReturnValue({
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
