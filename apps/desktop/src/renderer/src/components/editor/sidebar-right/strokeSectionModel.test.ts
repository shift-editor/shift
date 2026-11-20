import { describe, expect, it } from "vitest";
import { mintContourId, type OutlineStrokeStyle } from "@shift/types";
import type {
  StrokeLayerState,
  StrokeSectionView,
  StrokeSelectedContour,
  StrokeSelection,
} from "@/types/stroke";
import {
  miterLimitPatch,
  positionPatch,
  strokeSectionView,
  widthPatch,
} from "./strokeSectionModel";

const ROUND: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

function contour(overrides: Partial<StrokeSelectedContour> = {}): StrokeSelectedContour {
  return { id: mintContourId(), closed: false, style: null, ...overrides };
}

function stroke(style: Partial<OutlineStrokeStyle> = {}, closed = false): StrokeSelectedContour {
  return contour({ closed, style: { ...ROUND, ...style } });
}

function selection(
  contours: readonly StrokeSelectedContour[],
  overrides: { readOnly?: boolean; layer?: StrokeLayerState } = {},
): StrokeSelection {
  return {
    readOnly: overrides.readOnly ?? false,
    layer: overrides.layer ?? { kind: "editable" },
    contours,
  };
}

function viewOf(contours: readonly StrokeSelectedContour[]): StrokeSectionView {
  const view = strokeSectionView(selection(contours));
  if (!view) throw new Error("expected the Stroke section to show");

  return view;
}

describe("strokeSectionView", () => {
  describe("when the section has no place", () => {
    it.each([
      ["nothing is selected", selection([])],
      ["the contours share no editable layer", selection([contour()], { layer: { kind: "none" } })],
    ])("is hidden when %s", (_, hidden) => {
      expect(strokeSectionView(hidden)).toBeNull();
    });
  });

  describe("which controls show", () => {
    it("offers only to add a stroke when no selected contour has one", () => {
      const view = viewOf([contour(), contour({ closed: true })]);

      expect(view).toMatchObject({ canAdd: true, hasStroke: false, showsCap: false });
    });

    it("shows the fields and no add button when every selected contour is a stroke", () => {
      const view = viewOf([stroke(), stroke({ width: 20 })]);

      expect(view).toMatchObject({ canAdd: false, hasStroke: true });
    });

    it("offers both the fields and the add button when strokes and plain contours mix", () => {
      const view = viewOf([stroke(), contour()]);

      expect(view).toMatchObject({ canAdd: true, hasStroke: true });
    });

    it("shows the cap row only when a selected stroke is open", () => {
      expect(viewOf([stroke({}, true)]).showsCap).toBe(false);
      expect(viewOf([stroke({}, false)]).showsCap).toBe(true);
      expect(viewOf([stroke({}, true), stroke({}, false)]).showsCap).toBe(true);
    });

    it("ignores an open plain contour for the cap row", () => {
      expect(viewOf([stroke({}, true), contour({ closed: false })]).showsCap).toBe(false);
    });

    it("shows the miter limit only while the shared join is miter", () => {
      expect(viewOf([stroke({ join: "miter", miterLimit: 6 })])).toMatchObject({
        showsMiterLimit: true,
        miterLimit: 6,
      });
      expect(viewOf([stroke({ join: "round" })]).showsMiterLimit).toBe(false);
      expect(viewOf([stroke({ join: "bevel" })]).showsMiterLimit).toBe(false);
      expect(viewOf([stroke({ join: "miter" }), stroke({ join: "round" })]).showsMiterLimit).toBe(
        false,
      );
    });
  });

  describe("the values shown", () => {
    it("shows the value the selected strokes share", () => {
      const view = viewOf([
        stroke({ width: 32, join: "bevel", position: 0.5 }),
        stroke({ width: 32, join: "bevel", position: 0.5 }),
      ]);

      expect(view).toMatchObject({ width: 32, join: "bevel", positionPercent: 50, cap: "round" });
    });

    it("shows Mixed (null) for each field the strokes disagree on, and only that field", () => {
      const view = viewOf([
        stroke({ width: 10, join: "miter", cap: "butt", position: -1 }),
        stroke({ width: 30, join: "miter", cap: "square", position: 1 }),
      ]);

      expect(view).toMatchObject({
        width: null,
        positionPercent: null,
        cap: null,
        join: "miter",
      });
    });

    it("reads a plain contour as no value, not as a disagreement", () => {
      const view = viewOf([stroke({ width: 12 }), contour()]);

      expect(view.width).toBe(12);
    });

    it("shows no values when no stroke is selected", () => {
      const view = viewOf([contour()]);

      expect(view).toMatchObject({
        width: null,
        join: null,
        cap: null,
        positionPercent: null,
        miterLimit: null,
      });
    });

    it("shows the cap of the open strokes only", () => {
      const view = viewOf([stroke({ cap: "butt" }, false), stroke({ cap: "square" }, true)]);

      expect(view.cap).toBe("butt");
    });

    it("shows a position without floating point noise", () => {
      expect(viewOf([stroke({ position: 0.35 })]).positionPercent).toBe(35);
      expect(viewOf([stroke({ position: -0.07 })]).positionPercent).toBe(-7);
    });
  });

  describe("when the controls cannot change anything", () => {
    it.each<[string, Parameters<typeof selection>[1], string]>([
      ["the font is read-only", { readOnly: true }, "This font is open read-only"],
      [
        "the contours belong to another source",
        { layer: { kind: "inactiveSource" } },
        "Switch to the source",
      ],
      [
        "the layer cannot be read",
        { layer: { kind: "unreadable", message: "boom" } },
        "Could not read the strokes",
      ],
    ])("keeps the section and says why when %s", (_, overrides, reason) => {
      const view = strokeSectionView(selection([stroke()], overrides));

      expect(view?.hasStroke).toBe(true);
      expect(view?.disabledReason).toContain(reason);
    });

    it("has no disabled reason when the selection can be edited", () => {
      expect(viewOf([stroke()]).disabledReason).toBeNull();
    });
  });
});

describe("positionPatch", () => {
  it.each([
    [0, 0],
    [50, 0.5],
    [-100, -1],
    [100, 1],
  ])("turns %s percent into a position of %s", (percent, position) => {
    expect(positionPatch(percent)).toEqual({ position });
  });

  it("holds a percentage past either end to that end", () => {
    expect(positionPatch(150)).toEqual({ position: 1 });
    expect(positionPatch(-400)).toEqual({ position: -1 });
  });
});

describe("widthPatch", () => {
  it("passes a width the engine accepts through", () => {
    expect(widthPatch(24)).toEqual({ width: 24 });
  });

  it.each([0, -5, 0.2])("holds %s to the thinnest stroke instead of refusing", (width) => {
    expect(widthPatch(width)).toEqual({ width: 1 });
  });
});

describe("miterLimitPatch", () => {
  it("passes a limit the engine accepts through", () => {
    expect(miterLimitPatch(6)).toEqual({ miterLimit: 6 });
  });

  it.each([1, 0, -3, 0.5])("holds %s to a limit of 1 instead of refusing", (limit) => {
    expect(miterLimitPatch(limit)).toEqual({ miterLimit: 1 });
  });
});
