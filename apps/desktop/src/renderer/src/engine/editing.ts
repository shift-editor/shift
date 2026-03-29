import type { GlyphSnapshot, PointId, ContourId, Point2D, AnchorId } from "@shift/types";
import { constrainDrag } from "@shift/rules";
import { ValidateSnapshot } from "@shift/validation";
import { Glyphs } from "@shift/font";
import { NoEditSessionError, NativeOperationError } from "./errors";
import type {
  FontEngineAPI,
  NodePositionUpdate as BridgeNodePositionUpdate,
} from "@shared/bridge/FontEngineAPI";
import type { CommandResponse, PasteResult, PointEdit } from "@/types/engine";
import { ContourContent } from "@/lib/clipboard";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

/** Raw NAPI surface that {@link EditingManager} wraps. Provides bridge access, session guards, glyph read/write, and low-level mutation primitives. */
export interface EditingEngineDeps {
  readonly raw: FontEngineAPI;
  hasSession(): boolean;
  getGlyph(): GlyphSnapshot | null;
  emitGlyph(glyph: GlyphSnapshot | null): void;
  getActiveContourId(): ContourId | null;
  getSnapshot(): GlyphSnapshot;
  restoreSnapshot(snapshot: GlyphSnapshot): void;
  setNodePositions(updates: BridgeNodePositionUpdate[]): boolean;
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult;
}

/**
 * All glyph mutations flow through this manager.
 *
 * Every public method guards on an active session, then dispatches via one of three internal helpers:
 * - `#execute` -- parses the JSON command response and throws on failure
 * - `#dispatch` -- executes, emits the snapshot, and returns affected point IDs
 * - `#dispatchVoid` -- executes and emits, discarding the ID list
 */
export class EditingManager {
  #engine: EditingEngineDeps;

  constructor(engine: EditingEngineDeps) {
    this.#engine = engine;
  }

