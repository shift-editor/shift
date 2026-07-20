import { Bounds, Mat, Vec2, type Bounds as BoundsType, type MatModel } from "@shift/geo";
import { Point, Segment } from "@shift/glyph-state";
import type {
  ComponentGlyph as ComponentGlyphDefinition,
  ComponentId,
  GlyphId,
} from "@shift/types";
import { ContourPath } from "@/lib/graphics/ContourPath";
import { computed, track, type Signal } from "@/lib/signals";
import type { GlyphRenderContour } from "@/types/glyphRender";
import type { AxisLocation } from "@/types/variation";
import type { GlyphView } from "./Glyph";
import type { RenderContour } from "./GlyphRenderModel";

/**
 * Represents one Rust-projected component occurrence with live numeric transforms.
 *
 * @remarks
 * Rust has already fixed this occurrence's order, ancestry, attachment anchors,
 * and cycle status. `componentPath` is its stable occurrence identity. The
 * cells here only evaluate authored matrices and anchor coordinates at the
 * current design location.
 */
export class ComponentGlyph {
  readonly #definitionCell: Signal<ComponentGlyphDefinition>;
  readonly #glyphIdCell: Signal<GlyphId>;
  readonly #locationCell: Signal<AxisLocation>;
  readonly #view: GlyphView;
  readonly #localTransformCell: Signal<MatModel>;

  readonly transformCell: Signal<MatModel>;
  readonly resolvedTransformCell: Signal<MatModel>;
  readonly contoursCell: Signal<readonly GlyphContour[]>;
  readonly childrenCell: Signal<readonly ComponentGlyph[]>;
  readonly boundsCell: Signal<BoundsType | null>;

  /**
   * Creates a reactive component occurrence from a Rust projection node.
   *
   * @param definitionCell - Rust-owned occurrence definition selected for the current location.
   * @param locationCell - Design location shared with the root glyph view.
   * @param view - Complete glyph view that owns this occurrence.
   */
  constructor(
    definitionCell: Signal<ComponentGlyphDefinition>,
    locationCell: Signal<AxisLocation>,
    view: GlyphView,
  ) {
    this.#definitionCell = definitionCell;
    this.#glyphIdCell = computed(() => this.#definitionCell.value.baseGlyphId);
    this.#locationCell = locationCell;
    this.#view = view;
    this.transformCell = computed(() => {
      const definition = this.#definitionCell.value;
      const geometry = this.#view.geometryAt(definition.parentGlyphId, this.#locationCell.value);
      return (
        geometry.components.find((component) => component.id === definition.componentId)?.matrix ??
        Mat.Identity()
      );
    });
    this.#localTransformCell = computed(() => {
      const definition = this.#definitionCell.value;
      const explicit = this.transformCell.value;
      const attachment = definition.attachment;
      if (!attachment) return explicit;

      const location = this.#locationCell.value;
      const sourceGeometry = this.#view.geometryAt(attachment.source.glyphId, location);
      const source = sourceGeometry.anchor(attachment.source.anchorId);
      if (!source) return explicit;

      const targetComponent = this.#view.componentAt(attachment.target.componentPath);
      if (!targetComponent) return explicit;

      const targetGeometry = this.#view.geometryAt(attachment.target.glyphId, location);
      const target = targetGeometry.anchor(attachment.target.anchorId);
      if (!target) return explicit;

      const sourcePosition = Mat.applyToPoint(explicit, source);
      const targetPosition = Mat.applyToPoint(targetComponent.#localTransformCell.value, target);
      const attachmentDelta = Vec2.sub(targetPosition, sourcePosition);
      const attachmentOffset = Mat.Translate(attachmentDelta.x, attachmentDelta.y);
      return Mat.Compose(attachmentOffset, explicit);
    });
    this.resolvedTransformCell = computed(() => {
      const parent = this.#parent();
      if (!parent) return this.#localTransformCell.value;

      return Mat.Compose(parent.resolvedTransformCell.value, this.#localTransformCell.value);
    });

    this.contoursCell = view.contoursAt(this.#glyphIdCell, this.resolvedTransformCell, this);
    this.childrenCell = computed(() =>
      this.#view.childrenOf(
        this.#definitionCell.value.componentPath,
        this.#view.componentsCell.value,
      ),
    );
    this.boundsCell = computed(() => {
      const contours = this.contoursCell.value;
      for (const contour of contours) contour.trackShape();

      return Bounds.unionAll([
        ...contours.map((contour) => contour.bounds),
        ...this.childrenCell.value.map((component) => component.boundsCell.value),
      ]);
    });
  }

