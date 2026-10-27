import { describe, expect, it } from "vitest";
import { asAnchorId, asPointId } from "@shift/types";
import { PositionTargets } from "./PositionTargets";

describe("PositionTargets", () => {
  it("always carries both lists, empty for the kind not targeted", () => {
    const points = PositionTargets.points([asPointId("point_a")]);
    const anchors = PositionTargets.anchors([asAnchorId("anchor_a")]);

    expect(points.anchors).toEqual([]);
    expect(points.hasAnchors).toBe(false);
    expect(anchors.points).toEqual([]);
    expect(anchors.hasAnchors).toBe(true);
  });

  it("is empty only when it targets neither points nor anchors", () => {
    expect(PositionTargets.NONE.isEmpty).toBe(true);
    expect(new PositionTargets([], []).isEmpty).toBe(true);
    expect(PositionTargets.points([asPointId("point_a")]).isEmpty).toBe(false);
  });
});
