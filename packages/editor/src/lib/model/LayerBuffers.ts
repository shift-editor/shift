import {
  Bounds,
  Mat,
  type Bounds as BoundsType,
  type DecomposedTransform,
  type MatModel,
} from "@shift/geo";
import type {
  AnchorId,
  AnchorSeed,
  ComponentId,
  ContourId,
  GlyphState,
  GlyphStructure,
  PointId,
  PointSeed,
} from "@shift/types";
import type {
  GlyphPosition,
  GlyphPositionTarget,
  GlyphPositions,
  GlyphSidebearings,
} from "@shift/glyph-state";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type WritableSignal,
} from "../signals/signal";
import { AnchorBuffer } from "./AnchorBuffer";
import { ComponentBuffer } from "./ComponentBuffer";
import { ContourBuffer } from "./ContourBuffer";

/**
 * Renderer-owned logical records backed by fixed-width packed arrays.
 *
 * `GlyphStructure + Float64Array` is a bridge format, not an editing API.
 * Structural operations live here so the object that knows each packed layout
 * also owns the metadata that interprets it. Wire structure and values are
 * derived lazily from these records.
 */
/** A fresh value after every change to a layer's packed values. Its contents are not meaningful. */
export type LayerChangeToken = readonly unknown[];

export class LayerBuffers {
  readonly xAdvanceCell: WritableSignal<number>;
  readonly contoursCell: WritableSignal<readonly ContourBuffer[]>;
  readonly anchors: AnchorBuffer;
  readonly components: readonly ComponentBuffer[];

  // non-reactive: routes imperative point edits; render readers track contour/structure cells.
  readonly #pointContours = new Map<PointId, ContourBuffer>();

  readonly structureCell: ComputedSignal<GlyphStructure>;
  readonly snapshotCell: ComputedSignal<Float64Array>;
  /** Changes identity whenever any packed value changes; compare it by identity only. */
  readonly changedCell: ComputedSignal<LayerChangeToken>;
  readonly boundsCell: ComputedSignal<BoundsType | null>;
  readonly sidebearingsCell: ComputedSignal<GlyphSidebearings>;

