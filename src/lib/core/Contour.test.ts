import { Contour } from "@/lib/core/Contour";

describe("Contour", () => {
  let contour: Contour;

  beforeEach(() => {
    contour = new Contour();
  });

  it("should create a contour", () => {
    expect(contour).toBeDefined();
  });

  it("adding one point to an empty contour should create no segments", () => {
    contour.addPoint({ x: 0, y: 0 });
    expect(contour.segments().length).toBe(0);

    expect(contour.points.length).toBe(1);
  });

  it("adding two points to an empty contour should create one line segment", () => {
    contour.addPoint({ x: 0, y: 0 });
    contour.addPoint({ x: 10, y: 10 });
    const segments = contour.segments();

    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe("line");
  });

  it("adding three points to an empty contour should create two line segments", () => {
    contour.addPoint({ x: 0, y: 0 });
    contour.addPoint({ x: 10, y: 10 });
    contour.addPoint({ x: 20, y: 20 });

    const segments = contour.segments();

    expect(segments.length).toBe(2);

    expect(segments[0].type).toBe("line");
    expect(segments[1].type).toBe("line");

    expect(segments[1].anchor2).toEqual(segments[0].anchor1);
  });

  it("adding two points and then upgrading the line segment should create a cubic segment", () => {
    contour.addPoint({ x: 0, y: 0 });
    const id = contour.addPoint({ x: 10, y: 10 });
    contour.upgradeLineSegment(id);
    const segments = contour.segments();

    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe("cubic");
  });
});
