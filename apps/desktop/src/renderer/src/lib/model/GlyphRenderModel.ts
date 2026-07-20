import type { AnchorId, ContourId } from "@shift/types";
import { Point, Segment, type Anchor, type Contour } from "@shift/glyph-state";
import type {
  GlyphRenderAnchor,
  GlyphRenderAnchorInput,
  GlyphRenderContour,
  GlyphRenderContourInput,
} from "@/types/glyphRender";
import type { GlyphGeometry } from "./Glyph";
import { computed, track, type ComputedSignal, type Signal } from "@/lib/signals/signal";

/** Builds contour readers for a resolved geometry snapshot. */
export function geometryRenderContours(geometry: GlyphGeometry): readonly RenderContour[] {
  return geometry.contours.map((contour) => new GeometryRenderContour(contour));
}

/** Builds anchor readers for a resolved geometry snapshot. */
export function geometryRenderAnchors(geometry: GlyphGeometry): readonly RenderAnchor[] {
  return geometry.anchors.map((anchor) => new GeometryRenderAnchor(anchor));
}

export abstract class RenderContour implements GlyphRenderContour {
  abstract readonly id: ContourId;
  abstract readonly closed: boolean;
  abstract readonly points: readonly Point[];

  segments(): readonly Segment[] {
    return Segment.parse(this);
  }

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
export class LayerRenderContour extends RenderContour {
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

  override segments(): readonly Segment[] {
    return this.#contour.segments();
  }
}

/**
 * Render anchor backed by source structure plus a mutable coordinate buffer.
 */
export class LayerRenderAnchor extends RenderAnchor {
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
