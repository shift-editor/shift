import type {
  AddAnchorsIntent,
  AddContourIntent,
  AddPointsIntent,
  AnchorData,
  GlyphState,
  MoveAnchorsIntent,
  MovePointsIntent,
  PointData,
  RemoveAnchorsIntent,
  RemovePointsIntent,
  ReverseContourIntent,
  SetContourClosedIntent,
  SetPointSmoothIntent,
  SetXAdvanceIntent,
  TranslatePointsIntent,
} from "@shift/types";
import { GlyphGeometry, type GlyphPosition } from "./GlyphGeometry";

/** Mutable copy used to apply typed local layer operations atomically. */
export class LayerStateDraft {
  readonly state: GlyphState;

  constructor(state: GlyphState) {
    this.state = {
      layerId: state.layerId,
      structure: {
        contours: state.structure.contours.map((contour) => ({
          ...contour,
          points: contour.points.map((point) => ({ ...point })),
        })),
        anchors: state.structure.anchors.map((anchor) => ({ ...anchor })),
        components: state.structure.components.map((component) => ({ ...component })),
      },
      values: state.values.slice(),
    };
  }

  addPoints(intent: AddPointsIntent): boolean {
    const pointIds = new Set(intent.points.map((point) => point.id));
    if (pointIds.size !== intent.points.length) return false;
    if (
      this.state.structure.contours.some((contour) =>
        contour.points.some((point) => pointIds.has(point.id)),
      )
    ) {
      return false;
    }

    let contourIndex = intent.contourId
      ? this.state.structure.contours.findIndex((contour) => contour.id === intent.contourId)
      : -1;
    if (contourIndex < 0 && !intent.contourId && intent.before) {
      contourIndex = this.state.structure.contours.findIndex((contour) =>
        contour.points.some((point) => point.id === intent.before),
      );
    }
    if (contourIndex < 0) return false;

    const contour = this.state.structure.contours[contourIndex];
    const pointIndex = intent.before
      ? contour.points.findIndex((point) => point.id === intent.before)
      : contour.points.length;
    if (pointIndex < 0) return false;

    const valueOffset = this.#contourValueOffset(contourIndex) + pointIndex * 2;
    this.#spliceValues(
      valueOffset,
      0,
      intent.points.flatMap((point) => [point.x, point.y]),
    );
    contour.points.splice(
      pointIndex,
      0,
      ...intent.points.map((point) => ({
        id: point.id,
        pointType: point.pointType,
        smooth: point.smooth,
      })),
    );

