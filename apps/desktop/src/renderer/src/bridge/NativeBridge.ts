import type {
  GlyphSnapshot,
  FontMetadata,
  FontMetrics,
  PointId,
  ContourId,
  Point2D,
  AnchorId,
  Axis,
  Source,
  GlyphVariationData,
  MasterSnapshot,
} from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { Bounds } from "@shift/geo";
import { Bounds as BoundsUtil } from "@shift/geo";
import { getNative } from "./native";
import { NoEditSessionError, NativeOperationError } from "./errors";
import { constrainDrag } from "@shift/rules";
import { ValidateSnapshot } from "@shift/validation";
import { Glyphs } from "@shift/font";
import type { FontEngineAPI } from "@shared/bridge/FontEngineAPI";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";
import type { CommandResponse, PasteResult, PointEdit } from "@/types/engine";
import { ContourContent } from "@/lib/clipboard";
import type { NodePositionUpdateList } from "@/types/positionUpdate";
import { Glyph, type GlyphChange } from "@/lib/model/Glyph";

export interface InterpolationResult {
  instance: GlyphSnapshot;
  errors: Array<{ sourceIndex: number; sourceName: string; message: string }>;
}

/**
 * Owns the raw NAPI bridge and the reactive {@link $glyph} signal.
 * All font queries, session lifecycle, and glyph mutations live here.
 *
 * The $glyph signal holds a reactive {@link Glyph} with per-contour signals.
 * All mutations go through {@link Glyph.apply} — structural edits pass a
 * snapshot, position updates pass a NodePositionUpdateList.
 */
export class NativeBridge {
  readonly #$glyph: WritableSignal<Glyph | null>;
  #raw: FontEngineAPI;

  constructor(raw?: FontEngineAPI) {
    this.#raw = raw ?? getNative();
    this.#$glyph = signal<Glyph | null>(null, { equals: () => false });
  }

  get $glyph(): Signal<Glyph | null> {
    return this.#$glyph;
  }

  getEditingSnapshot(): GlyphSnapshot | null {
    const glyph = this.#$glyph.peek();
    return glyph ? glyph.toSnapshot() : null;
  }

  hasSession(): boolean {
    return this.#raw.hasEditSession();
  }

  startEditSession(glyphName: string, unicode?: number): void {
    if (this.hasSession()) {
      const currentName = this.getEditingGlyphName();
      if (currentName === glyphName) return;
      this.endEditSession();
    }
    const ref = unicode !== undefined ? { glyphName, unicode } : { glyphName };
    this.#raw.startEditSession(ref);
    this.#$glyph.set(this.hasSession() ? new Glyph(this) : null);
  }

  endEditSession(): void {
    this.#raw.endEditSession();
    this.#$glyph.set(null);
  }

  getEditingUnicode(): number | null {
    return this.#raw.getEditingUnicode();
  }

  getEditingGlyphName(): string | null {
    return this.#raw.getEditingGlyphName();
  }

  loadFont(path: string): void {
    this.#raw.loadFont(path);
  }

  saveFontAsync(path: string): Promise<void> {
    return this.#raw.saveFontAsync(path);
  }

