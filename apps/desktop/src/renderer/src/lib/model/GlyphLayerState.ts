import type {
  AnchorId,
  ContourId,
  GlyphState,
  GlyphStructure,
  LayerId,
  PointId,
} from "@shift/types";
import { Bounds, Mat, type Bounds as BoundsType, type MatModel } from "@shift/geo";
import {
  GlyphStateGeometry as GlyphGeometry,
  type GlyphPosition,
  type GlyphPositionTarget,
  type GlyphPositions,
  type GlyphSidebearings,
} from "@shift/glyph-state";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals/signal";

interface PointBufferLocation {
  readonly contourIndex: number;
  readonly offset: number;
}

/**
 * Reactive state for one authored glyph layer.
 *
 * The domain shape remains `GlyphStructure + Float64Array`. This class only
 * splits the packed value buffer into reactive buffers so pointer previews can
 * update a touched contour without invalidating every contour path.
 */
export class GlyphLayerState {
  readonly #layerId: LayerId;
  readonly #structure: WritableSignal<GlyphStructure>;
  readonly #coordinates: WritableSignal<LayerCoordinateBuffers>;
  readonly #xAdvance: ComputedSignal<number>;
  readonly #sidebearings: ComputedSignal<GlyphSidebearings>;
  readonly #coordinateBuffersChanged: ComputedSignal<LayerCoordinateBuffers>;
  readonly #geometry: ComputedSignal<GlyphGeometry>;

  constructor(state: GlyphState) {
    this.#layerId = state.layerId;
    this.#structure = signal(state.structure, {
      name: "glyphLayer.structure",
    });
    this.#coordinates = signal(LayerCoordinateBuffers.fromState(state), {
      name: "glyphLayer.coordinateBuffers",
    });
    this.#xAdvance = computed(() => this.#coordinates.value.xAdvance.value, {
      name: "glyphLayer.xAdvance",
    });
    this.#sidebearings = computed(() => this.#coordinates.value.sidebearings.value, {
      name: "glyphLayer.sidebearings",
    });
    this.#coordinateBuffersChanged = computed(
      () => {
        const buffers = this.#coordinates.value;
        buffers.changedCell.value;
        return buffers;
      },
      { name: "glyphLayer.coordinateBuffers.changed" },
    );
    this.#geometry = computed(
      () => new GlyphGeometry(this.#structure.value, this.#coordinates.value.snapshot.value),
      { name: "glyphLayer.geometry" },
    );
  }

  get structure(): GlyphStructure {
    return this.#structure.peek();
  }

  get structureCell(): Signal<GlyphStructure> {
    return this.#structure;
  }

  get layerId(): LayerId {
    return this.#layerId;
  }

  get coordinateBuffers(): LayerCoordinateBuffers {
    return this.#coordinates.peek();
  }

  /**
   * Returns the live coordinate-buffer container.
   *
   * @returns A signal that changes when the buffer container is replaced, not
   * when individual coordinates inside that container change.
   */
  get coordinateBuffersCell(): Signal<LayerCoordinateBuffers> {
    return this.#coordinates;
  }

  get xAdvanceCell(): Signal<number> {
    return this.#xAdvance;
  }

  get xAdvance(): number {
    return this.#xAdvance.peek();
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#sidebearings;
  }

  /**
   * Returns a lightweight dependency for any coordinate mutation.
   *
   * @returns A signal that invalidates when any contour, anchor, or component
   * coordinate changes, without packing a full glyph snapshot.
   */
  get coordinateBuffersChangedCell(): Signal<LayerCoordinateBuffers> {
    return this.#coordinateBuffersChanged;
  }

  get bounds(): BoundsType | null {
    return this.#coordinates.peek().bounds.peek();
  }

  get sidebearings(): GlyphSidebearings {
    return this.#sidebearings.peek();
  }

  get pointCount(): number {
    let count = 0;
    for (const contour of this.#structure.peek().contours) {
      count += contour.points.length;
    }
    return count;
  }

  get geometry(): GlyphGeometry {
    return this.#geometry.peek();
  }

  get geometryCell(): Signal<GlyphGeometry> {
    return this.#geometry;
  }

  get state(): GlyphState {
    return {
      layerId: this.#layerId,
      structure: this.#structure.peek(),
      values: this.#coordinates.peek().snapshot.peek(),
    };
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    return this.#coordinates.peek().positionsFor(targets);
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#coordinates.peek().contourIdOfPoint(this.#structure.peek(), pointId);
  }

  replace(state: GlyphState): void {
    batch(() => {
      this.#structure.set(state.structure);
      this.#coordinates.set(LayerCoordinateBuffers.fromState(state));
    });
  }

  replaceValues(values: Float64Array): void {
    this.#coordinates.set(
      LayerCoordinateBuffers.fromState({
        layerId: this.#layerId,
        structure: this.#structure.peek(),
        values,
      }),
    );
  }

  patchPositions(updates: GlyphPositions): void {
    this.#coordinates.peek().patchPositions(updates);
  }
}