    return true;
  }

  addContour(intent: AddContourIntent): boolean {
    if (this.state.structure.contours.some((contour) => contour.id === intent.contourId)) {
      return false;
    }

    this.state.structure.contours.push({
      id: intent.contourId,
      points: [],
      closed: intent.closed,
    });
    return true;
  }

  setContourClosed(intent: SetContourClosedIntent): boolean {
    const contour = this.state.structure.contours.find(
      (candidate) => candidate.id === intent.contourId,
    );
    if (!contour) return false;

    contour.closed = intent.closed;
    return true;
  }

  movePoints(intent: MovePointsIntent): boolean {
    if (intent.coords.length !== intent.pointIds.length * 2) return false;

    const geometry = GlyphGeometry.fromState(this.state);
    const positions: GlyphPosition[] = [];
    for (let index = 0; index < intent.pointIds.length; index++) {
      const id = intent.pointIds[index];
      if (!geometry.point(id)) return false;

      positions.push({
        kind: "point",
        id,
        x: intent.coords[index * 2] ?? 0,
        y: intent.coords[index * 2 + 1] ?? 0,
      });
    }

    this.state.values = geometry.withPositionUpdates(positions).values;
    return true;
  }

  setPointSmooth(intent: SetPointSmoothIntent): boolean {
    for (const contour of this.state.structure.contours) {
      const point = contour.points.find((candidate) => candidate.id === intent.pointId);
      if (!point) continue;

      point.smooth = intent.smooth;
      return true;
    }

    return false;
  }

  removePoints(intent: RemovePointsIntent): boolean {
    const pointIds = new Set(intent.pointIds);
    if (pointIds.size !== intent.pointIds.length) return false;

    let found = 0;
    const values: number[] = [this.state.values[0] ?? 0];
    let valueOffset = 1;
    for (const contour of this.state.structure.contours) {
      const retained: PointData[] = [];
      for (const point of contour.points) {
        if (pointIds.has(point.id)) {
          found += 1;
        } else {
          retained.push(point);
          values.push(this.state.values[valueOffset] ?? 0, this.state.values[valueOffset + 1] ?? 0);
        }
        valueOffset += 2;
      }
      contour.points = retained;
    }
    if (found !== pointIds.size) return false;

    values.push(...this.state.values.slice(valueOffset));
    this.state.values = new Float64Array(values);
    return true;
  }

  addAnchors(intent: AddAnchorsIntent): boolean {
    const anchorIds = new Set(intent.anchors.map((anchor) => anchor.id));
    if (anchorIds.size !== intent.anchors.length) return false;
    if (this.state.structure.anchors.some((anchor) => anchorIds.has(anchor.id))) return false;

    this.#spliceValues(
      this.#componentValueOffset(),
      0,
      intent.anchors.flatMap((anchor) => [anchor.x, anchor.y]),
    );
    this.state.structure.anchors.push(
      ...intent.anchors.map((anchor) => ({
        id: anchor.id,
        ...(anchor.name === undefined ? {} : { name: anchor.name }),
      })),
    );
    return true;
  }

  moveAnchors(intent: MoveAnchorsIntent): boolean {
    if (intent.coords.length !== intent.anchorIds.length * 2) return false;

    const geometry = GlyphGeometry.fromState(this.state);
    const positions: GlyphPosition[] = [];
    for (let index = 0; index < intent.anchorIds.length; index++) {
      const id = intent.anchorIds[index];
      if (!geometry.anchor(id)) return false;

      positions.push({
        kind: "anchor",
        id,
        x: intent.coords[index * 2] ?? 0,
        y: intent.coords[index * 2 + 1] ?? 0,
      });
    }

    this.state.values = geometry.withPositionUpdates(positions).values;
    return true;
  }

  removeAnchors(intent: RemoveAnchorsIntent): boolean {
    const anchorIds = new Set(intent.anchorIds);
    if (anchorIds.size !== intent.anchorIds.length) return false;
    if (
      this.state.structure.anchors.filter((anchor) => anchorIds.has(anchor.id)).length !==
      anchorIds.size
    ) {
      return false;
    }

    const anchorStart = this.#anchorValueStart();
    const values: number[] = [...this.state.values.slice(0, anchorStart)];
    for (let index = 0; index < this.state.structure.anchors.length; index++) {
      const anchor = this.state.structure.anchors[index];
      if (anchorIds.has(anchor.id)) continue;

      const offset = anchorStart + index * 2;
      values.push(this.state.values[offset] ?? 0, this.state.values[offset + 1] ?? 0);
    }
    values.push(...this.state.values.slice(this.#componentValueOffset()));

    const retained: AnchorData[] = this.state.structure.anchors.filter(
      (anchor) => !anchorIds.has(anchor.id),
    );
    this.state.structure.anchors = retained;
    this.state.values = new Float64Array(values);
    return true;
  }

  reverseContour(intent: ReverseContourIntent): boolean {
    const contourIndex = this.state.structure.contours.findIndex(
      (contour) => contour.id === intent.contourId,
    );
    if (contourIndex < 0) return false;

    const contour = this.state.structure.contours[contourIndex];
    const valueOffset = this.#contourValueOffset(contourIndex);
    const coordinates = this.state.values.slice(
      valueOffset,
      valueOffset + contour.points.length * 2,
    );

    contour.points.reverse();
    for (let index = 0; index < contour.points.length; index++) {
      const source = (contour.points.length - index - 1) * 2;
      this.state.values[valueOffset + index * 2] = coordinates[source] ?? 0;
      this.state.values[valueOffset + index * 2 + 1] = coordinates[source + 1] ?? 0;
    }
    return true;
  }

  translatePoints(intent: TranslatePointsIntent): boolean {
    const pointIds = [...new Set(intent.pointIds)];
    const geometry = GlyphGeometry.fromState(this.state);
    const positions = geometry.positionsFor(pointIds.map((id) => ({ kind: "point", id })));
    if (positions.length !== pointIds.length) return false;

    const moved = geometry.movePositions(positions, { x: intent.dx, y: intent.dy });
    this.state.values = geometry.withPositionUpdates(moved).values;
    return true;
  }

  setXAdvance(intent: SetXAdvanceIntent): boolean {
    const values = new Float64Array(this.state.values);
    values[0] = intent.width;
    this.state.values = values;
    return true;
  }

  #contourValueOffset(contourIndex: number): number {
    let valueOffset = 1;
    for (let index = 0; index < contourIndex; index++) {
      valueOffset += this.state.structure.contours[index].points.length * 2;
    }
    return valueOffset;
  }

  #anchorValueStart(): number {
    return this.#contourValueOffset(this.state.structure.contours.length);
  }

  #componentValueOffset(): number {
    return this.#anchorValueStart() + this.state.structure.anchors.length * 2;
  }

  #spliceValues(start: number, deleteCount: number, additions: readonly number[]): void {
    const values = new Float64Array(this.state.values.length - deleteCount + additions.length);
    values.set(this.state.values.slice(0, start));
    values.set(additions, start);
    values.set(this.state.values.slice(start + deleteCount), start + additions.length);
    this.state.values = values;
  }
}