  /** @knipclassignore — satisfies Font interface */
  getMetadata(): FontMetadata {
    return JSON.parse(this.#raw.getMetadata());
  }

  getMetrics(): FontMetrics {
    return JSON.parse(this.#raw.getMetrics());
  }

  getGlyphUnicodes(): number[] {
    return this.#raw.getGlyphUnicodes();
  }

  nameForUnicode(unicode: number): string | null {
    return this.#raw.getGlyphNameForUnicode(unicode);
  }

  /** @knipclassignore — used by glyph grid for dependent lookups */
  getDependentUnicodesByName(glyphName: string): number[] {
    return this.#raw.getDependentUnicodesByName(glyphName);
  }

  getSvgPath(name: string): string | null {
    return this.#raw.getGlyphSvgPathByName(name) ?? null;
  }

  /** @knipclassignore — satisfies Font interface */
  getAdvance(name: string): number | null {
    return this.#raw.getGlyphAdvanceByName(name) ?? null;
  }

  getBbox(name: string): Bounds | null {
    const b = this.#raw.getGlyphBboxByName(name);
    if (b == null || b.length !== 4) return null;
    return BoundsUtil.create({ x: b[0], y: b[1] }, { x: b[2], y: b[3] });
  }

  /** @knipclassignore — satisfies Font interface */
  getPath(name: string): Path2D | null {
    const editing = this.#$glyph.peek();
    if (editing?.name === name) return editing.path;
    const svg = this.getSvgPath(name);
    return svg ? new Path2D(svg) : null;
  }

  getGlyphCompositeComponents(glyphName: string): CompositeComponentsPayload | null {
    const payload = this.#raw.getGlyphCompositeComponents(glyphName);
    if (!payload) return null;
    return JSON.parse(payload) as CompositeComponentsPayload;
  }

  /** @knipclassignore — used by VariationPanel component */
  isVariable(): boolean {
    return this.#raw.isVariable();
  }

  /** @knipclassignore — used by VariationPanel component */
  getAxes(): Axis[] {
    return JSON.parse(this.#raw.getAxes()) as Axis[];
  }

  /** @knipclassignore — used by VariationPanel component */
  getSources(): Source[] {
    return JSON.parse(this.#raw.getSources()) as Source[];
  }

  /** @knipclassignore — used by VariationPanel component */
  getGlyphMasterSnapshots(glyphName: string): MasterSnapshot[] | null {
    const json = this.#raw.getGlyphMasterSnapshots(glyphName);
    if (!json) return null;
    return JSON.parse(json) as MasterSnapshot[];
  }

  getGlyphVariationData(glyphName: string): GlyphVariationData | null {
    const json = this.#raw.getGlyphVariationData(glyphName);
    if (!json) return null;
    return JSON.parse(json) as GlyphVariationData;
  }

  getSnapshot(): GlyphSnapshot {
    return JSON.parse(this.#raw.getSnapshotData()) as GlyphSnapshot;
  }

  #execute(json: string): CommandResponse {
    const raw = JSON.parse(json);
    if (!raw.success) {
      throw new NativeOperationError(raw.error ?? "Unknown native error");
    }
    if (!raw.snapshot) {
      throw new NativeOperationError("Native operation succeeded but returned no snapshot");
    }
    return { snapshot: raw.snapshot as GlyphSnapshot, affectedPointIds: raw.affectedPointIds };
  }

  #dispatch(json: string): PointId[] {
    this.#requireSession();
    const response = this.#execute(json);
    this.#syncFromResponse(response.snapshot);
    return response.affectedPointIds;
  }

  #dispatchVoid(json: string): void {
    this.#requireSession();
    const response = this.#execute(json);
    this.#syncFromResponse(response.snapshot);
  }

  #syncFromResponse(snapshot: GlyphSnapshot): void {
    const glyph = this.#$glyph.peek();
    if (glyph) {
      glyph.apply(snapshot);
      this.#$glyph.set(glyph);
    } else {
      this.#$glyph.set(new Glyph(this));
    }
  }

  #requireSession(): void {
    if (!this.hasSession()) {
      throw new NoEditSessionError();
    }
  }

