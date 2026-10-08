import { Bounds, type Point2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import type { Font } from "../model/Font";
import type { GlyphLayer } from "../model/Glyph";
import { MetricSnap, PointAlignmentSnap, SnapSet } from "../model/positions";
import type { LocalBounds } from "../../types/coordinates";
import type { ShiftNode } from "../../types/node";
import type { PositionCondition } from "../../types/positionEdit";

/** Editor state snapping reads when it builds a snap set. */
export interface SnappingContext {
  readonly font: Pick<Font, "metricsForSource">;
  /** Snap distance in scene units at the current zoom. */
  readonly hitRadius: number;
  visibleLocalBounds(node: ShiftNode): LocalBounds | null;
}

/** Options for one layer's snap set. */
export interface LayerSnapOptions {
  /** Points that must not be alignment targets, such as the ones being moved. */
  readonly excluding?: ReadonlySet<PointId>;
  /** Excluded points still guided when they sit exactly on a line another target snapped to. */
  readonly marking?: ReadonlySet<PointId>;
  /** Per-frame switch for every snap in the set, such as a held modifier suspending it. */
  readonly condition?: PositionCondition;
}

/**
 * Decides how positions snap while editing glyphs.
 *
 * @remarks
 * Tools ask for a snap set per gesture or preview frame rather than composing providers
 * themselves, so every tool snaps to the same targets: the layer's source metrics and the
 * on-curve points on screen, within the pointer hit radius.
 */
export class Snapping {
  readonly #context: SnappingContext;

  constructor(context: SnappingContext) {
    this.#context = context;
  }

  /**
   * Builds the snap set for edits inside one glyph layer.
   *
   * @remarks
   * Targets and radius freeze when built.
   *
   * @param node - Node the layer is placed in; its visible area limits alignment targets.
   */
  forLayer(layer: GlyphLayer, node: ShiftNode | null, options: LayerSnapOptions = {}): SnapSet {
    const { font, hitRadius } = this.#context;
    const { excluding, marking } = options;
    const visible = node ? this.#context.visibleLocalBounds(node) : null;
    const onScreenOnCurve = layer.allPoints.filter(
      (point) => Point.isOnCurve(point) && (!visible || Bounds.containsPoint(visible, point)),
    );
    const targets = onScreenOnCurve.filter((point) => !excluding?.has(point.id));
    const marked = onScreenOnCurve.filter((point) => marking?.has(point.id));

    return SnapSet.nearest(
      [
        acrossAdvance(MetricSnap.standard(font.metricsForSource(layer.sourceId), hitRadius), layer),
        PointAlignmentSnap.to(targets, hitRadius).marking(marked),
      ],
      options.condition,
    );
  }

  /**
   * Bounding-box corners to cross wherever a drawn snap guide passes through them.
   *
   * @param extra - Further boxes in the same units, such as the selection's bounds.
   * @returns Corners of every contour in the layer and of each extra box.
   */
  crossings(layer: GlyphLayer, extra: readonly (Bounds | null)[] = []): Point2D[] {
    const boxes = [...layer.contours.map((contour) => contour.bounds), ...extra];
    return boxes.flatMap((box) => (box ? corners(box) : []));
  }
}

/** Limits metric snapping to the lines' drawn span; a zero-advance glyph, such as a mark, is unlimited. */
function acrossAdvance(snap: MetricSnap, layer: GlyphLayer): MetricSnap {
  const advance = layer.xAdvance;
  return advance > 0 ? snap.across({ minX: 0, maxX: advance }) : snap;
}

function corners({ min, max }: Bounds): Point2D[] {
  return [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
  ];
}
