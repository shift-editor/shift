import type {
  AnchorData,
  AnchorId,
  AnchorSeed,
  ContourData,
  ContourId,
  GlyphState,
  GlyphStructure,
  LayerId,
  LayerReplaced,
  PointData,
  PointId,
  PointSeed,
} from "@shift/types";
import { Bounds, Mat, type Bounds as BoundsType, type MatModel } from "@shift/geo";
import {
  GlyphGeometry,
  type GlyphPosition,
  type GlyphPositionTarget,
  type GlyphPositions,
  type GlyphSidebearings,
} from "@shift/glyph-state";
import type { PendingEditId } from "@/types";
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
  readonly #buffers: WritableSignal<LayerBuffers>;
  readonly #xAdvance: ComputedSignal<number>;
  readonly #sidebearings: ComputedSignal<GlyphSidebearings>;
  readonly #buffersChanged: ComputedSignal<LayerBuffers>;
  readonly #geometry: ComputedSignal<GlyphGeometry>;

  #confirmedState: GlyphState | null = null;
  readonly #pendingStates = new Map<PendingEditId, GlyphState>();

  constructor(state: GlyphState) {
    this.#layerId = state.layerId;
    this.#structure = signal(state.structure, {
      name: "glyphLayer.structure",
    });
    this.#buffers = signal(LayerBuffers.fromState(state), {
      name: "glyphLayer.buffers",
    });
    this.#xAdvance = computed(() => this.#buffers.value.xAdvance.value, {
      name: "glyphLayer.xAdvance",
    });
    this.#sidebearings = computed(() => this.#buffers.value.sidebearings.value, {
      name: "glyphLayer.sidebearings",
    });
    this.#buffersChanged = computed(
      () => {
        const buffers = this.#buffers.value;
        buffers.changedCell.value;
        return buffers;
      },
      { name: "glyphLayer.buffers.changed" },
    );
    this.#geometry = computed(
      () => new GlyphGeometry(this.#structure.value, this.#buffers.value.snapshot.value),
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

  get buffers(): LayerBuffers {
    return this.#buffers.peek();
  }

  get buffersCell(): Signal<LayerBuffers> {
    return this.#buffers;
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

  /** Invalidates on numeric buffer changes without packing a full glyph snapshot. */
  get buffersChangedCell(): Signal<LayerBuffers> {
    return this.#buffersChanged;
  }

  get bounds(): BoundsType | null {
    return this.#buffers.peek().bounds.peek();
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
      values: this.#buffers.peek().snapshot.peek(),
    };
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    return this.#buffers.peek().positionsFor(targets);
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#buffers.peek().contourIdOfPoint(this.#structure.peek(), pointId);
  }

  addContour(editId: PendingEditId, contourId: ContourId, closed: boolean): boolean {
    const structure = this.#structure.peek();
    if (structure.contours.some((contour) => contour.id === contourId)) return false;

    const contours = [...structure.contours, { id: contourId, points: [], closed }];
    const contourValues = [
      ...this.#buffers.peek().contours.map((contour) => contour.values.peek()),
      new Float64Array(),
    ];

    this.#beginPendingEdit(editId);
    this.#replaceStructure(
      { ...structure, contours },
      contourValues,
      this.#buffers.peek().anchors.peek(),
    );
    return true;
  }

  addPoints(
    editId: PendingEditId,
    points: readonly PointSeed[],
    contourId?: ContourId,
    before?: PointId,
  ): boolean {
    const pointIds = new Set(points.map((point) => point.id));
    if (pointIds.size !== points.length) return false;

    const structure = this.#structure.peek();
    if (
      structure.contours.some((contour) => contour.points.some((point) => pointIds.has(point.id)))
    ) {
      return false;
    }

    let contourIndex = contourId
      ? structure.contours.findIndex((contour) => contour.id === contourId)
      : -1;
    if (contourIndex < 0 && !contourId && before) {
      contourIndex = structure.contours.findIndex((contour) =>
        contour.points.some((point) => point.id === before),
      );
    }
    if (contourIndex < 0) return false;

    const contour = structure.contours[contourIndex];
    const pointIndex = before
      ? contour.points.findIndex((point) => point.id === before)
      : contour.points.length;
    if (pointIndex < 0) return false;

    const nextContour: ContourData = {
      ...contour,
      points: [
        ...contour.points.slice(0, pointIndex),
        ...points.map((point) => ({
          id: point.id,
          pointType: point.pointType,
          smooth: point.smooth,
        })),
        ...contour.points.slice(pointIndex),
      ],
    };
    const contours = [...structure.contours];
    contours[contourIndex] = nextContour;

    const buffers = this.#buffers.peek();
    const contourValues = buffers.contours.map((candidate) => candidate.values.peek());
    contourValues[contourIndex] = spliceFloat64Array(
      contourValues[contourIndex],
      pointIndex * 2,
      0,
      points.flatMap((point) => [point.x, point.y]),
    );

    this.#beginPendingEdit(editId);
    this.#replaceStructure({ ...structure, contours }, contourValues, buffers.anchors.peek());
    return true;
  }

  setContourClosed(editId: PendingEditId, contourId: ContourId, closed: boolean): boolean {
    const structure = this.#structure.peek();
    const contourIndex = structure.contours.findIndex((contour) => contour.id === contourId);
    if (contourIndex < 0) return false;

    const contours = [...structure.contours];
    contours[contourIndex] = { ...contours[contourIndex], closed };

    this.#beginPendingEdit(editId);
    this.#structure.set({ ...structure, contours });
    return true;
  }

  movePoints(
    editId: PendingEditId,
    pointIds: readonly PointId[],
    coords: readonly number[],
  ): boolean {
    if (coords.length !== pointIds.length * 2) return false;

    const updates: GlyphPosition[] = pointIds.map((id, index) => ({
      kind: "point",
      id,
      x: coords[index * 2] ?? 0,
      y: coords[index * 2 + 1] ?? 0,
    }));
    if (this.positionsFor(updates).length !== updates.length) return false;

    this.#beginPendingEdit(editId);
    this.#buffers.peek().patchPositions(updates);
    return true;
  }

  setPointSmooth(editId: PendingEditId, pointId: PointId, smooth: boolean): boolean {
    const structure = this.#structure.peek();
    const contourIndex = structure.contours.findIndex((contour) =>
      contour.points.some((point) => point.id === pointId),
    );
    if (contourIndex < 0) return false;

    const contour = structure.contours[contourIndex];
    const pointIndex = contour.points.findIndex((point) => point.id === pointId);
    const points = [...contour.points];
    points[pointIndex] = { ...points[pointIndex], smooth };
    const contours = [...structure.contours];
    contours[contourIndex] = { ...contour, points };

    this.#beginPendingEdit(editId);
    this.#structure.set({ ...structure, contours });
    return true;
  }

  removePoints(editId: PendingEditId, pointIds: readonly PointId[]): boolean {
    const removed = new Set(pointIds);
    if (removed.size !== pointIds.length) return false;

    const structure = this.#structure.peek();
    const buffers = this.#buffers.peek();
    let found = 0;
    const contours: ContourData[] = [];
    const contourValues: Float64Array[] = [];

    for (let contourIndex = 0; contourIndex < structure.contours.length; contourIndex++) {
      const contour = structure.contours[contourIndex];
      const values = buffers.contours[contourIndex]?.values.peek();
      if (!values) return false;

      const points: PointData[] = [];
      const retainedValues: number[] = [];
      for (let pointIndex = 0; pointIndex < contour.points.length; pointIndex++) {
        const point = contour.points[pointIndex];
        if (removed.has(point.id)) {
          found += 1;
          continue;
        }

        points.push(point);
        retainedValues.push(values[pointIndex * 2] ?? 0, values[pointIndex * 2 + 1] ?? 0);
      }

      contours.push(points.length === contour.points.length ? contour : { ...contour, points });
      contourValues.push(
        points.length === contour.points.length ? values : new Float64Array(retainedValues),
      );
    }
    if (found !== removed.size) return false;

    this.#beginPendingEdit(editId);
    this.#replaceStructure({ ...structure, contours }, contourValues, buffers.anchors.peek());
    return true;
  }

  reverseContour(editId: PendingEditId, contourId: ContourId): boolean {
    const structure = this.#structure.peek();
    const contourIndex = structure.contours.findIndex((contour) => contour.id === contourId);
    if (contourIndex < 0) return false;

    const contour = structure.contours[contourIndex];
    const contours = [...structure.contours];
    contours[contourIndex] = { ...contour, points: [...contour.points].reverse() };

    const buffers = this.#buffers.peek();
    const contourValues = buffers.contours.map((candidate) => candidate.values.peek());
    const values = contourValues[contourIndex];
    const reversed = new Float64Array(values.length);
    for (let pointIndex = 0; pointIndex < contour.points.length; pointIndex++) {
      const source = (contour.points.length - pointIndex - 1) * 2;
      reversed[pointIndex * 2] = values[source] ?? 0;
      reversed[pointIndex * 2 + 1] = values[source + 1] ?? 0;
    }
    contourValues[contourIndex] = reversed;

    this.#beginPendingEdit(editId);
    this.#replaceStructure({ ...structure, contours }, contourValues, buffers.anchors.peek());
    return true;
  }

  translatePoints(
    editId: PendingEditId,
    pointIds: readonly PointId[],
    dx: number,
    dy: number,
  ): boolean {
    const ids = [...new Set(pointIds)];
    const positions = this.positionsFor(ids.map((id) => ({ kind: "point", id })));
    if (positions.length !== ids.length) return false;

    this.#beginPendingEdit(editId);
    this.#buffers
      .peek()
      .patchPositions(
        positions.map((position) => ({ ...position, x: position.x + dx, y: position.y + dy })),
      );
    return true;
  }

  setXAdvance(editId: PendingEditId, width: number): void {
    this.#beginPendingEdit(editId);
    this.#buffers.peek().xAdvance.set(width);
  }

  addAnchors(editId: PendingEditId, anchors: readonly AnchorSeed[]): boolean {
    const anchorIds = new Set(anchors.map((anchor) => anchor.id));
    if (anchorIds.size !== anchors.length) return false;

    const structure = this.#structure.peek();
    if (structure.anchors.some((anchor) => anchorIds.has(anchor.id))) return false;

    const nextAnchors: AnchorData[] = [
      ...structure.anchors,
      ...anchors.map((anchor) => ({
        id: anchor.id,
        ...(anchor.name === undefined ? {} : { name: anchor.name }),
      })),
    ];
    const buffers = this.#buffers.peek();
    const anchorValues = spliceFloat64Array(
      buffers.anchors.peek(),
      buffers.anchors.peek().length,
      0,
      anchors.flatMap((anchor) => [anchor.x, anchor.y]),
    );

    this.#beginPendingEdit(editId);
    this.#replaceStructure({ ...structure, anchors: nextAnchors }, undefined, anchorValues);
    return true;
  }

  moveAnchors(
    editId: PendingEditId,
    anchorIds: readonly AnchorId[],
    coords: readonly number[],
  ): boolean {
    if (coords.length !== anchorIds.length * 2) return false;

    const updates: GlyphPosition[] = anchorIds.map((id, index) => ({
      kind: "anchor",
      id,
      x: coords[index * 2] ?? 0,
      y: coords[index * 2 + 1] ?? 0,
    }));
    if (this.positionsFor(updates).length !== updates.length) return false;

    this.#beginPendingEdit(editId);
    this.#buffers.peek().patchPositions(updates);
    return true;
  }

  removeAnchors(editId: PendingEditId, anchorIds: readonly AnchorId[]): boolean {
    const removed = new Set(anchorIds);
    if (removed.size !== anchorIds.length) return false;

    const structure = this.#structure.peek();
    const buffers = this.#buffers.peek();
    const anchors: AnchorData[] = [];
    const values: number[] = [];
    for (let index = 0; index < structure.anchors.length; index++) {
      const anchor = structure.anchors[index];
      if (removed.has(anchor.id)) continue;

      anchors.push(anchor);
      values.push(
        buffers.anchors.peek()[index * 2] ?? 0,
        buffers.anchors.peek()[index * 2 + 1] ?? 0,
      );
    }
    if (anchors.length !== structure.anchors.length - removed.size) return false;

    this.#beginPendingEdit(editId);
    this.#replaceStructure({ ...structure, anchors }, undefined, new Float64Array(values));
    return true;
  }

  replace(state: GlyphState): void {
    this.#confirmedState = null;
    this.#pendingStates.clear();
    this.#publish(state);
  }

  replaceValues(values: Float64Array): void {
    this.replace({
      layerId: this.#layerId,
      structure: this.#structure.peek(),
      values,
    });
  }

  rollbackEdit(editId: PendingEditId): void {
    const state = this.#pendingStates.get(editId);
    if (!state) return;

    this.#pendingStates.delete(editId);
    this.#publish(state);
    if (this.#pendingStates.size === 0) {
      this.#confirmedState = null;
    }
  }

  foldWorkspaceState(editId: PendingEditId | null, replacement: LayerReplaced): void {
    const confirmed = this.#confirmedState ?? this.state;
    const state = {
      layerId: this.#layerId,
      structure: replacement.structure ?? confirmed.structure,
      values: replacement.values,
    };
    this.#confirmedState = state;

    if (editId !== null) {
      this.#pendingStates.delete(editId);
    }
    if (this.#pendingStates.size > 0) return;

    this.#confirmedState = null;
    this.#publish(state);
  }

  patchPositions(updates: GlyphPositions): void {
    this.#buffers.peek().patchPositions(updates);
  }

  #beginPendingEdit(editId: PendingEditId): void {
    if (this.#pendingStates.has(editId)) return;

    const state = this.state;
    if (this.#pendingStates.size === 0) {
      this.#confirmedState = state;
    }
    this.#pendingStates.set(editId, state);
  }

  #replaceStructure(
    structure: GlyphStructure,
    contourValues: readonly Float64Array[] | undefined,
    anchorValues: Float64Array,
  ): void {
    const buffers = this.#buffers.peek();
    const contours = contourValues ?? buffers.contours.map((contour) => contour.values.peek());
    const components = buffers.components.map((component) => component.values.peek());

    batch(() => {
      this.#structure.set(structure);
      this.#buffers.set(
        new LayerBuffers(structure, buffers.xAdvance.peek(), contours, anchorValues, components),
      );
    });
  }

  #publish(state: GlyphState): void {
    if (this.#structure.peek() === state.structure) {
      this.#buffers.peek().replaceValues(state.values);
      return;
    }

    batch(() => {
      this.#structure.set(state.structure);
      this.#buffers.set(LayerBuffers.fromState(state));
    });
  }
}

