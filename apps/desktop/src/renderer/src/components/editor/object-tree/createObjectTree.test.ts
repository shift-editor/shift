import { describe, expect, it } from "vitest";
import { GlyphGeometry } from "@shift/glyph-state";
import { asContourId, asPointId } from "@shift/types";
import { createContourIconPath, createObjectTree, ObjectTreeCache } from "./createObjectTree";

const geometry = new GlyphGeometry(
  {
    contours: [
      {
        id: asContourId("mixed"),
        closed: false,
        points: [
          { id: asPointId("p0"), pointType: "onCurve", smooth: false },
          { id: asPointId("p1"), pointType: "onCurve", smooth: false },
          { id: asPointId("p2"), pointType: "onCurve", smooth: false },
          { id: asPointId("p3"), pointType: "offCurve", smooth: false },
          { id: asPointId("p4"), pointType: "onCurve", smooth: false },
        ],
      },
    ],
    anchors: [],
    components: [],
  },
  new Float64Array([500, 0, 0, 10, 0, 20, 0, 25, 10, 30, 0]),
);

function squareGeometry(closed: boolean, coordinates: readonly number[]): GlyphGeometry {
  return new GlyphGeometry(
    {
      contours: [
        {
          id: asContourId("square"),
          closed,
          points: ["a", "b", "c", "d"].map((id) => ({
            id: asPointId(id),
            pointType: "onCurve" as const,
            smooth: false,
          })),
        },
      ],
      anchors: [],
      components: [],
    },
    new Float64Array([500, ...coordinates]),
  );
}

describe("object tree contour descriptions", () => {
  it("labels the first point and describes remaining point geometry", () => {
    const contour = createObjectTree(geometry)[0]?.items[0];

    expect(contour?.children.map((point) => point.label)).toEqual([
      "First",
      "Line 1",
      "Curve 1",
      "Handle 1",
      "Curve 2",
    ]);
  });

  it("marks the first point with its own icon", () => {
    const contour = createObjectTree(geometry)[0]?.items[0];

    expect(contour?.children.map((point) => point.icon)).toEqual([
      "first",
      "line",
      "curve",
      "handle",
      "curve",
    ]);
  });

  it("reports the winding of closed contours in y-up font space", () => {
    const upFirst = [0, 0, 0, 10, 10, 10, 10, 0];
    const rightFirst = [0, 0, 10, 0, 10, 10, 0, 10];

    expect(createObjectTree(squareGeometry(true, upFirst))[0]?.items[0]?.direction).toBe(
      "clockwise",
    );
    expect(createObjectTree(squareGeometry(true, rightFirst))[0]?.items[0]?.direction).toBe(
      "counterclockwise",
    );
  });

  it("gives open contours no direction", () => {
    expect(createObjectTree(geometry)[0]?.items[0]?.direction).toBeUndefined();
  });

  it("fits contour path geometry into the icon view box", () => {
    const contour = geometry.contours[0];
    if (!contour) throw new Error("Expected contour fixture");

    const iconPath = createContourIconPath(contour);

    expect(iconPath).toBe("M 1 8 L 5 8 L 9 8 Q 11 4 13 8");
  });
});

function twoSquares(
  first: readonly number[],
  second: readonly number[],
  order: "ab" | "ba" = "ab",
) {
  const square = (id: string) => ({
    id: asContourId(id),
    closed: true,
    points: ["0", "1", "2", "3"].map((point) => ({
      id: asPointId(`${id}${point}`),
      pointType: "onCurve" as const,
      smooth: false,
    })),
  });
  const contours = order === "ab" ? [square("a"), square("b")] : [square("b"), square("a")];
  const values = order === "ab" ? [...first, ...second] : [...second, ...first];
  return new GlyphGeometry(
    { contours, anchors: [], components: [] },
    new Float64Array([500, ...values]),
  );
}

describe("object tree cache", () => {
  const a = [0, 0, 10, 0, 10, 10, 0, 10];
  const b = [20, 0, 30, 0, 30, 10, 20, 10];

  it("reuses an unchanged contour's item and rebuilds an edited one", () => {
    const cache = new ObjectTreeCache();
    const before = createObjectTree(twoSquares(a, b), cache)[0]!.items;
    const after = createObjectTree(twoSquares(a, [20, 0, 35, 0, 30, 10, 20, 10]), cache)[0]!.items;

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]).toEqual(
      createObjectTree(twoSquares(a, [20, 0, 35, 0, 30, 10, 20, 10]))[0]!.items[1],
    );
  });

  it("rebuilds a contour whose position, and so its label, changed", () => {
    const cache = new ObjectTreeCache();
    createObjectTree(twoSquares(a, b), cache);
    const reordered = createObjectTree(twoSquares(a, b, "ba"), cache)[0]!.items;

    expect(reordered.map((item) => item.label)).toEqual(["Contour 1", "Contour 2"]);
    expect(reordered.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("matches an uncached build after a point is added", () => {
    const cache = new ObjectTreeCache();
    createObjectTree(geometry, cache);
    const extended = new GlyphGeometry(
      {
        ...geometry.structure,
        contours: [
          {
            ...geometry.structure.contours[0]!,
            points: [
              ...geometry.structure.contours[0]!.points,
              { id: asPointId("p5"), pointType: "onCurve", smooth: false },
            ],
          },
        ],
      },
      new Float64Array([...geometry.values, 40, 0]),
    );

    expect(createObjectTree(extended, cache)).toEqual(createObjectTree(extended));
  });
});