/**
 * Reactive coordinate buffers for the packed authored-source layout.
 *
 * `snapshot` repacks the buffers into the bridge/geometry `Float64Array`
 * format, but only after one of the underlying buffers changes.
 */
export class LayerCoordinateBuffers {
  readonly xAdvance: WritableSignal<number>;

  readonly contours: readonly LayerContourCoordinates[];
  readonly anchors: WritableSignal<Float64Array>;
  readonly components: readonly SourceComponentTransform[];

  readonly snapshot: ComputedSignal<Float64Array>;
  readonly changedCell: ComputedSignal<LayerCoordinateBuffers>;

  readonly bounds: ComputedSignal<BoundsType | null>;
  readonly sidebearings: ComputedSignal<GlyphSidebearings>;

  readonly #lookup: SourceLookupIndex;

  private constructor(
    xAdvance: number,
    contours: readonly LayerContourCoordinates[],
    anchors: Float64Array,
    components: readonly SourceComponentTransform[],
    lookup: SourceLookupIndex,
  ) {
    this.xAdvance = signal(xAdvance, {
      name: "glyphLayer.coordinates.xAdvance",
    });
    this.contours = contours;
    this.anchors = signal(anchors, {
      equals: () => false,
      name: "glyphLayer.coordinates.anchors",
    });
    this.components = components;
    this.#lookup = lookup;
    this.snapshot = computed(
      () =>
        LayerCoordinateBuffers.#snapshot(
          this.xAdvance.value,
          this.contours.map((contour) => contour.values.value),
          this.anchors.value,
          this.components.map((component) => component.values.value),
        ),
      { name: "glyphLayer.coordinates.snapshot" },
    );
    this.changedCell = computed(
      () => {
        for (const contour of this.contours) contour.values.value;
        this.anchors.value;
        return this;
      },
      { name: "glyphLayer.coordinates.changed" },
    );
    this.bounds = computed(
      () => LayerCoordinateBuffers.#bounds(this.contours.map((contour) => contour.bounds.value)),
      { name: "glyphLayer.coordinates.bounds" },
    );
    this.sidebearings = computed(
      () => {
        const bounds = this.bounds.value;
        if (!bounds) return { lsb: null, rsb: null };
        return { lsb: bounds.min.x, rsb: this.xAdvance.value - bounds.max.x };
      },
      { name: "glyphLayer.coordinates.sidebearings" },
    );
  }

  static fromState(state: GlyphState): LayerCoordinateBuffers {
    let cursor = 0;
    const xAdvance = state.values[cursor++] ?? 0;
    const contours: LayerContourCoordinates[] = [];
    const lookup = SourceLookupIndex.fromStructure(state.structure);

    for (let contourIndex = 0; contourIndex < state.structure.contours.length; contourIndex++) {
      const contour = state.structure.contours[contourIndex];
      const length = contour.points.length * 2;
      const values = state.values.slice(cursor, cursor + length);
      contours.push(new LayerContourCoordinates(values, contourIndex));
      cursor += length;
    }

    const anchorStart = cursor;
    const anchorLength = state.structure.anchors.length * 2;
    const anchors = state.values.slice(anchorStart, anchorStart + anchorLength);
    cursor += anchorLength;

    const components = state.structure.components.map((_, componentIndex) => {
      const values = state.values.slice(cursor, cursor + 9);
      cursor += 9;
      return new SourceComponentTransform(values, componentIndex);
    });

    return new LayerCoordinateBuffers(xAdvance, contours, anchors, components, lookup);
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    const positions: GlyphPosition[] = [];

    for (const target of targets) {
      switch (target.kind) {
        case "point": {
          const location = this.#lookup.pointLocation(target.id);
          if (!location) break;

          const values = this.contours[location.contourIndex]?.values.peek();
          if (!values) break;

          positions.push({
            kind: "point",
            id: target.id,
            x: values[location.offset] ?? 0,
            y: values[location.offset + 1] ?? 0,
          });
          break;
        }
        case "anchor": {
          const offset = this.#lookup.anchorOffset(target.id);
          if (offset === null) break;

          const values = this.anchors.peek();
          positions.push({
            kind: "anchor",
            id: target.id,
            x: values[offset] ?? 0,
            y: values[offset + 1] ?? 0,
          });
          break;
        }
      }
    }

    return positions;
  }

  contourIdOfPoint(structure: GlyphStructure, pointId: PointId): ContourId | null {
    return this.#lookup.contourIdOfPoint(structure, pointId);
  }

  patchPositions(updates: GlyphPositions): void {
    const contourPatches = new Map<
      number,
      { readonly offset: number; readonly x: number; readonly y: number }[]
    >();
    let anchorsChanged = false;

    for (const update of updates) {
      if (update.kind === "point") {
        const location = this.#lookup.pointLocation(update.id);
        if (!location) continue;

        const patches = contourPatches.get(location.contourIndex) ?? [];
        patches.push({ offset: location.offset, x: update.x, y: update.y });
        contourPatches.set(location.contourIndex, patches);
        continue;
      }

      const offset = this.#lookup.anchorOffset(update.id);
      if (offset === null) continue;

      const anchorValues = this.anchors.peek();
      anchorValues[offset] = update.x;
      anchorValues[offset + 1] = update.y;
      anchorsChanged = true;
    }

    batch(() => {
      for (const [contourIndex, patches] of contourPatches) {
        this.contours[contourIndex]?.patch(patches);
      }

      if (anchorsChanged) {
        this.anchors.set(this.anchors.peek());
      }
    });
  }

  static #snapshot(
    xAdvance: number,
    contours: readonly Float64Array[],
    anchors: Float64Array,
    components: readonly Float64Array[],
  ): Float64Array {
    let length = 1 + anchors.length;
    for (const contourValues of contours) length += contourValues.length;
    for (const componentValues of components) length += componentValues.length;

    const values = new Float64Array(length);
    let cursor = 0;
    values[cursor++] = xAdvance;

    for (const contourValues of contours) {
      values.set(contourValues, cursor);
      cursor += contourValues.length;
    }

    values.set(anchors, cursor);
    cursor += anchors.length;

    for (const componentValues of components) {
      values.set(componentValues, cursor);
      cursor += componentValues.length;
    }

    return values;
  }

  static #bounds(contourBounds: readonly (BoundsType | null)[]): BoundsType | null {
    let result: BoundsType | null = null;
    for (const bounds of contourBounds) {
      if (!bounds) continue;
      result = result ? Bounds.union(result, bounds) : bounds;
    }
    return result;
  }
}

