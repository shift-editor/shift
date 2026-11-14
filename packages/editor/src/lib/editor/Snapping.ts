import { Bounds, type Point2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import type { Font } from "../model/Font";
import type { GlyphLayer } from "../model/Glyph";
import { GridSnap, MetricSnap, PointAlignmentSnap, SnapSet } from "../model/positions";
import type { Grid } from "./Grid";
import { sceneVector, screenVector } from "./spaces";
import type { LocalBounds, LocalVector, SceneVector, ScreenVector } from "../../types/coordinates";
import type { ShiftNode } from "../../types/node";
import type { PositionCondition, PositionSnapProvider } from "../../types/positionEdit";

/** Editor state snapping reads when it builds a snap set. */
export interface SnappingContext {
  readonly font: Pick<Font, "metricsForSource">;
  /** The canvas grid; its intersections are snap targets while its snapping is on. */
  readonly grid: Pick<Grid, "settings">;
  /** Snap distance at the current zoom in the units of `node`. */
  hitRadiusIn(node: ShiftNode): number;
  /** Snap distance in scene units at the current zoom, for a layer placed in no node. */
  readonly hitRadius: number;
  visibleLocalBounds(node: ShiftNode): LocalBounds | null;
  /** A canvas displacement in scene units at the current zoom. */
  toSceneVector(vector: ScreenVector): SceneVector;
  /** A scene displacement in the units of `node`. */
  toLocalVector(node: ShiftNode, vector: SceneVector): LocalVector;
}

/** Options for one layer's snap set. */
export interface LayerSnapOptions {
  /** Points that must not be alignment targets, such as the ones being moved. */
  // oxlint-disable-next-line shift/no-optional-collection-field -- an options bag; absent excludes nothing
  readonly excluding?: ReadonlySet<PointId>;
  /** Excluded points still guided when they sit exactly on a line another target snapped to. */
  // oxlint-disable-next-line shift/no-optional-collection-field -- an options bag; absent marks nothing
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
 * on-curve points on screen, within the pointer hit radius, and the grid's intersections
 * while snapping to the grid is on.
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
    const { font } = this.#context;
    const hitRadius = node ? this.#context.hitRadiusIn(node) : this.#context.hitRadius;
    const { excluding, marking } = options;
    const visible = node ? this.#context.visibleLocalBounds(node) : null;
    const onScreenOnCurve = layer.allPoints.filter(
      (point) => Point.isOnCurve(point) && (!visible || Bounds.containsPoint(visible, point)),
    );
    const targets = onScreenOnCurve.filter((point) => !excluding?.has(point.id));
    const marked = onScreenOnCurve.filter((point) => marking?.has(point.id));

    const providers: PositionSnapProvider[] = [
      acrossAdvance(MetricSnap.standard(font.metricsForSource(layer.sourceId), hitRadius), layer),
      PointAlignmentSnap.to(targets, hitRadius).marking(marked),
    ];
    const grid = this.toGrid(node);
    if (grid) providers.push(grid);

    return SnapSet.nearest(providers, options.condition);
  }

  /**
   * Builds the grid snap for moves that have no layer targets, such as a component's placement.
   *
   * @remarks
   * Frozen when built, like {@link forLayer}: it snaps to the grid lines on
   * screen at the zoom of that moment.
   *
   * @param node - Node whose units the snapped positions are in; null for scene units.
   * @param condition - Per-frame switch, such as a held modifier suspending it.
   * @returns null while snapping to the grid is off, or when no grid lines are on screen.
   */
  toGrid(node: ShiftNode | null, condition?: PositionCondition): GridSnap | null {
    const settings = this.#context.grid.settings;
    if (!settings.snap) return null;

    return GridSnap.of(settings, this.#pixelsPerUnit(node), condition);
  }

  /** Screen pixels per unit of `node` on each axis at the current zoom. */
  #pixelsPerUnit(node: ShiftNode | null): Point2D {
    return {
      x: 1 / this.#unitsPerPixel(node, screenVector(1, 0)),
      y: 1 / this.#unitsPerPixel(node, screenVector(0, 1)),
    };
  }

  #unitsPerPixel(node: ShiftNode | null, pixel: ScreenVector): number {
    const scene = this.#context.toSceneVector(pixel);
    const units = node ? this.#context.toLocalVector(node, scene) : sceneVector(scene.x, scene.y);
    return Math.hypot(units.x, units.y);
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
