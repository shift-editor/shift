import { describe, it, expect, beforeEach } from "vitest";
import type { Glyph } from "./glyph";
import { asContourId, asPointId, asAnchorId } from "@shift/types";
import { effect } from "@/lib/reactive/signal";
import { createBridge } from "@/testing";
import type { NativeBridge } from "@/bridge";

let bridge: NativeBridge;
let glyph: Glyph;

beforeEach(() => {
  bridge = createBridge();
  bridge.startEditSession({ glyphName: "A", unicode: 65 });
  glyph = bridge.$glyph.peek()!;
});

describe("Glyph", () => {
  it("constructs with correct name and unicode", () => {
    expect(glyph.name).toBe("A");
    expect(glyph.unicode).toBe(65);
  });

  it("exposes contours as reactive getters", () => {
    expect(Array.isArray(glyph.contours)).toBe(true);
  });

  it("computes whole-glyph path", () => {
    expect(glyph.path).toBeInstanceOf(Path2D);
  });

  describe("toSnapshot", () => {
    it("round-trips correctly", () => {
      const snapshot = glyph.toSnapshot();

      expect(snapshot.name).toBe("A");
      expect(snapshot.unicode).toBe(65);
    });
  });

  describe("apply with snapshot", () => {
    it("updates scalar fields", () => {
      const snapshot = glyph.toSnapshot();
      glyph.apply({ ...snapshot, xAdvance: 600 });

      expect(glyph.xAdvance).toBe(600);
    });

    it("reuses existing contour instances when IDs match", () => {
      const snapshot = glyph.toSnapshot();
      if (snapshot.contours.length === 0) return;

      const contourBefore = glyph.contours[0];
      glyph.apply({
        ...snapshot,
        contours: snapshot.contours.map((c) => ({
          ...c,
          points: c.points.map((p) => ({ ...p, x: p.x + 10 })),
        })),
      });
      const contourAfter = glyph.contours[0];

      expect(contourAfter).toBe(contourBefore);
    });

    it("creates new contour instances for new IDs", () => {
      const snapshot = glyph.toSnapshot();
      const newContour = {
        id: asContourId("new-contour"),
        closed: true,
        points: [
          { id: asPointId("np1"), x: 0, y: 0, pointType: "onCurve" as const, smooth: false },
          { id: asPointId("np2"), x: 50, y: 0, pointType: "onCurve" as const, smooth: false },
          { id: asPointId("np3"), x: 50, y: 50, pointType: "onCurve" as const, smooth: false },
        ],
      };

      glyph.apply({ ...snapshot, contours: [...snapshot.contours, newContour] });

      expect(glyph.contours.length).toBe(snapshot.contours.length + 1);
    });
  });

  describe("apply with position updates", () => {
    it("patches point positions without recreating contours", () => {
      const snapshot = glyph.toSnapshot();
      if (snapshot.contours.length === 0 || snapshot.contours[0]!.points.length === 0) return;

      const pointId = snapshot.contours[0]!.points[0]!.id;
      const contourBefore = glyph.contours[0];

      glyph.apply([{ node: { kind: "point", id: pointId }, x: 999, y: 888 }]);

      expect(glyph.contours[0]).toBe(contourBefore);
      const point = glyph.contours[0]?.points.find((p) => p.id === pointId);
      expect(point?.x).toBe(999);
      expect(point?.y).toBe(888);
    });

    it("patches anchor positions", () => {
      const snapshot = glyph.toSnapshot();
      const anchorId = asAnchorId("test-anchor");
      glyph.apply({
        ...snapshot,
        anchors: [{ id: anchorId, name: "top", x: 100, y: 200 }],
      });

      glyph.apply([{ node: { kind: "anchor", id: anchorId }, x: 300, y: 400 }]);

      expect(glyph.anchors[0]?.x).toBe(300);
      expect(glyph.anchors[0]?.y).toBe(400);
    });
  });

  describe("reactivity", () => {
    it("triggers effects when contour points change", () => {
      const snapshot = glyph.toSnapshot();
      if (snapshot.contours.length === 0 || snapshot.contours[0]!.points.length === 0) return;

      let count = 0;
      const dispose = effect(() => {
        const _pts = glyph.contours[0]?.points;
        count++;
      });

      const pointId = snapshot.contours[0]!.points[0]!.id;
      glyph.apply([{ node: { kind: "point", id: pointId }, x: 1, y: 1 }]);

      expect(count).toBeGreaterThan(1);
      dispose();
    });
  });
});
