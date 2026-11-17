import { Bounds, Mat, type Bounds as BoundsType, type MatModel } from "@shift/geo";
import { Point, Segment, erasedOutline, segmentContour } from "@shift/glyph-state";
import type {
  ComponentGlyph as ComponentGlyphDefinition,
  ComponentId,
  GlyphId,
  SourceId,
} from "@shift/types";
import { ContourPath } from "../graphics/ContourPath";
import { computed, track, type Signal } from "../signals";
import type { GlyphRenderContour, PlacedContours } from "../../types/glyphRender";
import type { ExternalAxisLocation } from "../../types/variation";
import type { GlyphRenderModel } from "./Glyph";
import type { RenderContour } from "./GlyphRenderModel";

const IDENTITY = Mat.Identity();

/**
 * Represents one Rust-projected component occurrence with live numeric transforms.
 *
 * @remarks
 * Rust has already fixed this occurrence's order, ancestry, and cycle status.
 * `componentPath` is its stable occurrence identity. The cells here only
 * evaluate authored matrices at the current external location; a component's
 * transform is its absolute placement within the parent.
 *
 * Between masters of a glyph whose components change scale, rotation, or
 * skew, the occurrence draws its outline as each master places it, blended,
 * the way compiled fonts interpolate it. It stays this component occurrence.
 *
 * A component that sets axes for its base glyph, or uses the font's
 * location, draws its base there: {@link locationCell} is where this
 * occurrence's base is drawn, and its own components start from it.
 */
export class ComponentGlyph {
  readonly #definitionCell: Signal<ComponentGlyphDefinition>;
  readonly #glyphIdCell: Signal<GlyphId>;
  readonly #parentLocationCell: Signal<ExternalAxisLocation>;
  readonly #renderModel: GlyphRenderModel;

  /** Where this occurrence draws its base glyph. */
  readonly locationCell: Signal<ExternalAxisLocation>;

  readonly transformCell: Signal<MatModel>;
  readonly resolvedTransformCell: Signal<MatModel>;
  readonly contoursCell: Signal<readonly GlyphContour[]>;
  readonly #placedContoursCell: Signal<readonly RenderContour[] | null>;
  readonly closedContoursPathCell: Signal<Path2D>;
  readonly childrenCell: Signal<readonly ComponentGlyph[]>;
  readonly boundsCell: Signal<BoundsType | null>;

  /**
   * Creates a reactive component occurrence from a Rust projection node.
   *
   * @param definitionCell - Rust-owned occurrence definition selected for the current location.
   * @param locationCell - External location shared with the root Glyph render model:
   * where the root glyph is drawn.
   * @param renderModel - Complete Glyph render model that owns this occurrence.
   */
  constructor(
    definitionCell: Signal<ComponentGlyphDefinition>,
    locationCell: Signal<ExternalAxisLocation>,
    renderModel: GlyphRenderModel,
  ) {
    this.#definitionCell = definitionCell;
    this.#glyphIdCell = computed(() => this.#definitionCell.value.baseGlyphId);
    this.#renderModel = renderModel;
    // The glyph this occurrence sits in is drawn where its own occurrence is.
    this.#parentLocationCell = computed(
      () => this.#parent()?.locationCell.value ?? locationCell.value,
    );
    this.locationCell = computed(() => {
      const definition = this.#definitionCell.value;
      const parent = this.#parentLocationCell.value;
      const component = this.#renderModel.geometryWhere(definition.parentGlyphId, parent)
        .components[definition.componentIndex];
      if (component?.baseGlyphId !== definition.baseGlyphId) return parent;

      return this.#renderModel.baseLocation(parent, component);
    });
    this.transformCell = computed(() => {
      const definition = this.#definitionCell.value;
      const parentLocation = this.#parentLocationCell.value;
      const geometry = this.#renderModel.geometryWhere(definition.parentGlyphId, parentLocation);

      const component = geometry.components[definition.componentIndex];
      if (component?.baseGlyphId !== definition.baseGlyphId) return Mat.Identity();
      // Inside a moved base, nothing is being edited: the authored placement there.
      if (parentLocation !== locationCell.value) return component.matrix;

      // Follows the anchors it sits on while they are being edited.
      return (
        this.#renderModel.componentMatrices(definition.parentGlyphId)[definition.componentIndex] ??
        component.matrix
      );
    });
    this.resolvedTransformCell = computed(() => {
      const parent = this.#parent();
      if (!parent) return this.transformCell.value;

      return Mat.Compose(parent.resolvedTransformCell.value, this.transformCell.value);
    });

