import type { LocalPoint } from "@shift/editor/spaces";
import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import type { SegmentId, TextItemId } from "@shift/types";
import { hooksOf } from "./appHooks";

/**
 * A page position where the canvas hit-tests the selected component, searched on a grid
 * inside its bounds; throws when no component is selected or none of the grid hits it.
 */
export async function selectedComponentHitPoint(page: Page): Promise<Point2D> {
  return hooksOf(page).canvas.selectedComponentHitPoint();
}

/**
 * Canvas-local positions on the open glyph as the canvas draws it now, interpolated where the
 * location is between sources: its first point, the middle of its first segment, and empty
 * canvas 15px below the glyph's descender at half its advance.
 */
export async function glyphClickTargets(page: Page): Promise<Point2D[]> {
  return hooksOf(page).interpolated.glyphClickTargets();
}

/**
 * Dispatches a Ctrl-wheel zoom and then a modifier-free horizontal wheel sample at the canvas
 * centre in one synchronous page task, so their timestamps rather than Playwright round trips
 * decide whether the second sample continues the zoom gesture.
 *
 * @returns the pan after the zoom, the pan after the second sample, and the page time of the zoom.
 */
export async function wheelZoomThenPan(
  page: Page,
): Promise<{ zoomPan: Point2D; momentumPan: Point2D; zoomedAt: number }> {
  return hooksOf(page).canvas.wheelZoomThenPan();
}

/** Waits until the page clock (`performance.now()`) is more than `ms` past `since`. */
export async function waitForPageClock(page: Page, since: number, ms: number): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- waits on the page clock, not app state
  await page.waitForFunction(({ start, elapsed }) => performance.now() - start > elapsed, {
    start: since,
    elapsed: ms,
  });
}

/** Pans the canvas to `offset`, in screen pixels, as the Hand tool does. */
export async function setCanvasOffset(page: Page, offset: Point2D): Promise<void> {
  await hooksOf(page).canvas.setPan(offset);
}

/** Clears the selection without a key or pointer event, as an undo or agent edit can. */
export async function clearSelection(page: Page): Promise<void> {
  await hooksOf(page).canvas.clearSelection();
}

/** The canvas-local position of the middle of the open glyph's first segment. */
export async function firstSegmentMidpoint(page: Page): Promise<Point2D> {
  return hooksOf(page).canvas.firstSegmentMidpoint();
}

/**
 * The first line segment of the open glyph's first contour, as Cmd-hover would upgrade it: its
 * id, the control points an upgrade places at one and two thirds (glyph units and scene), and
 * the canvas-local position of its middle.
 */
export async function lineSegmentUpgrade(page: Page): Promise<{
  id: SegmentId;
  controls: Point2D[];
  sceneControls: Point2D[];
  hover: Point2D;
}> {
  return hooksOf(page).canvas.lineSegmentUpgrade();
}

/**
 * Moves the open glyph's placement to (200, -300), zooms in one step, and inserts an open
 * contour of four points across the canvas's vertical middle, two of them just past its left
 * and right edges and one 2px inside the left edge.
 */
export async function insertEdgeOverlappingContour(page: Page): Promise<void> {
  await hooksOf(page).canvas.insertEdgeOverlappingContour();
}

/**
 * The canvas-local position inside one half of the text run's spacing gap `gapIndex`, at
 * `height` of the line's height from its top (0.5 is the middle, where the value pill sits).
 */
export async function spacingHalfCanvasPoint(
  page: Page,
  gapIndex: number,
  side: "left" | "right",
  height: number,
): Promise<Point2D> {
  return hooksOf(page).canvas.spacingHalfCanvasPoint(gapIndex, side, height);
}

/** How many points the open glyph draws at the editor's location, interpolated between sources. */
export async function drawnPointCount(page: Page): Promise<number> {
  return hooksOf(page).interpolated.drawnPointCount();
}

/** How many components the open glyph draws at the editor's location, interpolated between sources. */
export async function drawnComponentCount(page: Page): Promise<number> {
  return hooksOf(page).interpolated.drawnComponentCount();
}

/**
 * The direct components the canvas draws for the glyph named `glyphName` at the editor's
 * location beside those its layer at the source named `sourceName` holds: their ids, and their
 * transforms as `[a, b, c, d, e, f]`.
 */
export async function drawnAndAuthoredComponents(
  page: Page,
  glyphName: string,
  sourceName: string,
): Promise<{
  renderedIds: string[];
  exactIds: string[];
  renderedTransforms: number[][];
  exactTransforms: number[][];
}> {
  return hooksOf(page).interpolated.drawnAndAuthoredComponents(glyphName, sourceName);
}

/**
 * Canvas-local positions over the canvas text run's glyphs 2 to 40 that hit-test as text and lie
 * inside a canvas of `size`, each with the text item it hits.
 */
export async function textRunHoverTargets(
  page: Page,
  size: { width: number; height: number },
): Promise<{ itemId: TextItemId; position: Point2D }[]> {
  return hooksOf(page).canvas.textRunHoverTargets(size);
}

/**
 * The live position of the `u` glyph's `top` anchor in its default-source layer, a drag's
 * uncommitted preview included, without waiting for edits to settle.
 */
export async function liveUTopAnchor(page: Page): Promise<LocalPoint> {
  return hooksOf(page).interpolated.liveUTopAnchor();
}
