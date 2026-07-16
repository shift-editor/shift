import { Bounds, Mat, type Bounds as BoundsType, type MatModel, type Point2D } from "@shift/geo";
import type { Signal } from "@/lib/signals/signal";
import { computed, signal, track, type ComputedSignal } from "@/lib/signals/signal";
import type { AxisLocation } from "@/types/variation";
import { Contour, Segment } from "@shift/glyph-state";
import type { GlyphGeometry, GlyphLayer } from "./Glyph";
import type { ContourData, GlyphId } from "@shift/types";
import type { LayerContourCoordinates } from "./GlyphLayerState";

type AuthoredLayerForLocation = (glyphId: GlyphId, location: AxisLocation) => GlyphLayer | null;
type ResolvedGeometryForLocation = (glyphId: GlyphId, location: AxisLocation) => GlyphGeometry;

type OutlineCommand =
  | { readonly kind: "move"; readonly to: Point2D }
  | { readonly kind: "line"; readonly to: Point2D }
  | { readonly kind: "quad"; readonly control: Point2D; readonly to: Point2D }
  | {
      readonly kind: "cubic";
      readonly control1: Point2D;
      readonly control2: Point2D;
      readonly to: Point2D;
    }
  | { readonly kind: "close" };

interface OutlineData {
  readonly parts: readonly OutlinePart[];
}

/**
 * Drawable outline part for one contour after component transforms are applied.
 *
 * @remarks
 * Parts are the cache boundary for outline rendering. A layer-backed part can
 * update its `path`, `svgPath`, and `bounds` when coordinates move; a
 * geometry-backed part is immutable after construction.
 */
export interface OutlinePart {
  readonly path: Path2D;
  readonly svgPath: string;
  readonly bounds: BoundsType | null;

  /**
   * Establishes dependencies for this part's drawable shape.
   *
   * @remarks
   * Call inside a render or composed-outline computed before reading cached
   * part output. The method should not build a `Path2D`; it only records the
   * source signals that would make the cached output stale.
   */
  trackShape(): void;
}

/**
 * Outline part backed by source structure and live coordinate buffers.
 *
 * @remarks
 * The contour's point identity comes from structure, while the coordinates are
 * read from the source buffer. This lets sparse point edits invalidate one
 * contour part instead of rebuilding a full glyph snapshot.
 */
class LayerOutlinePart implements OutlinePart {
  readonly #contour: ContourData;
  readonly #values: LayerContourCoordinates;

  readonly #matrix: Signal<MatModel>;

  readonly #commands: ComputedSignal<readonly OutlineCommand[]>;
  readonly #path: ComputedSignal<Path2D>;
  readonly #svgPath: ComputedSignal<string>;

  readonly #bounds: ComputedSignal<BoundsType | null>;

  /**
   * Creates a layer-backed outline part.
   *
   * @param contour - Contour structure whose points define the segment order.
   * @param values - Coordinate buffer for the contour's current source values.
   * @param matrix - Component transform applied to the contour.
   */
  constructor(contour: ContourData, values: LayerContourCoordinates, matrix: Signal<MatModel>) {
    this.#contour = contour;
    this.#values = values;
    this.#matrix = matrix;

    this.#commands = computed(() =>
      OutlineCommands.fromContour(
        new Contour(this.#contour, this.#values.values.value, 0),
        this.#matrix.value,
      ),
    );
    this.#path = computed(() => LayerOutlinePart.#commandsToPath(this.#commands.value));
    this.#svgPath = computed(() =>
      this.#commands.value.map((command) => OutlineCommands.toSvg(command)).join(" "),
    );

