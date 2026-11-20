import { describe, expect, it } from "vitest";
import { mintContourId, mintLayerId } from "@shift/types";
import type { StrokeOutlinePreviewItem } from "@shift/wasm/protocol";
import { NO_STROKE_FILLS, solveStrokeFills } from "./strokeFills";

/** What the engine throws for a failed stroke read: a `PackError` carrying the reason. */
function strokeReadError(reason: object): Error {
  const error = new Error("StrokePreviewReadError.reason");
  error.name = "PackError";

  return Object.assign(error, { type: "StrokePreviewReadError", error: reason });
}

/** A solved outline of one open square, drawn as a closed contour. */
function solvedItem(): StrokeOutlinePreviewItem {
  return {
    skeletonContourId: mintContourId(),
    width: 10,
    height: 10,
    outlines: [
      {
        coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
        pointTypes: ["onCurve", "onCurve", "onCurve", "onCurve"],
        closed: true,
      },
    ],
  } as StrokeOutlinePreviewItem;
}

function failedContour(message: string) {
  return { skeletonContourId: mintContourId(), message };
}

function failing(reason: object): () => never {
  return () => {
    throw strokeReadError(reason);
  };
}

describe("solving a layer's stroke fills", () => {
  it("says why the solver failed, in the solver's words", () => {
    const fills = solveStrokeFills(
      failing({ kind: "failed", message: "path has degenerate bounds" }),
    );

    expect(fills.items).toEqual([]);
    expect(fills.path).toBeNull();
    expect(fills.failure).toBe("A dynamic stroke could not be drawn: path has degenerate bounds.");
  });

  it("says a missing layer is missing, not that a variant was thrown", () => {
    const fills = solveStrokeFills(failing({ kind: "layerNotFound", layer: mintLayerId() }));

    expect(fills.failure).toBe(
      "A dynamic stroke could not be drawn: its layer is not in the font.",
    );
  });

  it("reads a layer that is not loaded yet as no stroke, not as a failure", () => {
    const fills = solveStrokeFills(failing({ kind: "notLoaded", layer: mintLayerId() }));

    expect(fills).toBe(NO_STROKE_FILLS);
  });

  it("keeps the message of any other error", () => {
    const fills = solveStrokeFills(() => {
      throw new Error("the engine is closed");
    });

    expect(fills.failure).toBe("A dynamic stroke could not be drawn: the engine is closed.");
  });

  it("fills the contours that solved and says why another did not", () => {
    const item = solvedItem();
    const fills = solveStrokeFills(() => ({
      items: [item],
      failures: [failedContour("path has degenerate bounds")],
    }));

    expect(fills.items).toEqual([item]);
    expect(fills.path).not.toBeNull();
    expect(fills.failure).toBe("A dynamic stroke could not be drawn: path has degenerate bounds.");
  });

  it("counts the contours that failed when more than one did", () => {
    const fills = solveStrokeFills(() => ({
      items: [solvedItem()],
      failures: [failedContour("first reason"), failedContour("second reason")],
    }));

    expect(fills.failure).toBe("2 dynamic strokes could not be drawn: first reason.");
  });

  it("has no path when every contour failed, and still says why", () => {
    const fills = solveStrokeFills(() => ({
      items: [],
      failures: [failedContour("nothing to outline")],
    }));

    expect(fills.items).toEqual([]);
    expect(fills.path).toBeNull();
    expect(fills.failure).toBe("A dynamic stroke could not be drawn: nothing to outline.");
  });

  it("reads a layer with no strokes as the shared empty value", () => {
    expect(solveStrokeFills(() => ({ items: [], failures: [] }))).toBe(NO_STROKE_FILLS);
  });
});