  get glyphId(): GlyphId {
    return this.#glyphIdCell.peek();
  }

  get componentId(): ComponentId {
    return this.#definitionCell.peek().componentId;
  }

  get componentPath(): readonly ComponentId[] {
    return this.#definitionCell.peek().componentPath;
  }

  get parentPath(): readonly ComponentId[] {
    return this.#definitionCell.peek().parentPath;
  }

  get parent(): ComponentGlyph | null {
    return this.#parent();
  }

  get transform(): MatModel {
    return this.transformCell.peek();
  }

  get resolvedTransform(): MatModel {
    return this.resolvedTransformCell.peek();
  }

  get contours(): readonly GlyphContour[] {
    return this.contoursCell.peek();
  }

  get children(): readonly ComponentGlyph[] {
    return this.childrenCell.peek();
  }

  get bounds(): BoundsType | null {
    return this.boundsCell.peek();
  }

  #parent(): ComponentGlyph | null {
    if (this.parentPath.length === 0) return null;

    return this.#view.componentAt(this.parentPath);
  }
}

/**
 * Represents one contour occurrence in a glyph view.
 *
 * @remarks
 * `component` is `null` for contours owned by the root glyph and identifies
 * the exact component occurrence for inherited contours. The source contour
 * reader is shared by placements of the same glyph, while `matrixCell` and
 * `component` make this wrapper specific to one occurrence.
 */
export class GlyphContour {
  readonly #contourCell: Signal<RenderContour>;
  readonly #matrixCell: Signal<MatModel>;
  readonly #component: ComponentGlyph | null;
  readonly #contourPathCell: Signal<ContourPath>;

  /**
   * Creates a contour occurrence over live source coordinates and placement.
   *
   * @param contourCell - Live source contour selected at the current location.
   * @param matrixCell - Transform from source glyph coordinates into root coordinates.
   * @param component - Owning component occurrence, or `null` for a root contour.
   */
  constructor(
    contourCell: Signal<RenderContour>,
    matrixCell: Signal<MatModel>,
    component: ComponentGlyph | null,
  ) {
    this.#contourCell = contourCell;
    this.#matrixCell = matrixCell;
    this.#component = component;
    this.#contourPathCell = computed(() => {
      const contour = this.#contourCell.value;
      contour.trackShape();
      return ContourPath.fromContour(contour, this.#matrixCell.value);
    });
  }

  get contour(): GlyphRenderContour {
    return this.#contourCell.peek();
  }

  get component(): ComponentGlyph | null {
    return this.#component;
  }

  get transformCell(): Signal<MatModel> {
    return this.#matrixCell;
  }

  get transform(): MatModel {
    return this.#matrixCell.peek();
  }

  get contourPath(): ContourPath {
    return this.#contourPathCell.peek();
  }

  get path(): Path2D {
    return this.contourPath.path;
  }

  get svgPath(): string {
    return this.contourPath.svgPath;
  }

  get bounds(): BoundsType | null {
    return this.contourPath.bounds;
  }

  /** Returns this occurrence's segments in root-glyph coordinates. */
  segments(): readonly Segment[] {
    const contour = this.#contourCell.peek();
    const matrix = this.#matrixCell.peek();
    const points = contour.points.map((point) => {
      const position = Mat.applyToPoint(matrix, point);
      return new Point({ ...point, ...position });
    });
    return Segment.parse({ closed: contour.closed, points });
  }

  trackShape(): void {
    track(this.#contourPathCell);
  }
}