    this.#placedContoursCell = computed(() => this.#placedContours());
    const placementCell = computed(() =>
      this.#placedContoursCell.value ? IDENTITY : this.resolvedTransformCell.value,
    );
    this.contoursCell = renderModel.contoursAt(
      this.#glyphIdCell,
      placementCell,
      this,
      this.#placedContoursCell,
      this.locationCell,
    );
    this.closedContoursPathCell = computed(() => {
      const path = new Path2D();
      for (const contour of this.contoursCell.value) {
        contour.trackShape();
        if (contour.contour.closed) path.addPath(contour.fillPath);
      }
      return path;
    });
    this.childrenCell = computed(() =>
      this.#renderModel.childrenOf(
        this.#definitionCell.value.componentPath,
        this.#renderModel.componentsCell.value,
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

  get closedContoursPath(): Path2D {
    return this.closedContoursPathCell.peek();
  }

  get children(): readonly ComponentGlyph[] {
    return this.childrenCell.peek();
  }

  get bounds(): BoundsType | null {
    return this.boundsCell.peek();
  }

  /**
   * @internal Returns this occurrence's placement in root coordinates as one
   * master of the root glyph draws it.
   */
  transformForSource(sourceId: SourceId): MatModel {
    track(this.#definitionCell);
    const definition = this.#definitionCell.peek();
    const geometry = this.#renderModel.geometryForSource(definition.parentGlyphId, sourceId);
    const component = geometry.components[definition.componentIndex];
    const local = component?.baseGlyphId === definition.baseGlyphId ? component.matrix : IDENTITY;
    const parent = this.#parent();
    if (!parent) return local;

    return Mat.Compose(parent.transformForSource(sourceId), local);
  }

  /**
   * @internal Returns this occurrence's outline at each of the root glyph's
   * decomposition masters, with that master's placement of it.
   */
  placedMasters(sourceIds: readonly SourceId[]): PlacedContours[] {
    track(this.#glyphIdCell);
    const glyphId = this.#glyphIdCell.peek();
    return sourceIds.map((sourceId) => ({
      matrix: this.transformForSource(sourceId),
      contours: this.#renderModel.geometryForSource(glyphId, sourceId).contours,
    }));
  }

  #placedContours(): readonly RenderContour[] | null {
    track(this.#renderModel.decomposedContoursCell);
    return this.#renderModel.decomposedContoursCell.peek()?.get(this) ?? null;
  }

  #parent(): ComponentGlyph | null {
    if (this.parentPath.length === 0) return null;

    return this.#renderModel.componentAt(this.parentPath);
  }
}

/**
 * Represents one contour occurrence in a Glyph render model.
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
  readonly #erasedPathCell: Signal<ContourPath | null>;
  readonly #boundsCell: Signal<BoundsType | null>;

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
    // Erased in the contour's own coordinates, as export erases the base glyph, then placed.
    this.#erasedPathCell = computed(() => {
      const contour = this.#contourCell.value;
      contour.trackShape();
      const outline = erasedOutline(contour);
      return outline ? ContourPath.fromOutline(outline, this.#matrixCell.value) : null;
    });
    this.#boundsCell = computed(() => {
      const contour = this.#contourCell.value;
      contour.trackShape();
      const matrix = this.#matrixCell.value;
      // Root contours sit unplaced, so their own cached bounds are already in root coordinates.
      if (Mat.isIdentity(matrix)) return contour.bounds;

      const points = contour.points.map((point) => ({
        ...point,
        ...Mat.applyToPoint(matrix, point),
      }));
      return segmentContour({ points, closed: contour.closed }).bounds;
    });
  }

  get contour(): GlyphRenderContour {
    return this.#contourCell.peek();
  }

  get closed(): boolean {
    return this.#contourCell.peek().closed;
  }

  get points(): readonly Point[] {
    const matrix = this.#matrixCell.peek();
    return this.#contourCell.peek().points.map((point) => {
      const position = Mat.applyToPoint(matrix, point);
      return new Point({ ...point, ...position });
    });
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

  /** The outline to fill: the contour with its open corners erased, or its own path. */
  get fillPath(): Path2D {
    return this.#erasedPathCell.peek()?.path ?? this.path;
  }

  /** Whether the contour has an open corner, so its fill outline differs from its points. */
  get hasOpenCorners(): boolean {
    return this.#erasedPathCell.peek() !== null;
  }

  get bounds(): BoundsType | null {
    return this.#boundsCell.peek();
  }

  /** Returns this occurrence's segments in root-glyph coordinates. */
  segments(): readonly Segment[] {
    const contour = this.#contourCell.peek();
    if (Mat.isIdentity(this.#matrixCell.peek())) return contour.segments();

    return Segment.parse(this);
  }

  trackShape(): void {
    track(this.#contourPathCell);
    track(this.#erasedPathCell);
  }
}