  private constructor(
    structure: GlyphStructure,
    xAdvance: number,
    contours: readonly ContourBuffer[],
    anchors: AnchorBuffer,
    components: readonly ComponentBuffer[],
  ) {
    this.xAdvanceCell = signal(xAdvance, {
      name: "glyphLayer.buffers.xAdvance",
    });
    this.contoursCell = signal(contours, {
      name: "glyphLayer.buffers.contours",
    });
    this.anchors = anchors;
    this.components = components;

    for (const contour of contours) {
      for (const point of contour.data.points) this.#pointContours.set(point.id, contour);
    }

    let initialStructure: GlyphStructure | null = structure;
    this.structureCell = computed(
      () => {
        const contours = this.contoursCell.value.map((contour) => contour.dataCell.value);
        const anchors = this.anchors.dataCell.value;
        const components = this.components.map((component) => component.data);
        if (initialStructure) {
          const initial = initialStructure;
          initialStructure = null;
          return initial;
        }
        return { contours, anchors: [...anchors], components };
      },
      { name: "glyphLayer.buffers.structure" },
    );
    this.structureCell.peek();
    this.snapshotCell = computed(
      () =>
        LayerBuffers.#snapshot(
          this.xAdvanceCell.value,
          this.contoursCell.value.map((contour) => contour.valuesCell.value),
          this.anchors.valuesCell.value,
          this.components.map((component) => component.valuesCell.value),
        ),
      { name: "glyphLayer.buffers.snapshot" },
    );
    this.changedCell = computed(
      () => [
        this.xAdvanceCell.value,
        ...this.contoursCell.value.map((contour) => contour.valuesCell.value),
        this.anchors.valuesCell.value,
        ...this.components.map((component) => component.valuesCell.value),
      ],
      { name: "glyphLayer.buffers.changed" },
    );
    this.boundsCell = computed(
      () =>
        LayerBuffers.#bounds(this.contoursCell.value.map((contour) => contour.boundsCell.value)),
      { name: "glyphLayer.buffers.bounds", equals: Bounds.equals },
    );
    this.sidebearingsCell = computed(
      () => {
        const bounds = this.boundsCell.value;
        if (!bounds) return { lsb: null, rsb: null };
        return { lsb: bounds.min.x, rsb: this.xAdvanceCell.value - bounds.max.x };
      },
      {
        name: "glyphLayer.buffers.sidebearings",
        equals: (prev, next) => prev.lsb === next.lsb && prev.rsb === next.rsb,
      },
    );
  }

  static fromState(state: GlyphState): LayerBuffers {
    let cursor = 0;
    const xAdvance = state.values[cursor++] ?? 0;
    const contours = state.structure.contours.map((data, contourIndex) => {
      const length = data.points.length * 2;
      const values = state.values.subarray(cursor, cursor + length);
      cursor += length;
      return new ContourBuffer(data, values, contourIndex);
    });

    const anchorLength = state.structure.anchors.length * 2;
    const anchors = new AnchorBuffer(
      state.structure.anchors,
      state.values.subarray(cursor, cursor + anchorLength),
    );
    cursor += anchorLength;

    const components = state.structure.components.map((data, componentIndex) => {
      const values = state.values.subarray(cursor, cursor + 9);
      cursor += 9;
      return new ComponentBuffer(data, values, componentIndex);
    });

    return new LayerBuffers(state.structure, xAdvance, contours, anchors, components);
  }

  get xAdvance(): number {
    return this.xAdvanceCell.peek();
  }

  get contours(): readonly ContourBuffer[] {
    return this.contoursCell.peek();
  }

  get structure(): GlyphStructure {
    return this.structureCell.peek();
  }

  get snapshot(): Float64Array {
    return this.snapshotCell.peek();
  }

  get bounds(): BoundsType | null {
    return this.boundsCell.peek();
  }

  get sidebearings(): GlyphSidebearings {
    return this.sidebearingsCell.peek();
  }

  contour(contourId: ContourId): ContourBuffer | null {
    return this.contoursCell.peek().find((contour) => contour.data.id === contourId) ?? null;
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#contourForPoint(pointId)?.data.id ?? null;
  }

  /** Every contour point's and anchor's current position. */
  get positions(): GlyphPosition[] {
    return [...this.contours.flatMap((contour) => contour.positions), ...this.anchors.positions];
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    const positions: GlyphPosition[] = [];
    for (const target of targets) {
      switch (target.kind) {
        case "point": {
          const position = this.#contourForPoint(target.id)?.position(target.id);
          if (position) positions.push(position);
          break;
        }
        case "anchor": {
          const position = this.anchors.position(target.id);
          if (position) positions.push(position);
          break;
        }
      }
    }
    return positions;
  }

  componentTransform(componentId: ComponentId): DecomposedTransform | null {
    return (
      this.components.find((component) => component.data.id === componentId)?.transform ?? null
    );
  }

  setComponentTransforms(
    componentIds: readonly ComponentId[],
    transforms: readonly DecomposedTransform[],
  ): boolean {
    if (componentIds.length !== transforms.length) return false;

    const components = componentIds.map((componentId) =>
      this.components.find((component) => component.data.id === componentId),
    );
    if (components.some((component) => component === undefined)) return false;

    batch(() => {
      for (let index = 0; index < components.length; index++) {
        const component = components[index];
        const transform = transforms[index];
        if (component && transform) component.setTransform(transform);
      }
    });
    return true;
  }

  addContour(contourId: ContourId, closed: boolean): boolean {
    if (this.contour(contourId)) return false;

    const contours = this.contoursCell.peek();
    this.contoursCell.set([
      ...contours,
      new ContourBuffer({ id: contourId, points: [], closed }, new Float64Array(), contours.length),
    ]);
    return true;
  }

  addPoints(points: readonly PointSeed[], contourId?: ContourId, before?: PointId): boolean {
    const pointIds = new Set(points.map((point) => point.id));
    if (pointIds.size !== points.length) return false;
    if ([...pointIds].some((pointId) => this.#contourForPoint(pointId))) return false;

    const contour = this.#insertionContour(contourId, before);
    if (!contour) return false;

    return batch(() => {
      if (!contour.insertPoints(points, before)) return false;

      for (const point of points) this.#pointContours.set(point.id, contour);

      return true;
    });
  }

  #insertionContour(contourId?: ContourId, before?: PointId) {
    if (contourId) return this.contour(contourId);
    if (before) return this.#contourForPoint(before);
    return null;
  }

  setContourClosed(contourId: ContourId, closed: boolean): boolean {
    const contour = this.contour(contourId);
    if (!contour) return false;

    contour.setClosed(closed);
    return true;
  }

  movePoints(pointIds: readonly PointId[], coords: readonly number[]): boolean {
    if (coords.length !== pointIds.length * 2) return false;

    const updates: GlyphPosition[] = pointIds.map((id, index) => ({
      kind: "point",
      id,
      x: coords[index * 2] ?? 0,
      y: coords[index * 2 + 1] ?? 0,
    }));
    if (this.positionsFor(updates).length !== updates.length) return false;

    this.patchPositions(updates);
    return true;
  }

  setPointSmooth(pointId: PointId, smooth: boolean): boolean {
    return this.#contourForPoint(pointId)?.setPointSmooth(pointId, smooth) ?? false;
  }

  removePoints(pointIds: readonly PointId[]): boolean {
    const removed = new Set(pointIds);
    if (removed.size !== pointIds.length) return false;

    const contours = new Map<ContourBuffer, Set<PointId>>();
    for (const pointId of removed) {
      const contour = this.#contourForPoint(pointId);
      if (!contour) return false;

      const contourPoints = contours.get(contour) ?? new Set<PointId>();
      contourPoints.add(pointId);
      contours.set(contour, contourPoints);
    }

    batch(() => {
      for (const [contour, ids] of contours) contour.removePoints(ids);
      for (const pointId of removed) this.#pointContours.delete(pointId);

      const emptyContours = new Set(
        [...contours.keys()].filter((contour) => contour.pointCount === 0),
      );
      if (emptyContours.size > 0) {
        this.contoursCell.set(this.contours.filter((contour) => !emptyContours.has(contour)));
      }
    });
    return true;
  }

  reverseContour(contourId: ContourId): boolean {
    const contour = this.contour(contourId);
    if (!contour) return false;

    contour.reverse();
    return true;
  }

  setContourStart(contourId: ContourId, pointId: PointId): boolean {
    return this.contour(contourId)?.setContourStart(pointId) ?? false;
  }

  /**
   * Maps every contour point and anchor through `matrix` and composes it onto each component.
   *
   * @remarks
   * Mirrors Rust's `GlyphLayer::transform_layer`, so a local preview matches
   * the authoritative result. The advance width is unchanged.
   */
  transformLayer(matrix: MatModel): boolean {
    this.patchPositions(
      this.positions.map((position) => ({ ...position, ...Mat.applyToPoint(matrix, position) })),
    );

    return this.setComponentTransforms(
      this.components.map((component) => component.data.id),
      this.components.map(({ transform }) => composeOnto(transform, matrix)),
    );
  }

  setXAdvance(width: number): boolean {
    this.xAdvanceCell.set(width);
    return true;
  }

  addAnchors(anchors: readonly AnchorSeed[]): boolean {
    const anchorIds = new Set(anchors.map((anchor) => anchor.id));
    if (anchorIds.size !== anchors.length) return false;
    if (this.anchors.data.some((anchor) => anchorIds.has(anchor.id))) return false;

    this.anchors.add(anchors);
    return true;
  }

  moveAnchors(anchorIds: readonly AnchorId[], coords: readonly number[]): boolean {
    if (coords.length !== anchorIds.length * 2) return false;

    const updates: GlyphPosition[] = anchorIds.map((id, index) => ({
      kind: "anchor",
      id,
      x: coords[index * 2] ?? 0,
      y: coords[index * 2 + 1] ?? 0,
    }));
    if (this.positionsFor(updates).length !== updates.length) return false;

    this.patchPositions(updates);
    return true;
  }

  removeAnchors(anchorIds: readonly AnchorId[]): boolean {
    const removed = new Set(anchorIds);
    if (removed.size !== anchorIds.length) return false;
    if (this.anchors.data.filter((anchor) => removed.has(anchor.id)).length !== removed.size) {
      return false;
    }

    this.anchors.remove(removed);
    return true;
  }

  patchPositions(updates: GlyphPositions): void {
    const contourUpdates = new Map<ContourBuffer, GlyphPosition[]>();
    const anchorUpdates: GlyphPosition[] = [];
    for (const update of updates) {
      if (update.kind === "anchor") {
        anchorUpdates.push(update);
        continue;
      }

      const contour = this.#contourForPoint(update.id);
      if (!contour) continue;

      const positions = contourUpdates.get(contour) ?? [];
      positions.push(update);
      contourUpdates.set(contour, positions);
    }

    batch(() => {
      for (const [contour, positions] of contourUpdates) contour.patchPositions(positions);
      this.anchors.patchPositions(anchorUpdates);
    });
  }

  replaceValues(values: Float64Array): void {
    let cursor = 0;
    const xAdvance = values[cursor++] ?? 0;
    const contours = this.contours.map((contour) => {
      const length = contour.pointCount * 2;
      const replacement = values.slice(cursor, cursor + length);
      cursor += length;
      return replacement;
    });
    const anchorLength = this.anchors.data.length * 2;
    const anchors = values.slice(cursor, cursor + anchorLength);
    cursor += anchorLength;
    const components = this.components.map(() => {
      const replacement = values.slice(cursor, cursor + 9);
      cursor += 9;
      return replacement;
    });

    batch(() => {
      this.xAdvanceCell.set(xAdvance);
      for (let index = 0; index < contours.length; index++) {
        this.contours[index]?.replaceValues(contours[index]);
      }
      this.anchors.replaceValues(anchors);
      for (let index = 0; index < components.length; index++) {
        this.components[index]?.replaceValues(components[index]);
      }
    });
  }

  #contourForPoint(pointId: PointId): ContourBuffer | null {
    return this.#pointContours.get(pointId) ?? null;
  }

  static #snapshot(
    xAdvance: number,
    contours: readonly Float64Array[],
    anchors: Float64Array,
    components: readonly Float64Array[],
  ): Float64Array {
    let length = 1 + anchors.length;
    for (const contour of contours) length += contour.length;
    for (const component of components) length += component.length;

    const values = new Float64Array(length);
    let cursor = 0;
    values[cursor++] = xAdvance;
    for (const contour of contours) {
      values.set(contour, cursor);
      cursor += contour.length;
    }
    values.set(anchors, cursor);
    cursor += anchors.length;
    for (const component of components) {
      values.set(component, cursor);
      cursor += component.length;
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

/**
 * A component placement after `matrix`, matching Rust's `GlyphLayer::transform_layer`.
 *
 * @remarks
 * A pure translation is added to the placement's translation so its other
 * decomposed values stay exact; anything else composes and re-decomposes.
 */
function composeOnto(transform: DecomposedTransform, matrix: MatModel): DecomposedTransform {
  const translationOnly = matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1;
  if (!translationOnly) return Mat.toDecomposed(Mat.Compose(matrix, Mat.fromDecomposed(transform)));

  return {
    ...transform,
    translateX: transform.translateX + matrix.e,
    translateY: transform.translateY + matrix.f,
  };
}
