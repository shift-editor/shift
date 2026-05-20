import type {
  AnchorData,
  AnchorId,
  ContourData,
  ContourId,
} from "@shift/types";
import { Point, type Anchor, type Contour } from "@shift/glyph-state";
import type { GlyphOutline } from "./GlyphOutline";
import type { GlyphGeometry } from "./Glyph";
import type { SourceContourCoordinates } from "./GlyphSourceState";
import {
  computed,
  track,
  type ComputedSignal,
  type Signal,
} from "@/lib/signals/signal";

/**
 * Contour shape as consumed by render code.
 *
 * @remarks
 * The `points` collection is a render-time view of authored contour structure
 * plus current coordinates. Source-backed contours can change coordinates
 * without changing contour identity.
 */
export interface GlyphRenderContour {
  readonly id: ContourId;
  readonly closed: boolean;
  readonly points: readonly Point[];
}

/**
 * Anchor position as consumed by render code.
 *
 * @remarks
 * Source-backed anchors can change position without replacing the anchor item.
 */
export interface GlyphRenderAnchor {
  readonly id: AnchorId;
  readonly name?: string;
  readonly x: number;
  readonly y: number;
}

export interface GlyphRenderContourInput {
  readonly data: ContourData;
  readonly coordinates: SourceContourCoordinates;
}

export interface GlyphRenderAnchorInput {
  readonly data: AnchorData;
  readonly values: Signal<Float64Array>;
  readonly offset: number;
}

/**
 * Render-facing projection for one displayed glyph.
 *
 * This keeps renderers off `GlyphGeometry` during exact-source editing. Source
 * backed contours read per-contour value buffers, while geometry-backed
 * contours are immutable fallback data for interpolated locations.
 */
export class GlyphRenderModel {
  readonly #contours: Signal<readonly RenderContour[]>;
  readonly #anchors: Signal<readonly RenderAnchor[]>;

  readonly outline: GlyphOutline;

  /**
   * Creates a render projection over contour, anchor, and outline state.
   *
   * @param contours - Signal containing the displayed contour items.
   * @param anchors - Signal containing the displayed anchor items.
   * @param outline - Cached outline model for filled and stroked glyph drawing.
   */
  constructor(
    contours: Signal<readonly RenderContour[]>,
    anchors: Signal<readonly RenderAnchor[]>,
    outline: GlyphOutline,
  ) {
    this.#contours = contours;
    this.#anchors = anchors;
    this.outline = outline;
  }

  /**
   * Builds geometry-backed contour items from an immutable glyph snapshot.
   *
   * @param geometry - Snapshot geometry for a non-editable or interpolated display location.
   * @returns Render contour items backed directly by the geometry snapshot.
   */
  static geometryContours(geometry: GlyphGeometry): readonly RenderContour[] {
    return geometry.contours.map(
      (contour) => new GeometryRenderContour(contour),
    );
  }

  /**
   * Builds geometry-backed anchor items from an immutable glyph snapshot.
   *
   * @param geometry - Snapshot geometry for a non-editable or interpolated display location.
   * @returns Render anchor items backed directly by the geometry snapshot.
   */
  static geometryAnchors(geometry: GlyphGeometry): readonly RenderAnchor[] {
    return geometry.anchors.map((anchor) => new GeometryRenderAnchor(anchor));
  }

  /**
   * Returns the displayed contour items without subscribing to changes.
   *
   * @returns A read-only view of the current render contour items.
   */
  get contours(): readonly GlyphRenderContour[] {
    return this.#contours.peek();
  }

  /**
   * Returns the displayed anchor items without subscribing to changes.
   *
   * @returns A read-only view of the current render anchor items.
   */
  get anchors(): readonly GlyphRenderAnchor[] {
    return this.#anchors.peek();
  }

  /**
   * Establishes reactive dependencies for anything that can change displayed glyph shape.
   *
   * @remarks
   * Call this inside a render dependency boundary. The method tracks structural
   * replacement of contour and anchor lists, then delegates to each item so
   * source-backed coordinates can invalidate rendering without forcing callers
   * to know which backing model they are reading.
   */
  trackShape(): void {
    track(this.#contours);
    track(this.#anchors);

    this.outline.trackShape();

    for (const contour of this.#contours.peek()) contour.trackShape();
    for (const anchor of this.#anchors.peek()) anchor.trackShape();
  }
}

export abstract class RenderContour implements GlyphRenderContour {
  abstract readonly id: ContourId;
  abstract readonly closed: boolean;
  abstract readonly points: readonly Point[];

  trackShape(): void {}
}

export abstract class RenderAnchor implements GlyphRenderAnchor {
  abstract readonly id: AnchorId;
  abstract readonly name?: string;
  abstract readonly x: number;
  abstract readonly y: number;

  trackShape(): void {}
}

/**
 * Render contour backed by source structure plus a mutable coordinate buffer.
 */
export class SourceRenderContour extends RenderContour {
  readonly #input: Signal<GlyphRenderContourInput>;
  readonly #points: ComputedSignal<readonly Point[]>;

  constructor(input: Signal<GlyphRenderContourInput>) {
    super();
    this.#input = input;

    this.#points = computed(() => {
      const { data, coordinates } = this.#input.value;
      const values = coordinates.values.value;

      return data.points.map(
        (point, index) =>
          new Point({
            ...point,
            x: values[index * 2] ?? 0,
            y: values[index * 2 + 1] ?? 0,
          }),
      );
    });
  }

  get id(): ContourId {
    return this.#input.peek().data.id;
  }

  get closed(): boolean {
    return this.#input.peek().data.closed;
  }

  get points(): readonly Point[] {
    return this.#points.peek();
  }

  override trackShape(): void {
    track(this.#input);
    track(this.#input.peek().coordinates.values);
  }
}

/**
 * Render contour backed by an immutable geometry snapshot.
 */
class GeometryRenderContour extends RenderContour {
  readonly #contour: Contour;

  constructor(contour: Contour) {
    super();
    this.#contour = contour;
  }

  get id(): ContourId {
    return this.#contour.id;
  }

  get closed(): boolean {
    return this.#contour.closed;
  }

  get points(): readonly Point[] {
    return this.#contour.points;
  }
}

/**
 * Render anchor backed by source structure plus a mutable coordinate buffer.
 */
export class SourceRenderAnchor extends RenderAnchor {
  readonly #input: Signal<GlyphRenderAnchorInput>;

  constructor(input: Signal<GlyphRenderAnchorInput>) {
    super();
    this.#input = input;
  }

  get id(): AnchorId {
    return this.#input.peek().data.id;
  }

  get name(): string | undefined {
    return this.#input.peek().data.name;
  }

  get x(): number {
    const { values, offset } = this.#input.peek();
    return values.peek()[offset] ?? 0;
  }

  get y(): number {
    const { values, offset } = this.#input.peek();
    return values.peek()[offset + 1] ?? 0;
  }

  override trackShape(): void {
    track(this.#input);
    track(this.#input.peek().values);
  }
}

/**
 * Render anchor backed by an immutable geometry snapshot.
 */
class GeometryRenderAnchor extends RenderAnchor {
  readonly #anchor: Anchor;

  constructor(anchor: Anchor) {
    super();
    this.#anchor = anchor;
  }

  get id(): AnchorId {
    return this.#anchor.id;
  }

  get name(): string | undefined {
    return this.#anchor.name;
  }

  get x(): number {
    return this.#anchor.x;
  }

  get y(): number {
    return this.#anchor.y;
  }
}
