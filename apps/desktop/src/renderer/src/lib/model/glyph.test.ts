import { describe, it, expect } from "vitest";
import { Glyph } from "./glyph";
import { asContourId, asPointId, asAnchorId } from "@shift/types";
import type { GlyphSnapshot } from "@shift/types";
import { effect } from "@/lib/reactive/signal";

function makeSnapshot(overrides?: Partial<GlyphSnapshot>): GlyphSnapshot {
  return {
    unicode: 65,
    name: "A",
    xAdvance: 500,
    contours: [
      {
        id: asContourId("c1"),
        closed: false,
        points: [
          { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: asPointId("p2"), x: 100, y: 0, pointType: "onCurve", smooth: false },
          { id: asPointId("p3"), x: 100, y: 100, pointType: "onCurve", smooth: false },
        ],
      },
    ],
    anchors: [],
    compositeContours: [],
    activeContourId: asContourId("c1"),
    ...overrides,
  };
}

describe("Glyph", () => {
  it("constructs from a snapshot with correct values", () => {
    const glyph = new Glyph(makeSnapshot());

    expect(glyph.name).toBe("A");
    expect(glyph.unicode).toBe(65);
    expect(glyph.xAdvance).toBe(500);
    expect(glyph.contours).toHaveLength(1);
    expect(glyph.contours[0]!.points).toHaveLength(3);
    expect(glyph.activeContourId).toBe(asContourId("c1"));
  });

  it("auto-unwraps contour properties", () => {
    const glyph = new Glyph(makeSnapshot());
    const contour = glyph.contours[0]!;

    expect(contour.closed).toBe(false);
    expect(contour.points[0]!.x).toBe(0);
    expect(contour.points[1]!.x).toBe(100);
    expect(contour.id).toBe(asContourId("c1"));
  });

  it("computes contour path and bounds", () => {
    const glyph = new Glyph(makeSnapshot());
    const contour = glyph.contours[0]!;

    expect(contour.path).toBeInstanceOf(Path2D);
    expect(contour.bounds).not.toBeNull();
  });

  it("computes whole-glyph path and bbox", () => {
    const glyph = new Glyph(makeSnapshot());

    expect(glyph.path).toBeInstanceOf(Path2D);
    expect(glyph.bbox).not.toBeNull();
  });

  describe("toSnapshot", () => {
    it("round-trips correctly", () => {
      const original = makeSnapshot();
      const glyph = new Glyph(original);
      const snapshot = glyph.toSnapshot();

      expect(snapshot.name).toBe(original.name);
      expect(snapshot.unicode).toBe(original.unicode);
      expect(snapshot.xAdvance).toBe(original.xAdvance);
      expect(snapshot.contours).toHaveLength(original.contours.length);
      expect(snapshot.contours[0]!.points).toHaveLength(original.contours[0]!.points.length);
      expect(snapshot.contours[0]!.points[0]!.x).toBe(0);
      expect(snapshot.activeContourId).toBe(original.activeContourId);
    });
  });

  describe("apply with snapshot", () => {
    it("updates scalar fields", () => {
      const glyph = new Glyph(makeSnapshot());

      glyph.apply(makeSnapshot({ xAdvance: 600 }));

      expect(glyph.xAdvance).toBe(600);
    });

    it("reuses existing contour objects when IDs match", () => {
      const glyph = new Glyph(makeSnapshot());
      const contourBefore = glyph.contours[0]!;

      glyph.apply(
        makeSnapshot({
          contours: [
            {
              id: asContourId("c1"),
              closed: true,
              points: [
                { id: asPointId("p1"), x: 10, y: 20, pointType: "onCurve", smooth: false },
                { id: asPointId("p2"), x: 110, y: 20, pointType: "onCurve", smooth: false },
              ],
            },
          ],
        }),
      );

      expect(glyph.contours[0]).toBe(contourBefore);
      expect(glyph.contours[0]!.closed).toBe(true);
      expect(glyph.contours[0]!.points).toHaveLength(2);
      expect(glyph.contours[0]!.points[0]!.x).toBe(10);
    });

    it("creates new contour objects for new IDs", () => {
      const glyph = new Glyph(makeSnapshot());

      glyph.apply(
        makeSnapshot({
          contours: [
            {
              id: asContourId("c2"),
              closed: false,
              points: [
                { id: asPointId("p4"), x: 50, y: 50, pointType: "onCurve", smooth: false },
                { id: asPointId("p5"), x: 150, y: 50, pointType: "onCurve", smooth: false },
              ],
            },
          ],
        }),
      );

      expect(glyph.contours).toHaveLength(1);
      expect(glyph.contours[0]!.id).toBe(asContourId("c2"));
    });
  });

  describe("apply with position updates", () => {
    it("patches affected point positions only", () => {
      const glyph = new Glyph(makeSnapshot());

      glyph.apply([{ node: { kind: "point", id: asPointId("p1") }, x: 50, y: 75 }]);

      expect(glyph.contours[0]!.points[0]!.x).toBe(50);
      expect(glyph.contours[0]!.points[0]!.y).toBe(75);
      expect(glyph.contours[0]!.points[1]!.x).toBe(100);
    });

    it("leaves untouched contours unchanged", () => {
      const snapshot = makeSnapshot({
        contours: [
          {
            id: asContourId("c1"),
            closed: false,
            points: [
              { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
              { id: asPointId("p2"), x: 100, y: 0, pointType: "onCurve", smooth: false },
            ],
          },
          {
            id: asContourId("c2"),
            closed: false,
            points: [
              { id: asPointId("p3"), x: 200, y: 200, pointType: "onCurve", smooth: false },
              { id: asPointId("p4"), x: 300, y: 200, pointType: "onCurve", smooth: false },
            ],
          },
        ],
      });
      const glyph = new Glyph(snapshot);

      let c2FireCount = 0;
      const fx = effect(() => {
        glyph.contours[1]!.points;
        c2FireCount++;
      });

      glyph.apply([{ node: { kind: "point", id: asPointId("p1") }, x: 50, y: 50 }]);

      expect(glyph.contours[0]!.points[0]!.x).toBe(50);
      expect(c2FireCount).toBe(1);
      fx.dispose();
    });

    it("patches anchor positions", () => {
      const snapshot = makeSnapshot({
        anchors: [{ id: asAnchorId("a1"), name: "top", x: 10, y: 20 }],
      });
      const glyph = new Glyph(snapshot);

      glyph.apply([{ node: { kind: "anchor", id: asAnchorId("a1") }, x: 30, y: 40 }]);

      expect(glyph.anchors[0]!.x).toBe(30);
      expect(glyph.anchors[0]!.y).toBe(40);
    });

    it("is a no-op for empty updates", () => {
      const glyph = new Glyph(makeSnapshot());
      const snapshot = glyph.toSnapshot();

      glyph.apply([]);

      expect(glyph.toSnapshot()).toEqual(snapshot);
    });
  });

  describe("reactivity", () => {
    it("triggers effects when contour points change", () => {
      const glyph = new Glyph(makeSnapshot());
      let fireCount = 0;
      const fx = effect(() => {
        glyph.contours[0]!.points;
        fireCount++;
      });

      glyph.apply([{ node: { kind: "point", id: asPointId("p1") }, x: 50, y: 50 }]);

      expect(fireCount).toBe(2);
      fx.dispose();
    });

    it("triggers effects when xAdvance changes", () => {
      const glyph = new Glyph(makeSnapshot());
      let observed = 0;
      const fx = effect(() => {
        observed = glyph.xAdvance;
      });

      expect(observed).toBe(500);

      glyph.apply(makeSnapshot({ xAdvance: 700 }));

      expect(observed).toBe(700);
      fx.dispose();
    });
  });
});