/**
 * Reactive numeric buffers for one authored layer.
 *
 * `snapshot` repacks advance, contour, anchor, and component values into the
 * bridge/geometry `Float64Array` format only after an underlying buffer changes.
 */
export class LayerBuffers {
  readonly xAdvance: WritableSignal<number>;

  readonly contours: readonly LayerContourCoordinates[];
  readonly anchors: WritableSignal<Float64Array>;
  readonly components: readonly SourceComponentTransform[];

  readonly snapshot: ComputedSignal<Float64Array>;
  readonly changedCell: ComputedSignal<LayerBuffers>;

  readonly bounds: ComputedSignal<BoundsType | null>;
  readonly sidebearings: ComputedSignal<GlyphSidebearings>;

  readonly #lookup: SourceLookupIndex;

  constructor(
    structure: GlyphStructure,
    xAdvance: number,
    contours: readonly Float64Array[],
    anchors: Float64Array,
    components: readonly Float64Array[],
  ) {
    this.xAdvance = signal(xAdvance, {
      name: "glyphLayer.buffers.xAdvance",
    });
    this.contours = contours.map(
      (values, contourIndex) => new LayerContourCoordinates(values, contourIndex),
    );
    this.anchors = signal(anchors, {
      equals: () => false,
      name: "glyphLayer.buffers.anchors",
    });
    this.components = components.map(
      (values, componentIndex) => new SourceComponentTransform(values, componentIndex),
    );
    this.#lookup = SourceLookupIndex.fromStructure(structure);
    this.snapshot = computed(
      () =>
        LayerBuffers.#snapshot(
          this.xAdvance.value,
          this.contours.map((contour) => contour.values.value),
          this.anchors.value,
          this.components.map((component) => component.values.value),
        ),
      { name: "glyphLayer.buffers.snapshot" },
    );
    this.changedCell = computed(
      () => {
        this.xAdvance.value;
        for (const contour of this.contours) contour.values.value;
        this.anchors.value;
        for (const component of this.components) component.values.value;
        return this;
      },
      { name: "glyphLayer.buffers.changed" },
    );
    this.bounds = computed(
      () => LayerBuffers.#bounds(this.contours.map((contour) => contour.bounds.value)),
      { name: "glyphLayer.buffers.bounds" },
    );
    this.sidebearings = computed(
      () => {
        const bounds = this.bounds.value;
        if (!bounds) return { lsb: null, rsb: null };
        return { lsb: bounds.min.x, rsb: this.xAdvance.value - bounds.max.x };
      },
      { name: "glyphLayer.buffers.sidebearings" },
    );
  }

  static fromState(state: GlyphState): LayerBuffers {
    let cursor = 0;
    const xAdvance = state.values[cursor++] ?? 0;
    const contours: Float64Array[] = [];

    for (let contourIndex = 0; contourIndex < state.structure.contours.length; contourIndex++) {
      const contour = state.structure.contours[contourIndex];
      const length = contour.points.length * 2;
      const values = state.values.slice(cursor, cursor + length);
      contours.push(values);
      cursor += length;
    }

    const anchorStart = cursor;
    const anchorLength = state.structure.anchors.length * 2;
    const anchors = state.values.slice(anchorStart, anchorStart + anchorLength);
    cursor += anchorLength;

    const components = state.structure.components.map(() => {
      const values = state.values.slice(cursor, cursor + 9);
      cursor += 9;
      return values;
    });

    return new LayerBuffers(state.structure, xAdvance, contours, anchors, components);
  }

  /** Publishes only packed ranges whose numeric values changed. */
  replaceValues(values: Float64Array): void {
    let cursor = 0;
    const xAdvance = values[cursor++] ?? 0;
    const contours = this.contours.map((contour) => {
      const length = contour.values.peek().length;
      const replacement = values.slice(cursor, cursor + length);
      cursor += length;
      return replacement;
    });
    const anchors = values.slice(cursor, cursor + this.anchors.peek().length);
    cursor += anchors.length;
    const components = this.components.map((component) => {
      const length = component.values.peek().length;
      const replacement = values.slice(cursor, cursor + length);
      cursor += length;
      return replacement;
    });

    batch(() => {
      this.xAdvance.set(xAdvance);
      for (let index = 0; index < contours.length; index++) {
        const replacement = contours[index];
        const contour = this.contours[index];
        if (!contour || LayerBuffers.sameValues(contour.values.peek(), replacement)) {
          continue;
        }
        contour.values.set(replacement);
      }
      if (!LayerBuffers.sameValues(this.anchors.peek(), anchors)) {
        this.anchors.set(anchors);
      }
      for (let index = 0; index < components.length; index++) {
        const replacement = components[index];
        const component = this.components[index];
        if (!component || LayerBuffers.sameValues(component.values.peek(), replacement)) {
          continue;
        }
        component.values.set(replacement);
      }
    });
  }

  static sameValues(left: Float64Array, right: Float64Array): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) return false;
    }
    return true;
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

function spliceFloat64Array(
  values: Float64Array,
  start: number,
  deleteCount: number,
  additions: readonly number[],
): Float64Array {
  const result = new Float64Array(values.length - deleteCount + additions.length);
  result.set(values.subarray(0, start));
  result.set(additions, start);
  result.set(values.subarray(start + deleteCount), start + additions.length);
  return result;
}
