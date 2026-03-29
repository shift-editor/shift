import { describe, expect, it } from "vitest";
import { asContourId } from "@shift/types";
import type { Glyph, Point } from "@shift/types";
import { Bounds } from "@shift/geo";
import { signal } from "../reactive/signal";
import { SidebarViewModel } from "./SidebarViewModel";

function makePoint(
  id: string,
  x: number,
  y: number,
  pointType: Point["pointType"] = "onCurve",
): Point {
  return {
    id: id as Point["id"],
    x,
    y,
    pointType,
    smooth: false,
  };
}

function makeGlyph(input: {
  unicode?: number;
  xAdvance: number;
  left: number;
  right: number;
}): Glyph {
  return {
    unicode: input.unicode ?? 65,
    name: "A",
    xAdvance: input.xAdvance,
    contours: [
      {
        id: asContourId("c1"),
        closed: true,
        points: [
          makePoint("p1", input.left, 0),
          makePoint("p2", input.right, 0),
          makePoint("p3", input.right, 100),
          makePoint("p4", input.left, 100),
        ],
      },
    ],
    anchors: [],
    compositeContours: [],
    activeContourId: null,
  };
}

describe("SidebarViewModel", () => {
  it("derives live glyph info and selection bounds by default", () => {
    const glyph = signal<Glyph | null>(makeGlyph({ xAdvance: 600, left: 20, right: 120 }));
    let selectionBounds = Bounds.fromPoints([
      { x: 20, y: 0 },
      { x: 120, y: 100 },
    ]);
    const viewModel = new SidebarViewModel({
      glyph,
      getSelectionBounds: () => selectionBounds,
    });

    expect(viewModel.glyphInfo.peek()).toEqual({
      unicode: 65,
      xAdvance: 600,
      lsb: 20,
      rsb: 480,
    });
    expect(viewModel.selectionBounds.peek()).toEqual(selectionBounds);
  });

  it("keeps glyph info live while a frozen sidebar glyph is active", () => {
    const original = makeGlyph({ xAdvance: 600, left: 20, right: 120 });
    const updated = makeGlyph({ xAdvance: 700, left: 40, right: 200 });
    const glyph = signal<Glyph | null>(original);
    const viewModel = new SidebarViewModel({
      glyph,
      getSelectionBounds: () => null,
    });

    viewModel.freezeGlyph(original);
    glyph.set(updated);

    expect(viewModel.glyph.peek()).toBe(original);
    expect(viewModel.glyphInfo.peek()).toEqual({
      unicode: 65,
      xAdvance: 700,
      lsb: 40,
      rsb: 500,
    });
  });

  it("applies and clears transient overrides", () => {
    const glyph = signal<Glyph | null>(makeGlyph({ xAdvance: 600, left: 20, right: 120 }));
    const fallbackBounds = Bounds.fromPoints([
      { x: 20, y: 0 },
      { x: 120, y: 100 },
    ]);
    const overrideBounds = Bounds.fromPoints([
      { x: 30, y: 10 },
      { x: 150, y: 90 },
    ]);
    const viewModel = new SidebarViewModel({
      glyph,
      getSelectionBounds: () => fallbackBounds,
    });

    viewModel.overrideGlyphInfo({
      unicode: 65,
      xAdvance: 610,
      lsb: 25,
      rsb: 485,
    });
    viewModel.overrideSelectionBounds(overrideBounds);

    expect(viewModel.glyphInfo.peek()).toEqual({
      unicode: 65,
      xAdvance: 610,
      lsb: 25,
      rsb: 485,
    });
    expect(viewModel.selectionBounds.peek()).toEqual(overrideBounds);

    viewModel.clearTransientState();

    expect(viewModel.glyphInfo.peek()).toEqual({
      unicode: 65,
      xAdvance: 600,
      lsb: 20,
      rsb: 480,
    });
    expect(viewModel.selectionBounds.peek()).toEqual(fallbackBounds);
    expect(viewModel.glyph.peek()).toBe(glyph.peek());
  });
});
