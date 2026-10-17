import { describe, expect, it } from "vitest";
import { asContourId, asPointId } from "@shift/types";
import { contourGeometry } from "@shift/wasm/reference";
import { Contour } from "./Contour";
import { contourCases, describeInput, expectBoundsClose, type ContourCase } from "./testing";

const cases = contourCases();

function contourFor(testCase: ContourCase): Contour {
  const data = {
    id: asContourId("reference"),
    closed: testCase.closed,
    points: testCase.points.map((point, index) => ({
      id: asPointId(`p${index}`),
      pointType: point.pointType,
      smooth: false,
    })),
  };
  const values = new Float64Array(testCase.points.flatMap((point) => [point.x, point.y]));

  return new Contour(data, values, 0);
}

function referenceFor(testCase: ContourCase) {
  return contourGeometry({ closed: testCase.closed, points: [...testCase.points] });
}

describe("contour segments and bounds match shift-font's CurveSegmentIter", () => {
  it.each(cases)("parses $name into the same segments", (testCase) => {
    const contour = contourFor(testCase);
    const segments = contour.segments().map((segment) => ({
      type: segment.type,
      points: segment.flatPoints.map((point) => contour.points.indexOf(point)),
    }));
    const expected = referenceFor(testCase).segments.map(({ type, points }) => ({ type, points }));

    expect(segments, `input ${describeInput(testCase)}`).toEqual(expected);
  });

  it.each(cases)("bounds each segment of $name like segment_bounds", (testCase) => {
    const segments = contourFor(testCase).segments();
    const expected = referenceFor(testCase).segments;

    expect(segments, `input ${describeInput(testCase)}`).toHaveLength(expected.length);
    segments.forEach((segment, index) => {
      expectBoundsClose(segment.bounds, expected[index]!.bounds, { ...testCase, segment: index });
    });
  });

  it.each(cases)("bounds $name like resolved_contours_bbox", (testCase) => {
    expectBoundsClose(contourFor(testCase).bounds, referenceFor(testCase).bounds, testCase);
  });
});
