import type { PointId, PointType } from "@shift/types";
import type { ContourFixture, GlyphFixture, PointNames } from "@/testing/fixtures";
import type { EditorDriver } from "./EditorDriver";

/**
 * Creates an empty glyph, opens it, and optionally draws `fixture` into it framed in the viewport.
 *
 * @remarks
 * Setup for gesture tests whose subject is not drawing. Returns after the drawing is
 * persisted, the selection is empty, and the fitted camera has rendered.
 *
 * @param page - authored workspace window.
 * @param editor - driver for the same window.
 * @param name - unique glyph name for the test.
 * @param fixture - what to draw, or just its contours; omit for an empty glyph at the default
 * camera.
 * @returns the drawn point ids, keyed by each point's `name`.
 */
export async function openScratchGlyph<const C extends readonly ContourFixture[]>(
  editor: EditorDriver,
  name: string,
  contours: C,
): Promise<Record<PointNames<{ contours: C }>, PointId>>;
export async function openScratchGlyph<const F extends GlyphFixture>(
  editor: EditorDriver,
  name: string,
  fixture?: F,
): Promise<Record<PointNames<F>, PointId>>;
export async function openScratchGlyph(
  editor: EditorDriver,
  name: string,
  fixture?: GlyphFixture | readonly ContourFixture[],
): Promise<Record<string, PointId>> {
  await editor.addGlyph(name, null);
  await editor.openGlyphByName(name);

  const glyph: GlyphFixture = isContourList(fixture) ? { contours: fixture } : (fixture ?? {});
  const draws =
    glyph.advance !== undefined ||
    (glyph.contours ?? []).length > 0 ||
    (glyph.anchors ?? []).length > 0 ||
    (glyph.components ?? []).length > 0;
  const names: Record<string, PointId> = draws ? await editor.draw(glyph) : {};
  if ((glyph.contours ?? []).length > 0) await editor.zoomToFit();

  await editor.waitForCanvasRender();
  return names;
}

function isContourList(
  fixture: GlyphFixture | readonly ContourFixture[] | undefined,
): fixture is readonly ContourFixture[] {
  return Array.isArray(fixture);
}

/**
 * An open four-segment cubic wave, wide enough to delete a middle point by fitting. Its third
 * on-curve point, at (550, 100), is named `middle`.
 */
export const WAVE_CONTOUR = {
  points: [
    [100, 300],
    { x: 150, y: 200, off: true },
    { x: 200, y: 150, off: true },
    { x: 300, y: 150, smooth: true },
    { x: 400, y: 150, off: true },
    { x: 450, y: 100, off: true },
    { x: 550, y: 100, smooth: true, name: "middle" },
    { x: 650, y: 100, off: true },
    { x: 700, y: 150, off: true },
    { x: 800, y: 150, smooth: true },
    { x: 900, y: 150, off: true },
    { x: 950, y: 200, off: true },
    [1000, 300],
  ],
} as const satisfies ContourFixture;

/**
 * Two open cubics along y = 100 joined at a smooth point, `join`, at (400, 100): the first
 * cubic's last handle, `incoming`, is at 300 and the second's first, `outgoing`, at 500.
 */
export const SMOOTH_JOIN_CONTOUR = {
  points: [
    [100, 100],
    { x: 200, y: 100, off: true },
    { x: 300, y: 100, off: true, name: "incoming" },
    { x: 400, y: 100, smooth: true, name: "join" },
    { x: 500, y: 100, off: true, name: "outgoing" },
    { x: 600, y: 100, off: true },
    [700, 100],
  ],
} as const satisfies ContourFixture;

/**
 * The point types of an open contour made of `segments` cubic segments, as
 * {@link WAVE_CONTOUR} is: an on-curve start, then two handles and an on-curve
 * point per segment.
 */
export function openCubicPointTypes(segments: number): readonly PointType[] {
  const segment: readonly PointType[] = ["offCurve", "offCurve", "onCurve"];
  return ["onCurve", ...Array.from({ length: segments }, () => segment).flat()];
}