class SourceLookupIndex {
  readonly #pointLocations: ReadonlyMap<PointId, PointBufferLocation>;
  readonly #anchorOffsets: ReadonlyMap<AnchorId, number>;

  private constructor(
    pointLocations: ReadonlyMap<PointId, PointBufferLocation>,
    anchorOffsets: ReadonlyMap<AnchorId, number>,
  ) {
    this.#pointLocations = pointLocations;
    this.#anchorOffsets = anchorOffsets;
  }

  static fromStructure(structure: GlyphStructure): SourceLookupIndex {
    const pointLocations = new Map<PointId, PointBufferLocation>();
    const anchorOffsets = new Map<AnchorId, number>();

    for (let contourIndex = 0; contourIndex < structure.contours.length; contourIndex++) {
      const contour = structure.contours[contourIndex];
      for (let pointIndex = 0; pointIndex < contour.points.length; pointIndex++) {
        pointLocations.set(contour.points[pointIndex].id, {
          contourIndex,
          offset: pointIndex * 2,
        });
      }
    }

    for (let index = 0; index < structure.anchors.length; index++) {
      anchorOffsets.set(structure.anchors[index].id, index * 2);
    }

    return new SourceLookupIndex(pointLocations, anchorOffsets);
  }

  pointLocation(pointId: PointId): PointBufferLocation | null {
    return this.#pointLocations.get(pointId) ?? null;
  }

