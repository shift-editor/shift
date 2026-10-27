import { EntityMap } from "@shift/types";
import { Bounds, type Bounds as BoundsType, type DecomposedTransform } from "@shift/geo";
import type {
  ComponentId,
  ContourData,
  ContourId,
  GlyphState,
  GlyphStructure,
  PointId,
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
  readonly #pointContours = new EntityMap<PointId, ContourBuffer>("point contour");

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

  /**
   * Buffers for `state`, reusing each contour buffer of `previous` whose
   * contour data is the same object in `state`: a structural edit to one
   * contour of a large glyph rebuilds that contour, not the glyph.
   */
  static fromState(state: GlyphState, previous?: LayerBuffers): LayerBuffers {
    const reusable = new Map<ContourData, ContourBuffer>();
    for (const contour of previous?.contours ?? []) reusable.set(contour.data, contour);

    let cursor = 0;
    const xAdvance = state.values[cursor++] ?? 0;
    const contours = state.structure.contours.map((data, contourIndex) => {
      const length = data.points.length * 2;
      const values = state.values.subarray(cursor, cursor + length);
      cursor += length;
      const reused = reusable.get(data);
      if (!reused) return new ContourBuffer(data, values, contourIndex);
      reusable.delete(data);
      reused.replaceValues(values);
      return reused;
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

  /** How many positions the layer holds: every contour point and every anchor. */
  get positionCount(): number {
    let count = this.anchors.data.length;
    for (const contour of this.contours) count += contour.pointCount;
    return count;
  }

  /**
   * Every contour point's position, contour after contour, then every
   * anchor's, as `x, y` pairs, with `updates` applied: what a `setPositions`
   * intent takes.
   */
  positionsWith(updates: GlyphPositions): number[] {
    const starts = new Map<ContourBuffer, number>();
    let pointsLength = 0;
    for (const contour of this.contours) {
      starts.set(contour, pointsLength);
      pointsLength += contour.pointCount * 2;
    }
    const length = pointsLength + this.anchors.data.length * 2;
    // The snapshot's leading value is the advance; positions follow it.
    const positions = Array.from(this.snapshot.subarray(1, 1 + length));
    for (const update of updates) {
      let start = -1;
      if (update.kind === "point") {
        const contour = this.#contourForPoint(update.id);
        const index = contour?.pointIndex(update.id) ?? -1;
        if (contour && index >= 0) start = starts.get(contour)! + index * 2;
      } else {
        const index = this.anchors.data.findIndex((anchor) => anchor.id === update.id);
        if (index >= 0) start = pointsLength + index * 2;
      }
      if (start < 0) continue;
      positions[start] = update.x;
      positions[start + 1] = update.y;
    }
    return positions;
  }

  componentTransform(componentId: ComponentId): DecomposedTransform | null {
    return (
      this.components.find((component) => component.data.id === componentId)?.transform ?? null
    );
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
    return this.#pointContours.get(pointId);
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
