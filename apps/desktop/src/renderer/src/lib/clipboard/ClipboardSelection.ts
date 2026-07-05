import { isPointId, type PointId } from "@shift/types";
import { Validate } from "@shift/validation";
import type { Contour, Point } from "@shift/glyph-state";
import type { ContourContent, PointContent, ShiftContent } from "./types";
import type { SelectableId } from "@/types";

export interface ClipboardContourSource {
  readonly contours: readonly Contour[];
}

export interface ClipboardSelectionSource {
  readonly ids: readonly SelectableId[];
}

/**
 * Builds glyph clipboard content from selected point identities.
 *
 * @remarks
 * This class does not resolve semantic selections such as segments or nodes.
 * Callers must expand those selections against the appropriate layer first and
 * pass only concrete point ids here.
 */
export class ClipboardSelection {
  readonly #pointIds: ReadonlySet<PointId>;

  private constructor(pointIds: ReadonlySet<PointId>) {
    this.#pointIds = pointIds;
  }

  static fromSelection(selection: ClipboardSelectionSource): ClipboardSelection {
    return ClipboardSelection.fromPointIds(selection.ids.filter(isPointId));
  }

  /**
   * Captures the point ids that should be copied from a contour source.
   *
   * @param pointIds - Concrete point identities that belong to the contour
   * source passed later to {@link contentFrom}.
   * @returns a clipboard selection with its own copy of the id set.
   */
  static fromPointIds(pointIds: Iterable<PointId>): ClipboardSelection {
    return new ClipboardSelection(new Set(pointIds));
  }

  get pointIds(): readonly PointId[] {
    return [...this.#pointIds];
  }

  /**
   * Returns clipboard contour content resolved against the supplied contours.
   *
   * @remarks
   * Partial selections are expanded to include neighboring off-curve points when
   * needed to preserve valid curve fragments. The returned content is detached
   * from the source contours and can be written to the system clipboard.
   *
   * @param source - Contours that own the selected point ids.
   * @returns `null` when no selected points resolve to valid clipboard content.
   */
  contentFrom(source: ClipboardContourSource): ShiftContent | null {
    if (this.#pointIds.size === 0) return null;

    const contours: ContourContent[] = [];

    for (const contour of source.contours) {
      const selectedIndices = this.#selectedIndices(contour);
      if (selectedIndices.size === 0) continue;

      if (selectedIndices.size === contour.points.length) {
        contours.push({
          points: contour.points.map(toContent),
          closed: contour.closed,
        });
      } else {
        const expanded = expandPartialSelection(contour, selectedIndices);
        if (!Validate.hasValidAnchor(expanded)) continue;

        contours.push({ points: expanded.map(toContent), closed: false });
      }
    }

    if (contours.length === 0) return null;
    return { contours };
  }

  #selectedIndices(contour: Contour): Set<number> {
    const indices = new Set<number>();

    for (const [idx, point] of contour.points.entries()) {
      if (this.#pointIds.has(point.id)) {
        indices.add(idx);
      }
    }

    return indices;
  }
}

function toContent(point: Point): PointContent {
  return { x: point.x, y: point.y, pointType: point.pointType, smooth: point.smooth };
}

function expandPartialSelection(contour: Contour, selectedIndices: Set<number>): readonly Point[] {
  const expanded = new Set<number>(selectedIndices);

  for (const idx of selectedIndices) {
    const point = contour.pointAt(idx, false);
    if (!point) continue;

    if (Validate.isOnCurve(point)) {
      expandForOnCurve(contour, idx, expanded);
    } else {
      expandForOffCurve(contour, idx, expanded);
    }
  }

  return [...expanded]
    .sort((a, b) => a - b)
    .map((idx) => contour.pointAt(idx, false))
    .filter((p): p is Point => p !== null);
}

function expandForOnCurve(contour: Contour, idx: number, expanded: Set<number>): void {
  const prev = contour.pointAt(idx - 1, false);
  if (prev && Validate.isOffCurve(prev)) {
    expanded.add(idx - 1);
    const prevPrev = contour.pointAt(idx - 2, false);
    if (prevPrev && Validate.isOffCurve(prevPrev)) expanded.add(idx - 2);
  }

  const next = contour.pointAt(idx + 1, false);
  if (next && Validate.isOffCurve(next)) {
    expanded.add(idx + 1);
    const nextNext = contour.pointAt(idx + 2, false);
    if (nextNext && Validate.isOffCurve(nextNext)) expanded.add(idx + 2);
  }
}

function expandForOffCurve(contour: Contour, idx: number, expanded: Set<number>): void {
  const prev = contour.pointAt(idx - 1, false);
  if (prev) expanded.add(idx - 1);
  const next = contour.pointAt(idx + 1, false);
  if (next) expanded.add(idx + 1);
}
