import { describe, expect, it } from "vitest";
import { asContourId, asPointId } from "@shift/types";
import { Contour } from "./Contour";
import { isSegmentId, parseSegmentId, segmentIdFor } from "./Segment";

describe("segment ids", () => {
  it("derive from endpoint point ids with a runtime-discriminable prefix", () => {
    const startPointId = asPointId("point_start");
    const endPointId = asPointId("point_end");
    const segmentId = segmentIdFor(startPointId, endPointId);

    expect(segmentId).toBe("segment:point_start:point_end");
    expect(isSegmentId(segmentId)).toBe(true);
    expect(parseSegmentId(segmentId)).toEqual({ startPointId, endPointId });
  });

  it("rejects unprefixed or incomplete segment ids", () => {
    expect(isSegmentId("point_start:point_end")).toBe(false);
    expect(parseSegmentId("point_start:point_end")).toBeNull();
    expect(parseSegmentId("segment:point_start")).toBeNull();
    expect(parseSegmentId("segment::point_end")).toBeNull();
    expect(parseSegmentId("segment:point_start:")).toBeNull();
  });

  it("uses prefixed ids for parsed contour segments", () => {
    const contour = new Contour(
      {
        id: asContourId("contour_1"),
        closed: false,
        points: [
          { id: asPointId("point_1"), pointType: "onCurve", smooth: false },
          { id: asPointId("point_2"), pointType: "onCurve", smooth: false },
          { id: asPointId("point_3"), pointType: "onCurve", smooth: false },
        ],
      },
      new Float64Array([500, 0, 0, 100, 0, 200, 0]),
      1,
    );

    expect(contour.segments().map((segment) => segment.id)).toEqual([
      "segment:point_1:point_2",
      "segment:point_2:point_3",
    ]);
  });
});