  addPoint(edit: PointEdit): PointId {
    const ids = this.#dispatch(this.#raw.addPoint(edit.x, edit.y, edit.pointType, edit.smooth));
    const pointId = ids[0];
    if (pointId) return pointId;

    const glyph = this.#$glyph.peek();
    if (!glyph) throw new NativeOperationError("Native addPoint returned no point ID");
    const lastContour = glyph.contours[glyph.contours.length - 1];
    const lastPoint = lastContour?.points[lastContour.points.length - 1];
    if (!lastPoint) {
      throw new NativeOperationError("Native addPoint returned no point ID");
    }
    return lastPoint.id;
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#raw.addPointToContour(contourId, edit.x, edit.y, edit.pointType, edit.smooth),
    );
    const pointId = ids[0];
    if (pointId) return pointId;
    throw new NativeOperationError("Native addPointToContour returned no point ID");
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#raw.insertPointBefore(beforePointId, edit.x, edit.y, edit.pointType, edit.smooth),
    );
    const pointId = ids[0];
    if (pointId) return pointId;
    throw new NativeOperationError("Native insertPointBefore returned no point ID");
  }

  movePoints(pointIds: PointId[], delta: Point2D): PointId[] {
    if (pointIds.length === 0) return [];
    return this.#dispatch(
      this.#raw.moveNodes(
        pointIds.map((id) => ({ kind: "point", id })),
        delta.x,
        delta.y,
      ),
    );
  }

  moveAnchors(anchorIds: AnchorId[], delta: Point2D): void {
    if (anchorIds.length === 0) return;
    this.#dispatchVoid(
      this.#raw.moveNodes(
        anchorIds.map((id) => ({ kind: "anchor", id })),
        delta.x,
        delta.y,
      ),
    );
  }

  movePointTo(pointId: PointId, x: number, y: number): void {
    this.#requireSession();

    const snapshot = this.getEditingSnapshot();
    if (!snapshot) throw new NativeOperationError("No glyph available");

    const found = Glyphs.findPoint(snapshot, pointId);
    if (!found) throw new NativeOperationError(`Point ${pointId} not found`);

    this.movePoints([pointId], { x: x - found.point.x, y: y - found.point.y });
  }

  removePoints(pointIds: PointId[]): void {
    if (pointIds.length === 0) return;
    this.#dispatchVoid(this.#raw.removePoints(pointIds));
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  toggleSmooth(pointId: PointId): void {
    this.#dispatchVoid(this.#raw.toggleSmooth(pointId));
  }

  addContour(): ContourId {
    this.#requireSession();
    const response = this.#execute(this.#raw.addContour());
    this.#syncFromResponse(response.snapshot);
    return response.snapshot.activeContourId!;
  }

  closeContour(): void {
    this.#dispatchVoid(this.#raw.closeContour());
  }

  getActiveContourId(): ContourId | null {
    if (!this.hasSession()) return null;
    return this.#raw.getActiveContourId();
  }

  setActiveContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.setActiveContour(contourId));
  }

  clearActiveContour(): void {
    if (!this.hasSession()) return;
    this.#dispatchVoid(this.#raw.clearActiveContour());
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  reverseContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.reverseContour(contourId));
  }

  /** @knipclassignore — used via Editor delegation */
  applyBooleanOp(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    this.#dispatchVoid(this.#raw.applyBooleanOp(contourIdA, contourIdB, operation));
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  openContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.openContour(contourId));
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  setXAdvance(width: number): void {
    this.#dispatchVoid(this.#raw.setXAdvance(width));
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  translateLayer(dx: number, dy: number): void {
    this.#dispatchVoid(this.#raw.translateLayer(dx, dy));
  }

  setNodePositions(updates: NodePositionUpdateList): void {
    if (!this.hasSession()) return;
    if (updates.length === 0) return;

    const glyph = this.#$glyph.peek();
    if (!glyph) return;

    glyph.apply(updates);
    this.#$glyph.set(glyph);
    this.#syncPositions(updates);
  }

  /** @knipclassignore — used by Editor for smart drag constraints */
  applySmartEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    if (!this.hasSession()) return [];
    const reactive = this.#$glyph.peek();
    if (!reactive) return [];
    const glyph = reactive.toSnapshot();

    const patch = constrainDrag(
      { glyph, selectedIds: selectedPoints, mousePosition: { x: dx, y: dy } },
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

  pasteContours(contours: ContourContent[], offsetX: number, offsetY: number): PasteResult {
    this.#requireSession();
    const contoursJson = JSON.stringify(contours);
    const raw = JSON.parse(this.#raw.pasteContours(contoursJson, offsetX, offsetY));

    if (!raw.success) {
      throw new NativeOperationError(raw.error ?? "pasteContours failed");
    }

    const snapshot = this.getSnapshot();
    this.#syncFromResponse(snapshot);

    return {
      success: raw.success,
      createdPointIds: raw.createdPointIds,
      createdContourIds: raw.createdContourIds,
      error: raw.error,
    };
  }

  /** @knipclassignore — used via Editor delegation or Glyph */
  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#requireSession();
    if (!ValidateSnapshot.isGlyphSnapshot(snapshot)) {
      throw new NativeOperationError("Cannot restore invalid snapshot");
    }
    const success = this.#raw.restoreSnapshot(JSON.stringify(snapshot));
    if (!success) {
      throw new NativeOperationError("Failed to restore snapshot");
    }
    this.#syncFromResponse(snapshot);
  }

  /**
   * Rust-side mirror of glyph.apply(). Syncs a change to Rust without
   * updating the JS reactive model. Position updates use Float64Array
   * (zero-copy), snapshots use JSON.
   */
  sync(change: GlyphChange): void {
    this.#requireSession();

    if (Array.isArray(change)) {
      this.#syncPositions(change);
      return;
    }

    const success = this.#raw.restoreSnapshot(JSON.stringify(change));
    if (!success) {
      throw new NativeOperationError("Failed to sync snapshot to native");
    }
  }

  #syncPositions(updates: NodePositionUpdateList): void {
    if (updates.length === 0) return;

    const pointIds: number[] = [];
    const pointCoords: number[] = [];
    const anchorIds: number[] = [];
    const anchorCoords: number[] = [];

    for (const u of updates) {
      switch (u.node.kind) {
        case "point":
          pointIds.push(Number(u.node.id));
          pointCoords.push(u.x, u.y);
          break;
        case "anchor":
          anchorIds.push(Number(u.node.id));
          anchorCoords.push(u.x, u.y);
          break;
      }
    }

    this.#raw.setPositions(
      pointIds.length > 0 ? new Float64Array(pointIds) : null,
      pointCoords.length > 0 ? new Float64Array(pointCoords) : null,
      anchorIds.length > 0 ? new Float64Array(anchorIds) : null,
      anchorCoords.length > 0 ? new Float64Array(anchorCoords) : null,
    );
  }
}
