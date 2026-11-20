import { describe, expect, it } from "vitest";
import { mintContourId, type OutlineStrokeStyle } from "@shift/types";
import type {
  StrokeCommandId,
  StrokeLayerState,
  StrokeSelectedContour,
  StrokeSelection,
} from "@/types/stroke";
import { strokeAvailability } from "./strokeAvailability";

const ALL_COMMANDS: readonly StrokeCommandId[] = [
  "glyph.stroke.applyDynamic",
  "glyph.stroke.expand",
  "glyph.stroke.expandWithStyle",
  "glyph.stroke.offsetContour",
  "glyph.stroke.removeDynamic",
  "glyph.stroke.updateStyle",
];

const STYLE: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
  position: 0,
};

function contour(overrides: Partial<StrokeSelectedContour> = {}): StrokeSelectedContour {
  return { id: mintContourId(), closed: true, style: null, ...overrides };
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

describe("strokeAvailability", () => {
  describe("what every command needs", () => {
    const blockedSelections: readonly [string, StrokeSelection][] = [
      ["a read-only font", selection([contour({ style: STYLE })], { readOnly: true })],
      ["no selected contour", selection([])],
      ["contours with no shared layer", selection([contour()], { layer: { kind: "none" } })],
      [
        "contours on a source that is not active",
        selection([contour()], { layer: { kind: "inactiveSource" } }),
      ],
      [
        "an engine read that failed",
        selection([contour()], { layer: { kind: "unreadable", message: "layer not resident" } }),
      ],
    ];

    for (const [name, blocked] of blockedSelections) {
      it(`disables every command, with a reason, for ${name}`, () => {
        for (const id of ALL_COMMANDS) {
          const result = strokeAvailability(id, blocked);

          expect(result.enabled, id).toBe(false);
          if (!result.enabled) expect(result.reason.length, id).toBeGreaterThan(0);
        }
      });
    }

    it("names the engine failure in the reason", () => {
      const result = strokeAvailability(
        "glyph.stroke.applyDynamic",
        selection([contour()], { layer: { kind: "unreadable", message: "layer not resident" } }),
      );

      expect(result).toEqual({
        enabled: false,
        reason: "Could not read the strokes on this layer: layer not resident",
      });
    });
  });

  describe("apply and expand with a style", () => {
    it("are available for plain, dynamic and mixed selections", () => {
      const plain = selection([contour()]);
      const dynamic = selection([contour({ style: STYLE })]);
      const mixed = selection([contour(), contour({ style: STYLE })]);

      for (const id of ["glyph.stroke.applyDynamic", "glyph.stroke.expandWithStyle"] as const) {
        for (const candidate of [plain, dynamic, mixed]) {
          expect(strokeAvailability(id, candidate), id).toEqual({ enabled: true });
        }
      }
    });

    it("are available for an open contour", () => {
      expect(
        strokeAvailability("glyph.stroke.applyDynamic", selection([contour({ closed: false })])),
      ).toEqual({ enabled: true });
    });
  });

  describe("expand and remove dynamic stroke", () => {
    for (const id of [
      "glyph.stroke.expand",
      "glyph.stroke.removeDynamic",
      "glyph.stroke.updateStyle",
    ] as const) {
      it(`${id} is disabled when no selected contour is dynamic`, () => {
        expect(strokeAvailability(id, selection([contour(), contour()]))).toEqual({
          enabled: false,
          reason: "None of the selected contours has a dynamic stroke.",
        });
      });

      it(`${id} is available when at least one selected contour is dynamic`, () => {
        const mixed = selection([contour(), contour({ style: STYLE })]);

        expect(strokeAvailability(id, mixed)).toEqual({ enabled: true });
      });
    }
  });

  describe("offset contour", () => {
    it("is available for exactly one contour, closed", () => {
      expect(strokeAvailability("glyph.stroke.offsetContour", selection([contour()]))).toEqual({
        enabled: true,
      });
    });

    it("is available for exactly one contour, open", () => {
      expect(
        strokeAvailability("glyph.stroke.offsetContour", selection([contour({ closed: false })])),
      ).toEqual({ enabled: true });
    });

    it("is disabled for more than one contour", () => {
      expect(
        strokeAvailability("glyph.stroke.offsetContour", selection([contour(), contour()])),
      ).toEqual({ enabled: false, reason: "Select exactly one contour to offset." });
    });
  });
});
