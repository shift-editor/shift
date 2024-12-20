import { Path } from "../path";
import { Point } from "../point";
import { Segment, SegmentType } from "../segment";

describe("Path", () => {
  let path: Path;

  beforeEach(() => {
    path = new Path();
  });

  describe("initialization", () => {
    it("should start empty", () => {
      expect(path.isEmpty()).toBe(true);
      expect(path.numberOfSegments).toBe(0);
    });
  });

  describe("adding", () => {
    it("a segment should update the array with that segment", () => {
      const s = new Segment(SegmentType.Line, new Point(0, 0));
      path.addSegment(s);

      expect(path.segments.length).toBe(1);
      expect(path.lastSegment()).toBe(s);
    });

    it("a point to an empty path should add a segment with only a start point", () => {
      path.addPoint(new Point(1, 1), SegmentType.Line);

      expect(path.segments.length).toBe(1);
      expect(path.lastSegment().incompleteSegment()).toBe(true);
    });

    it("a point to a path with an incomplete segment should close that segment", () => {
      const startPoint = new Point(1, 1);
      const endPoint = new Point(2, 1);
      path.addPoint(startPoint, SegmentType.Line);
      path.addPoint(endPoint, SegmentType.Line);

      expect(path.segments.length).toBe(1);
      expect(path.lastSegment().incompleteSegment()).toBe(false);
      expect(path.lastSegment().startPoint).toBe(startPoint);
      expect(path.lastSegment().endPoint).toBe(endPoint);
    });

    it("a point to a path with a complete segment should add a complete segment with the start point being the end point of the previous segment", () => {
      const startPoint = new Point(1, 1);
      const endPoint = new Point(2, 1);
      path.addPoint(startPoint, SegmentType.Line);
      path.addPoint(endPoint, SegmentType.Line);

      const nextStartPoint = new Point(3, 1);
      path.addPoint(nextStartPoint, SegmentType.Line);
      expect(path.segments.length).toBe(2);
      expect(path.lastSegment().incompleteSegment()).toBe(false);
      expect(path.lastSegment().startPoint).toStrictEqual(endPoint);
      expect(path.lastSegment().endPoint).toStrictEqual(nextStartPoint);
    });
  });
});