  anchorOffset(anchorId: AnchorId): number | null {
    return this.#anchorOffsets.get(anchorId) ?? null;
  }

  contourIdOfPoint(structure: GlyphStructure, pointId: PointId): ContourId | null {
    const location = this.pointLocation(pointId);
    if (!location) return null;
    return structure.contours[location.contourIndex]?.id ?? null;
  }
}

export class LayerContourCoordinates {
  readonly values: WritableSignal<Float64Array>;
  readonly bounds: ComputedSignal<BoundsType | null>;

  constructor(values: Float64Array, contourIndex: number) {
    this.values = signal(values, {
      equals: () => false,
      name: `glyphLayer.contour[${contourIndex}].coordinates`,
    });
    this.bounds = computed(() => LayerContourCoordinates.#bounds(this.values.value), {
      name: `glyphLayer.contour[${contourIndex}].bounds`,
    });
  }

  patch(
    patches: readonly {
      readonly offset: number;
      readonly x: number;
      readonly y: number;
    }[],
  ): void {
    if (patches.length === 0) return;

    const values = this.values.peek();
    for (const patch of patches) {
      values[patch.offset] = patch.x;
      values[patch.offset + 1] = patch.y;
    }

    this.values.set(values);
  }

  static #bounds(values: Float64Array): BoundsType | null {
    if (values.length < 2) return null;

    let minX = values[0] ?? 0;
    let minY = values[1] ?? 0;
    let maxX = minX;
    let maxY = minY;

    for (let offset = 2; offset < values.length; offset += 2) {
      const x = values[offset] ?? 0;
      const y = values[offset + 1] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  }
}

export class SourceComponentTransform {
  readonly values: WritableSignal<Float64Array>;
  readonly matrix: ComputedSignal<MatModel>;

  constructor(values: Float64Array, componentIndex: number) {
    this.values = signal(values, {
      name: `glyphLayer.component[${componentIndex}].transformValues`,
    });
    this.matrix = computed(
      () =>
        Mat.fromDecomposed({
          translateX: this.values.value[0] ?? 0,
          translateY: this.values.value[1] ?? 0,
          rotation: this.values.value[2] ?? 0,
          scaleX: this.values.value[3] ?? 1,
          scaleY: this.values.value[4] ?? 1,
          skewX: this.values.value[5] ?? 0,
          skewY: this.values.value[6] ?? 0,
          tCenterX: this.values.value[7] ?? 0,
          tCenterY: this.values.value[8] ?? 0,
        }),
      { name: `glyphLayer.component[${componentIndex}].matrix` },
    );
  }
}