    this.#bounds = computed(() => OutlineCommands.bounds(this.#commands.value));
  }

  get path(): Path2D {
    return this.#path.peek();
  }

  get svgPath(): string {
    return this.#svgPath.peek();
  }

  get bounds(): BoundsType | null {
    return this.#bounds.peek();
  }

  trackShape(): void {
    track(this.#values.values);
    track(this.#matrix);
  }

  static #commandsToPath(commands: readonly OutlineCommand[]): Path2D {
    const path = new Path2D();
    for (const command of commands) {
      switch (command.kind) {
        case "move":
          path.moveTo(command.to.x, command.to.y);
          break;
        case "line":
          path.lineTo(command.to.x, command.to.y);
          break;
        case "quad":
          path.quadraticCurveTo(command.control.x, command.control.y, command.to.x, command.to.y);
          break;
        case "cubic":
          path.bezierCurveTo(
            command.control1.x,
            command.control1.y,
            command.control2.x,
            command.control2.y,
            command.to.x,
            command.to.y,
          );
          break;
        case "close":
          path.closePath();
          break;
      }
    }
    return path;
  }
}

/**
 * Outline part backed by an immutable geometry contour.
 *
 * @remarks
 * Geometry-backed parts are used when the outline is not backed by a live glyph layer
 * location. Their path surfaces are built lazily and remain valid for the
 * lifetime of the part.
 */
class GeometryOutlinePart implements OutlinePart {
  readonly #commands: readonly OutlineCommand[];
  readonly #bounds: BoundsType | null;

  #path: Path2D | null = null;
  #svgPath: string | null = null;

  constructor(contour: Contour, matrix: MatModel) {
    this.#commands = OutlineCommands.fromContour(contour, matrix);
    this.#bounds = OutlineCommands.bounds(this.#commands);
  }

  get path(): Path2D {
    if (!this.#path) {
      this.#path = this.#commandsToPath();
    }
    return this.#path;
  }

  get svgPath(): string {
    if (this.#svgPath === null) {
      this.#svgPath = this.#commands.map((command) => OutlineCommands.toSvg(command)).join(" ");
    }
    return this.#svgPath;
  }

  get bounds(): BoundsType | null {
    return this.#bounds;
  }

  trackShape(): void {}

  #commandsToPath(): Path2D {
    const path = new Path2D();
    for (const command of this.#commands) {
      switch (command.kind) {
        case "move":
          path.moveTo(command.to.x, command.to.y);
          break;
        case "line":
          path.lineTo(command.to.x, command.to.y);
          break;
        case "quad":
          path.quadraticCurveTo(command.control.x, command.control.y, command.to.x, command.to.y);
          break;
        case "cubic":
          path.bezierCurveTo(
            command.control1.x,
            command.control1.y,
            command.control2.x,
            command.control2.y,
            command.to.x,
            command.to.y,
          );
          break;
        case "close":
          path.closePath();
          break;
      }
    }
    return path;
  }
}

/**
 * Reactive composed outline for one glyph.
 *
 * A `GlyphOutline` follows its context's design location and expands component
 * glyphs into drawable contour parts. Exact source locations use live
 * contour value buffers, so a sparse point preview invalidates only the touched
 * contour path instead of one full-glyph `Path2D`.
 */
export class GlyphOutline {
  readonly #glyphId: GlyphId;
  readonly #variationLocation: Signal<AxisLocation>;
  readonly #authoredLayerForLocation: AuthoredLayerForLocation;
  readonly #resolvedGeometryForLocation: ResolvedGeometryForLocation;
  readonly #data: ComputedSignal<OutlineData>;
  readonly #bounds: ComputedSignal<BoundsType | null>;
  readonly #drawPath: ComputedSignal<Path2D>;
  readonly #svgPath: ComputedSignal<string>;