  #execute(json: string): CommandResponse {
    const raw = JSON.parse(json);
    if (!raw.success) {
      throw new NativeOperationError(raw.error ?? "Unknown native error");
    }
    if (!raw.snapshot) {
      throw new NativeOperationError("Native operation succeeded but returned no snapshot");
    }
    return {
      snapshot: raw.snapshot as GlyphSnapshot,
      affectedPointIds: raw.affectedPointIds,
    };
  }

  #dispatch(json: string): PointId[] {
    this.#requireSession();
    const response = this.#execute(json);
    this.#engine.emitGlyph(response.snapshot);
    return response.affectedPointIds;
  }

  #dispatchVoid(json: string): void {
    this.#requireSession();
    const response = this.#execute(json);
    this.#engine.emitGlyph(response.snapshot);
  }

  #applyNodePositionUpdatesToGlyph(
    glyph: GlyphSnapshot,
    updates: NodePositionUpdateList,
  ): GlyphSnapshot {
    if (updates.length === 0) return glyph;

    const pointUpdatesById = new Map<PointId, { x: number; y: number }>();
    const anchorUpdatesById = new Map<AnchorId, { x: number; y: number }>();

    for (const update of updates) {
      switch (update.node.kind) {
        case "point":
          pointUpdatesById.set(update.node.id, { x: update.x, y: update.y });
          break;
        case "anchor":
          anchorUpdatesById.set(update.node.id, { x: update.x, y: update.y });
          break;
        case "guideline":
          // Guideline updates are reserved for a later pass.
          break;
      }
    }

    if (pointUpdatesById.size === 0 && anchorUpdatesById.size === 0) {
      return glyph;
    }

    return {
      ...glyph,
      contours:
        pointUpdatesById.size === 0
          ? glyph.contours
          : glyph.contours.map((contour) => ({
              ...contour,
              points: contour.points.map((point) => {
                const update = pointUpdatesById.get(point.id);
                if (!update) return point;
                return { ...point, x: update.x, y: update.y };
              }),
            })),
      anchors:
        anchorUpdatesById.size === 0
          ? glyph.anchors
          : glyph.anchors.map((anchor) => {
              const update = anchorUpdatesById.get(anchor.id);
              if (!update) return anchor;
              return { ...anchor, x: update.x, y: update.y };
            }),
    };
  }

  addPoint(edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#engine.raw.addPoint(edit.x, edit.y, edit.pointType, edit.smooth),
    );

    const pointId = ids[0];
    if (pointId) {
      return pointId;
    }

    const glyph = this.#engine.getGlyph()!;
    const lastContour = glyph.contours[glyph.contours.length - 1];
    const lastPoint = lastContour?.points[lastContour.points.length - 1];
    if (!lastPoint) {
      throw new NativeOperationError("Native addPoint returned no point ID");
    }
    return lastPoint.id;
  }

  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#engine.raw.addPointToContour(contourId, edit.x, edit.y, edit.pointType, edit.smooth),
    );
    const pointId = ids[0];
    if (pointId) {
      return pointId;
    }
    throw new NativeOperationError("Native addPointToContour returned no point ID");
  }

  movePoints(pointIds: PointId[], delta: Point2D): PointId[] {
    if (pointIds.length === 0) return [];
    return this.#dispatch(
      this.#engine.raw.moveNodes(
        pointIds.map((id) => ({ kind: "point", id })),
        delta.x,
        delta.y,
      ),
    );
  }

  moveAnchors(anchorIds: AnchorId[], delta: Point2D): void {
    if (anchorIds.length === 0) return;
    this.#dispatchVoid(
      this.#engine.raw.moveNodes(
        anchorIds.map((id) => ({ kind: "anchor", id })),
        delta.x,
        delta.y,
      ),
    );
  }

  movePointTo(pointId: PointId, x: number, y: number): void {
    this.#requireSession();

    const glyph = this.#engine.getGlyph();
    if (!glyph) {
      throw new NativeOperationError("No glyph available");
    }

    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) {
      throw new NativeOperationError(`Point ${pointId} not found`);
    }
    this.movePoints([pointId], { x: x - found.point.x, y: y - found.point.y });
  }

  removePoints(pointIds: PointId[]): void {
    if (pointIds.length === 0) return;
    this.#dispatchVoid(this.#engine.raw.removePoints(pointIds));
  }

  /** @knipclassignore used via Pick<EditingManager, CommandEditingMethods> */
  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#engine.raw.insertPointBefore(
        beforePointId,
        edit.x,
        edit.y,
        edit.pointType,
        edit.smooth,
      ),
    );
    const pointId = ids[0];
    if (pointId) {
      return pointId;
    }
    throw new NativeOperationError("Native insertPointBefore returned no point ID");
  }

  toggleSmooth(pointId: PointId): void {
    this.#dispatchVoid(this.#engine.raw.toggleSmooth(pointId));
  }

  addContour(): ContourId {
    this.#requireSession();
    const response = this.#execute(this.#engine.raw.addContour());
    this.#engine.emitGlyph(response.snapshot);
    return response.snapshot.activeContourId!;
  }

  closeContour(): void {
    this.#dispatchVoid(this.#engine.raw.closeContour());
  }

  getActiveContourId(): ContourId | null {
    if (!this.#engine.hasSession()) return null;
    return this.#engine.getActiveContourId();
  }

  /** @knipclassignore used via Pick<EditingManager, CommandEditingMethods> */
  setXAdvance(width: number): void {
    this.#dispatchVoid(this.#engine.raw.setXAdvance(width));
  }

  /** @knipclassignore used via Pick<EditingManager, CommandEditingMethods> */
  translateLayer(dx: number, dy: number): void {
    this.#dispatchVoid(this.#engine.raw.translateLayer(dx, dy));
  }

  setActiveContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.setActiveContour(contourId));
  }

  clearActiveContour(): void {
    if (!this.#engine.hasSession()) return;
    this.#dispatchVoid(this.#engine.raw.clearActiveContour());
  }

  reverseContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.reverseContour(contourId));
  }

  /** @knipclassignore used via Pick<EditingManager, CommandEditingMethods> */
  removeContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.removeContour(contourId));
  }

  /** @knipclassignore used via Pick<EditingManager, CommandEditingMethods> */
  openContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#engine.raw.openContour(contourId));
  }

  /** Returns {@link PasteResult} containing the IDs of all newly created points and contours. Offset is in UPM units. */
  pasteContours(contours: ContourContent[], offsetX: number, offsetY: number): PasteResult {
    this.#requireSession();

    const contoursJson = JSON.stringify(contours);
    const result = this.#engine.pasteContours(contoursJson, offsetX, offsetY);

    if (!result.success) {
      throw new NativeOperationError(result.error ?? "pasteContours failed");
    }

    const snapshot = this.#engine.getSnapshot();
    this.#engine.emitGlyph(snapshot);

    return result;
  }

  /**
   * Runs the rules engine on selected points, applies resulting moves optimistically
   * to the glyph signal, then syncs absolute positions to native. Returns affected IDs.
   */
  applySmartEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    if (!this.#engine.hasSession()) return [];

    const glyph = this.#engine.getGlyph();
    if (!glyph) return [];

    const patch = constrainDrag(
      {
        glyph,
        selectedIds: selectedPoints,
        mousePosition: { x: dx, y: dy },
      },
      { includeMatchedRules: false },
    );

    const updates: NodePositionUpdateList = patch.pointUpdates.map(
      (update: (typeof patch.pointUpdates)[number]) => ({
        node: { kind: "point", id: update.id },
        x: update.x,
        y: update.y,
      }),
    );
    if (updates.length > 0) {
      this.setNodePositions(updates);
    }

    return patch.pointUpdates.map((u: (typeof patch.pointUpdates)[number]) => u.id);
  }

  /** Batch-sets absolute node positions. Applies optimistically to the signal, then syncs to native. */
  setNodePositions(updates: NodePositionUpdateList): void {
    if (!this.#engine.hasSession()) return;
    if (updates.length === 0) return;

    const glyph = this.#engine.getGlyph();
    if (!glyph) return;

    const updatedGlyph = this.#applyNodePositionUpdatesToGlyph(glyph, updates);
    this.#engine.emitGlyph(updatedGlyph);

    const nativeUpdates: BridgeNodePositionUpdate[] = updates.map((update) => ({
      node: { kind: update.node.kind, id: update.node.id },
      x: update.x,
      y: update.y,
    }));
    this.#engine.setNodePositions(nativeUpdates);
  }

  /** Syncs absolute node positions to native without re-emitting the current glyph snapshot. */
  syncNodePositions(updates: NodePositionUpdateList): void {
    if (!this.#engine.hasSession()) return;
    if (updates.length === 0) return;

    const nativeUpdates: BridgeNodePositionUpdate[] = updates.map((update) => ({
      node: { kind: update.node.kind, id: update.node.id },
      x: update.x,
      y: update.y,
    }));
    this.#engine.setNodePositions(nativeUpdates);
  }

  /** Syncs a uniform delta move to native without re-emitting the current glyph snapshot. */
  syncMoveNodes(pointIds: PointId[], anchorIds: AnchorId[], delta: Point2D): void {
    if (!this.#engine.hasSession()) return;
    if (pointIds.length === 0 && anchorIds.length === 0) return;
    if (delta.x === 0 && delta.y === 0) return;

    if (typeof this.#engine.raw.movePointsAndAnchorsLight === "function") {
      this.#engine.raw.movePointsAndAnchorsLight(pointIds, anchorIds, delta.x, delta.y);
      return;
    }

    if (typeof this.#engine.raw.moveNodesLight === "function") {
      const nodes = [
        ...pointIds.map((id) => ({ kind: "point" as const, id })),
        ...anchorIds.map((id) => ({ kind: "anchor" as const, id })),
      ];
      this.#engine.raw.moveNodesLight(nodes, delta.x, delta.y);
      return;
    }

    this.#execute(
      this.#engine.raw.moveNodes(
        [
          ...pointIds.map((id) => ({ kind: "point" as const, id })),
          ...anchorIds.map((id) => ({ kind: "anchor" as const, id })),
        ],
        delta.x,
        delta.y,
      ),
    );
  }

  prepareNodeTranslation(pointIds: PointId[], anchorIds: AnchorId[]): boolean {
    if (!this.#engine.hasSession()) return false;
    if (typeof this.#engine.raw.prepareNodeTranslationLight !== "function") return false;
    return this.#engine.raw.prepareNodeTranslationLight(pointIds, anchorIds);
  }

  applyPreparedNodeTranslation(delta: Point2D): boolean {
    if (!this.#engine.hasSession()) return false;
    if (typeof this.#engine.raw.applyPreparedNodeTranslationLight !== "function") return false;
    if (delta.x === 0 && delta.y === 0) return true;
    return this.#engine.raw.applyPreparedNodeTranslationLight(delta.x, delta.y);
  }

  clearPreparedNodeTranslation(): void {
    this.#engine.raw.clearPreparedNodeTranslationLight?.();
  }

  /** Validates and restores a previous snapshot. Throws on invalid data. Used for undo/redo. */
  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#requireSession();
    if (!ValidateSnapshot.isGlyphSnapshot(snapshot)) {
      throw new NativeOperationError("Cannot restore invalid snapshot");
    }
    this.#engine.restoreSnapshot(snapshot);
    this.#engine.emitGlyph(snapshot);
  }

  #requireSession(): void {
    if (!this.#engine.hasSession()) {
      throw new NoEditSessionError();
    }
  }
}
