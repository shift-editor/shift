/**
 * Point-mark harness — generates glyphs at scale for performance benchmarks.
 *
 * Uses the MutatorSans "S" glyph contour (44 points) as the template — a real
 * glyph with mixed curve/line segments, smooth/corner nodes, and typical
 * off-curve handle placement. Duplicated N times to reach target scale.
 */

import type { PointId } from "@shift/types";
import type { ContourContent, PointContent } from "@/lib/clipboard/types";
import type { NodePositionUpdateList } from "@/types/positionUpdate";
import { Glyphs } from "@shift/font";
import { TestEditor } from "./TestEditor";

/**
 * MutatorSans "S" glyph — extracted from MutatorSansLightCondensed.ufo.
 * 44 points, single closed contour with cubic bezier curves + line segments.
 */
const MUTATORSANS_S: readonly PointContent[] = [
  { x: 349, y: 157, pointType: "onCurve", smooth: true },
  { x: 348, y: 238, pointType: "offCurve", smooth: false },
  { x: 299, y: 293, pointType: "offCurve", smooth: false },
  { x: 217, y: 358, pointType: "onCurve", smooth: true },
  { x: 167, y: 398, pointType: "onCurve", smooth: true },
  { x: 105, y: 447, pointType: "offCurve", smooth: false },
  { x: 84, y: 494, pointType: "offCurve", smooth: false },
  { x: 84, y: 557, pointType: "onCurve", smooth: true },
  { x: 84, y: 619, pointType: "offCurve", smooth: false },
  { x: 128, y: 673, pointType: "offCurve", smooth: false },
  { x: 211, y: 673, pointType: "onCurve", smooth: true },
  { x: 219, y: 673, pointType: "onCurve", smooth: true },
  { x: 268, y: 673, pointType: "offCurve", smooth: false },
  { x: 308, y: 664, pointType: "offCurve", smooth: false },
  { x: 348, y: 640, pointType: "onCurve", smooth: false },
  { x: 365, y: 677, pointType: "onCurve", smooth: false },
  { x: 328, y: 696, pointType: "offCurve", smooth: false },
  { x: 291, y: 711, pointType: "offCurve", smooth: false },
  { x: 229, y: 711, pointType: "onCurve", smooth: true },
  { x: 222, y: 711, pointType: "onCurve", smooth: true },
  { x: 104, y: 711, pointType: "offCurve", smooth: false },
  { x: 45, y: 639, pointType: "offCurve", smooth: false },
  { x: 46, y: 544, pointType: "onCurve", smooth: true },
  { x: 47, y: 463, pointType: "offCurve", smooth: false },
  { x: 90, y: 406, pointType: "offCurve", smooth: false },
  { x: 172, y: 341, pointType: "onCurve", smooth: true },
  { x: 222, y: 301, pointType: "onCurve", smooth: true },
  { x: 293, y: 244, pointType: "offCurve", smooth: false },
  { x: 311, y: 207, pointType: "offCurve", smooth: false },
  { x: 311, y: 144, pointType: "onCurve", smooth: true },
  { x: 311, y: 82, pointType: "offCurve", smooth: false },
  { x: 267, y: 28, pointType: "offCurve", smooth: false },
  { x: 184, y: 28, pointType: "onCurve", smooth: true },
  { x: 176, y: 28, pointType: "onCurve", smooth: true },
  { x: 123.2, y: 28, pointType: "offCurve", smooth: false },
  { x: 80.35, y: 37.99, pointType: "offCurve", smooth: false },
  { x: 37, y: 64, pointType: "onCurve", smooth: false },
  { x: 20, y: 27, pointType: "onCurve", smooth: false },
  { x: 59.91, y: 6.5, pointType: "offCurve", smooth: false },
  { x: 99.44, y: -10, pointType: "offCurve", smooth: false },
  { x: 166, y: -10, pointType: "onCurve", smooth: true },
  { x: 173, y: -10, pointType: "onCurve", smooth: true },
  { x: 291, y: -10, pointType: "offCurve", smooth: false },
  { x: 350, y: 62, pointType: "offCurve", smooth: false },
];

const POINTS_PER_CONTOUR = MUTATORSANS_S.length; // 44

/**
 * Create an offset copy of the S contour, placed on a grid.
 */
function makeContour(offsetX: number, offsetY: number): ContourContent {
  const points: PointContent[] = MUTATORSANS_S.map((p) => ({
    x: p.x + offsetX,
    y: p.y + offsetY,
    pointType: p.pointType,
    smooth: p.smooth,
  }));
  return { points, closed: true };
}

/**
 * Generate enough contours to reach `targetPoints` total points.
 * Each contour is offset by a grid step to avoid overlap.
 */
function generateContours(targetPoints: number): ContourContent[] {
  const count = Math.ceil(targetPoints / POINTS_PER_CONTOUR);
  const cols = Math.ceil(Math.sqrt(count));
  const contours: ContourContent[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    contours.push(makeContour(col * 500, row * 800));
  }
  return contours;
}

export type PointScale = 1_000 | 10_000 | 50_000;

export interface PointMarkEditor {
  editor: TestEditor;
  pointIds: PointId[];
  pointCount: number;
}

/**
 * Create a TestEditor with a glyph at the given point scale.
 * Returns the editor and the list of all point IDs for selection/manipulation.
 */
export function createPointMark(scale: PointScale): PointMarkEditor {
  const editor = new TestEditor();
  editor.startSession("bench");

  const contours = generateContours(scale);
  const result = editor.bridge.pasteContours(contours, 0, 0);

  if (!result.success) {
    throw new Error(`Failed to create point mark at scale ${scale}`);
  }

  const glyph = editor.currentGlyph;
  if (!glyph) throw new Error("No glyph after pasteContours");

  const pointIds = Glyphs.getAllPoints(glyph).map((p) => p.id);

  return { editor, pointIds, pointCount: pointIds.length };
}

/**
 * Build a NodePositionUpdateList that shifts every point by (dx, dy).
 * Pre-computed outside the benchmark loop to isolate the operation under test.
 */
export function buildPositionUpdates(
  pointIds: readonly PointId[],
  dx: number,
  dy: number,
  baseX = 0,
  baseY = 0,
): NodePositionUpdateList {
  return pointIds.map((id, i) => ({
    node: { kind: "point" as const, id },
    x: baseX + i + dx,
    y: baseY + i + dy,
  }));
}
