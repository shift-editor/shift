import { Mat, type MatModel } from "@shift/geo";
import type { ContourId, PointType } from "@shift/types";
import type {
  ContourPoints,
  StrokeOutlineFailure,
  StrokeOutlinePreviewItem,
  StrokeOutlinePreviews,
  StrokePreviewReadError,
} from "@shift/wasm/protocol";
import type { StrokeFills } from "../../types/graphics";
import { ContourPath } from "../graphics/ContourPath";

/** What a layer without a dynamic stroke solves to. One value, so readers see no change. */
export const NO_STROKE_FILLS: StrokeFills = { items: [], path: null, failure: null };

/**
 * Solves one layer's dynamic strokes into fills and the canvas path they draw as.
 *
 * @remarks
 * The path is built here, once per solve, so a redraw that changed nothing
 * about the strokes builds nothing. A layer with no solved outline and no
 * failure returns {@link NO_STROKE_FILLS}, whichever layer it is. One contour
 * that cannot be solved does not hide the others: they are filled, and the
 * failure is the message. A read that throws, such as a layer that is not
 * loaded yet, returns its message as `failure`.
 *
 * @param read - Reads the layer's outlines from the engine.
 * @returns The fills; a fresh value whenever `read` returned a fresh answer.
 */
export function solveStrokeFills(read: () => StrokeOutlinePreviews): StrokeFills {
  try {
    const { items, failures } = read();
    if (items.length === 0 && failures.length === 0) return NO_STROKE_FILLS;

    const failure = contourFailureMessage(failures);
    const path = items.length === 0 ? null : strokeFillPath(items, Mat.Identity());
    return { items, path, failure };
  } catch (error) {
    const readError = strokeReadError(error);
    if (readError?.kind === "notLoaded" || readError?.kind === "glyphNotLoaded") {
      return NO_STROKE_FILLS;
    }

    return { items: [], path: null, failure: strokeFailureMessage(error, readError) };
  }
}

/** The {@link StrokePreviewReadError} the engine threw, read from the error it arrives in. */
function strokeReadError(error: unknown): StrokePreviewReadError | null {
  if (typeof error !== "object" || error === null) return null;
  const { type, error: carried } = error as { readonly type?: unknown; readonly error?: unknown };
  if (type !== "StrokePreviewReadError") return null;

  return carried as StrokePreviewReadError;
}

const FAILURE_PREFIX = "A dynamic stroke could not be drawn";

/** The one sentence for the contours that failed, or null when none did. */
function contourFailureMessage(failures: readonly StrokeOutlineFailure[]): string | null {
  const [first, ...others] = failures;
  if (!first) return null;
  if (others.length === 0) return `${FAILURE_PREFIX}: ${first.message}.`;

  return `${failures.length} dynamic strokes could not be drawn: ${first.message}.`;
}

function strokeFailureMessage(error: unknown, readError: StrokePreviewReadError | null): string {
  const prefix = FAILURE_PREFIX;
  switch (readError?.kind) {
    case "failed":
      return `${prefix}: ${readError.message}.`;
    case "layerNotFound":
      return `${prefix}: its layer is not in the font.`;
    case "glyphNotFound":
      return `${prefix}: its glyph is not in the font.`;
    case "notLoaded":
    case "glyphNotLoaded":
    case undefined:
      return error instanceof Error ? `${prefix}: ${error.message}.` : `${prefix}.`;
  }
}

/**
 * The contours `fills` replace, by id: the skeletons its solved outlines
 * stand in for, which drawing leaves out wherever the fills are drawn.
 */
export function dynamicContourIds(fills: StrokeFills): ReadonlySet<ContourId> {
  return new Set(fills.items.map((item) => item.skeletonContourId));
}

/** Whether two dynamic-contour id sets hold the same ids, for a computed's `equals`. */
export function sameDynamicContourIds(
  current: ReadonlySet<ContourId>,
  next: ReadonlySet<ContourId>,
): boolean {
  if (current.size !== next.size) return false;

  for (const id of next) {
    if (!current.has(id)) return false;
  }
  return true;
}

/**
 * `fills` as drawn under `transform`: the same solved items and failure, with
 * the path rebuilt in the placed space.
 *
 * @remarks
 * The items stay in the solving layer's coordinates, where their
 * `skeletonContourId`s name that layer's contours; only the path moves. Fills
 * with nothing solved, or an identity transform, return `fills` itself.
 *
 * @param fills - Solved fills in their own layer's coordinates.
 * @param transform - Placement from that layer's coordinates into the drawing's.
 * @returns The fills to draw at that placement.
 */
export function placeStrokeFills(fills: StrokeFills, transform: MatModel): StrokeFills {
  if (fills.path === null || Mat.isIdentity(transform)) return fills;

  return {
    items: fills.items,
    path: strokeFillPath(fills.items, transform),
    failure: fills.failure,
  };
}

function strokeFillPath(items: readonly StrokeOutlinePreviewItem[], transform: MatModel): Path2D {
  const path = new Path2D();
  for (const item of items) {
    for (const outline of item.outlines) path.addPath(contourPath(outline, transform).path);
  }

  return path;
}

function contourPath(contour: ContourPoints, transform: MatModel): ContourPath {
  const points = contour.pointTypes.map((pointType, index) => ({
    ...Mat.applyToPoint(transform, {
      x: contour.coordinates[index * 2]!,
      y: contour.coordinates[index * 2 + 1]!,
    }),
    pointType: pointType as PointType,
    smooth: false,
  }));

  return ContourPath.fromPoints(points, contour.closed);
}
