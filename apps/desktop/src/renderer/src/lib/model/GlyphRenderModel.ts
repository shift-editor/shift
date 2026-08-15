import type { AnchorId, ContourId } from "@shift/types";
import { Segment, type Anchor, type Contour, type Point } from "@shift/glyph-state";
import type { GlyphRenderAnchor, GlyphRenderContour } from "@/types/glyphRender";
import type { ContourBuffer } from "./ContourBuffer";
import type { GlyphGeometry } from "./Glyph";
import { track, type Signal } from "@/lib/signals/signal";

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
  readonly #input: Signal<ContourBuffer>;

  constructor(input: Signal<ContourBuffer>) {
    super();
    this.#input = input;
  }

  get id(): ContourId {
    return this.#input.peek().data.id;
  }

  get closed(): boolean {
    return this.#input.peek().data.closed;
  }

  get points(): readonly Point[] {
    return this.#input.peek().pointsCell.peek();
  }

  override trackShape(): void {
    track(this.#input);
    track(this.#input.peek().dataCell);
    track(this.#input.peek().valuesCell);
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
  readonly #input: Signal<Anchor>;

  constructor(input: Signal<Anchor>) {
    super();
    this.#input = input;
  }

  get id(): AnchorId {
    return this.#input.peek().id;
  }

  get name(): string | undefined {
    return this.#input.peek().name;
  }

  get x(): number {
    return this.#input.peek().x;
  }

  get y(): number {
    return this.#input.peek().y;
  }

  override trackShape(): void {
    track(this.#input);
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