  /**
   * Creates an outline model for one glyph at a reactive design location.
   *
   * @param glyphId - Stable identity of the glyph whose contours and components are expanded.
   * @param variationLocation - Design location that selects layer-backed or geometry-backed outline parts.
   * @param authoredLayerForLocation - Exact authored layer lookup for layer-backed outline parts.
   * @param resolvedGeometryForLocation - Resolved geometry lookup for interpolated outline parts.
   */
  constructor(
    glyphId: GlyphId,
    variationLocation: Signal<AxisLocation>,
    authoredLayerForLocation: AuthoredLayerForLocation,
    resolvedGeometryForLocation: ResolvedGeometryForLocation,
  ) {
    this.#glyphId = glyphId;
    this.#variationLocation = variationLocation;
    this.#authoredLayerForLocation = authoredLayerForLocation;
    this.#resolvedGeometryForLocation = resolvedGeometryForLocation;

    this.#data = computed(() =>
      new GlyphOutlineBuilder(
        this.#variationLocation.value,
        this.#authoredLayerForLocation,
        this.#resolvedGeometryForLocation,
      ).build(this.#glyphId),
    );

    this.#bounds = computed(() => {
      const parts = this.#data.value.parts;
      for (const part of parts) part.trackShape();
      return Bounds.unionAll(parts.map((part) => part.bounds));
    });

    this.#drawPath = computed(() => {
      const path = new Path2D();
      const parts = this.#data.value.parts;

      for (const part of parts) {
        part.trackShape();
        path.addPath(part.path);
      }
      return path;
    });

    this.#svgPath = computed(() => {
      const parts = this.#data.value.parts;

      for (const part of parts) part.trackShape();
      return parts.map((part) => part.svgPath).join(" ");
    });
  }

  /**
   * Returns drawable contour and component parts without subscribing to changes.
   *
   * @returns A read-only snapshot view of the current outline parts.
   */
  get parts(): readonly OutlinePart[] {
    return this.#data.peek().parts;
  }

  /**
   * Returns the composed canvas path without subscribing to changes.
   *
   * @returns A cached `Path2D` for the current outline shape.
   */
  get drawPath(): Path2D {
    return this.#drawPath.peek();
  }

  /**
   * Returns SVG path data without subscribing to changes.
   *
   * @returns Cached SVG path data for the current outline shape.
   */
  get svgPath(): string {
    return this.#svgPath.peek();
  }

  /**
   * Exposes reactive SVG path data for UI components.
   *
   * @returns A signal that invalidates when the current SVG path data changes.
   */
  get svgPathCell(): Signal<string> {
    return this.#svgPath;
  }

  /**
   * Returns outline bounds without subscribing to changes.
   *
   * @returns Bounds of the composed outline, or `null` when it has no drawable commands.
   */
  get bounds(): BoundsType | null {
    return this.#bounds.peek();
  }

  /**
   * Returns whether the current outline has no drawable commands.
   *
   * @returns `true` when the outline currently has no drawable parts.
   */
  get isEmpty(): boolean {
    return this.#data.peek().parts.length === 0;
  }

  /**
   * Establishes reactive dependencies for anything that can change the rendered outline.
   *
   * @remarks
   * Call this inside a render dependency boundary. It tracks outline part
   * replacement plus layer-backed coordinate changes, without forcing a
   * composed `Path2D` build during dependency collection.
   */
  trackShape(): void {
    track(this.#data);
    for (const part of this.#data.peek().parts) part.trackShape();
  }
}

/**
 * Builds composed outline command data for one design location.
 *
 * The builder is intentionally short-lived. It owns recursion state while
 * expanding components, then returns either layer-backed reactive parts or
 * immutable geometry-backed parts.
 */
class GlyphOutlineBuilder {
  readonly #location: AxisLocation;
  readonly #authoredLayerForLocation: AuthoredLayerForLocation;
  readonly #resolvedGeometryForLocation: ResolvedGeometryForLocation;
  readonly #stack = new Set<GlyphId>();

  constructor(
    location: AxisLocation,
    authoredLayerForLocation: AuthoredLayerForLocation,
    resolvedGeometryForLocation: ResolvedGeometryForLocation,
  ) {
    this.#location = location;
    this.#authoredLayerForLocation = authoredLayerForLocation;
    this.#resolvedGeometryForLocation = resolvedGeometryForLocation;
  }

  build(glyphId: GlyphId): OutlineData {
    return this.#collect(glyphId, Mat.Identity());
  }

  #collect(glyphId: GlyphId, matrix: MatModel): OutlineData {
    if (this.#stack.has(glyphId)) return { parts: [] };
    this.#stack.add(glyphId);

    const parts: OutlinePart[] = [];
    const source = this.#authoredLayerForLocation(glyphId, this.#location);

    if (source) {
      track(source.structureCell);
      track(source.coordinateBuffersCell);
      const structure = source.structureCell.peek();
      const coordinates = source.coordinateBuffersCell.peek();
      const matrixSignal = signal(matrix);
      for (let index = 0; index < structure.contours.length; index++) {
        const contourValues = coordinates.contours[index];
        if (contourValues) {
          parts.push(new LayerOutlinePart(structure.contours[index], contourValues, matrixSignal));
        }
      }

      for (let index = 0; index < structure.components.length; index++) {
        const component = structure.components[index];
        const componentValues = coordinates.components[index];
        if (!componentValues) continue;

        track(componentValues.matrix);
        const child = this.#collect(
          component.baseGlyphId,
          Mat.Compose(matrix, componentValues.matrix.peek()),
        );
        parts.push(...child.parts);
      }
    } else {
      const geometry = this.#resolvedGeometryForLocation(glyphId, this.#location);
      for (const contour of geometry.contours) {
        parts.push(new GeometryOutlinePart(contour, matrix));
      }

      for (const component of geometry.components) {
        const child = this.#collect(component.baseGlyphId, Mat.Compose(matrix, component.matrix));
        parts.push(...child.parts);
      }
    }

    this.#stack.delete(glyphId);
    return { parts };
  }
}

class OutlineCommands {
  static fromContour(contour: Contour, matrix: MatModel): readonly OutlineCommand[] {
    const segments = Segment.parse(contour);
    const first = segments[0];
    if (!first) return [];

    const commands: OutlineCommand[] = [];
    const start = Mat.applyToPoint(matrix, first.start);
    commands.push({ kind: "move", to: start });

    for (const segment of segments) {
      const points = segment.points;
      switch (points.type) {
        case "line": {
          const to = Mat.applyToPoint(matrix, points.end);
          commands.push({ kind: "line", to });
          break;
        }
        case "quad": {
          const control = Mat.applyToPoint(matrix, points.control);
          const to = Mat.applyToPoint(matrix, points.end);
          commands.push({ kind: "quad", control, to });
          break;
        }
        case "cubic": {
          const control1 = Mat.applyToPoint(matrix, points.controlStart);
          const control2 = Mat.applyToPoint(matrix, points.controlEnd);
          const to = Mat.applyToPoint(matrix, points.end);
          commands.push({ kind: "cubic", control1, control2, to });
          break;
        }
      }
    }

    if (contour.closed) commands.push({ kind: "close" });
    return commands;
  }

  static bounds(commands: readonly OutlineCommand[]): BoundsType | null {
    const points: Point2D[] = [];
    for (const command of commands) {
      switch (command.kind) {
        case "move":
        case "line":
          points.push(command.to);
          break;
        case "quad":
          points.push(command.control, command.to);
          break;
        case "cubic":
          points.push(command.control1, command.control2, command.to);
          break;
      }
    }
    return Bounds.fromPoints(points);
  }

  static toSvg(command: OutlineCommand): string {
    switch (command.kind) {
      case "move":
        return `M ${OutlineCommands.#formatNumber(command.to.x)} ${OutlineCommands.#formatNumber(command.to.y)}`;
      case "line":
        return `L ${OutlineCommands.#formatNumber(command.to.x)} ${OutlineCommands.#formatNumber(command.to.y)}`;
      case "quad":
        return [
          "Q",
          OutlineCommands.#formatNumber(command.control.x),
          OutlineCommands.#formatNumber(command.control.y),
          OutlineCommands.#formatNumber(command.to.x),
          OutlineCommands.#formatNumber(command.to.y),
        ].join(" ");
      case "cubic":
        return [
          "C",
          OutlineCommands.#formatNumber(command.control1.x),
          OutlineCommands.#formatNumber(command.control1.y),
          OutlineCommands.#formatNumber(command.control2.x),
          OutlineCommands.#formatNumber(command.control2.y),
          OutlineCommands.#formatNumber(command.to.x),
          OutlineCommands.#formatNumber(command.to.y),
        ].join(" ");
      case "close":
        return "Z";
    }
  }

  static #formatNumber(value: number): string {
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? "0" : `${rounded}`;
  }
}
