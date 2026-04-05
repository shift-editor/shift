import type {
  GlyphSnapshot,
  FontMetadata,
  FontMetrics,
  PointId,
  ContourId,
  Point2D,
  AnchorId,
} from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative } from "./native";
import { NoEditSessionError, NativeOperationError } from "./errors";
import { constrainDrag } from "@shift/rules";
import { ValidateSnapshot } from "@shift/validation";
import { Glyphs } from "@shift/font";
import type {
  FontEngineAPI,
  NodePositionUpdate as BridgeNodePositionUpdate,
} from "@shared/bridge/FontEngineAPI";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";
import type { CommandResponse, PasteResult, PointEdit } from "@/types/engine";
import type { GlyphRef } from "@/lib/tools/text/layout";
import { ContourContent } from "@/lib/clipboard";
import type { NodePositionUpdateList } from "@/types/positionUpdate";
import { produceGlyph } from "./draft";

/**
 * Owns the raw NAPI bridge and the reactive {@link $glyph} signal.
 * All font queries, session lifecycle, and glyph mutations live here.
 */
export class FontEngine {
  readonly #$glyph: WritableSignal<GlyphSnapshot | null>;
  #raw: FontEngineAPI;

  constructor(raw?: FontEngineAPI) {
    this.#raw = raw ?? getNative();
    this.#$glyph = signal<GlyphSnapshot | null>(null);
  }

  // ── Signals ──

  get $glyph(): Signal<GlyphSnapshot | null> {
    return this.#$glyph;
  }

  getGlyph(): GlyphSnapshot | null {
    return this.#$glyph.value;
  }

  emitGlyph(glyph: GlyphSnapshot | null): void {
    this.#$glyph.set(glyph);
  }

  hasSession(): boolean {
    return this.#raw.hasEditSession();
  }

  startEditSession(target: GlyphRef): void {
    if (this.hasSession()) {
      const currentName = this.getEditingGlyphName();
      if (currentName === target.glyphName) return;
      this.endEditSession();
    }
    this.#raw.startEditSession({
      glyphName: target.glyphName,
      unicode: target.unicode ?? undefined,
    });
    this.emitGlyph(this.getSessionGlyph());
  }

  endEditSession(): void {
    this.#raw.endEditSession();
    this.emitGlyph(null);
  }

  getEditingUnicode(): number | null {
    return this.#raw.getEditingUnicode();
  }

  getEditingGlyphName(): string | null {
    return this.#raw.getEditingGlyphName();
  }

  getSessionGlyph(): GlyphSnapshot | null {
    if (!this.hasSession()) return null;
    try {
      return this.getSnapshot();
    } catch {
      return null;
    }
  }

  loadFont(path: string): void {
    this.#raw.loadFont(path);
  }

  saveFontAsync(path: string): Promise<void> {
    return this.#raw.saveFontAsync(path);
  }

  getMetadata(): FontMetadata {
    return JSON.parse(this.#raw.getMetadata());
  }

  getMetrics(): FontMetrics {
    return JSON.parse(this.#raw.getMetrics());
  }

  getGlyphUnicodes(): number[] {
    return this.#raw.getGlyphUnicodes();
  }

  getGlyphNameForUnicode(unicode: number): string | null {
    return this.#raw.getGlyphNameForUnicode(unicode);
  }

  getDependentUnicodesByName(glyphName: string): number[] {
    return this.#raw.getDependentUnicodesByName(glyphName);
  }

  getGlyphCompositeComponents(glyphName: string): CompositeComponentsPayload | null {
    const payload = this.#raw.getGlyphCompositeComponents(glyphName);
    if (!payload) return null;
    return JSON.parse(payload) as CompositeComponentsPayload;
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
    this.emitGlyph(response.snapshot);
    return response.affectedPointIds;
  }

  #dispatchVoid(json: string): void {
    this.#requireSession();
    const response = this.#execute(json);
    this.emitGlyph(response.snapshot);
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

    const glyph = this.getGlyph()!;
    const lastContour = glyph.contours[glyph.contours.length - 1];
    const lastPoint = lastContour?.points[lastContour.points.length - 1];
    if (!lastPoint) {
      throw new NativeOperationError("Native addPoint returned no point ID");
    }
    return lastPoint.id;
  }

  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#raw.addPointToContour(contourId, edit.x, edit.y, edit.pointType, edit.smooth),
    );
    const pointId = ids[0];
    if (pointId) return pointId;
    throw new NativeOperationError("Native addPointToContour returned no point ID");
  }

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
    const glyph = this.getGlyph();
    if (!glyph) throw new NativeOperationError("No glyph available");
    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) throw new NativeOperationError(`Point ${pointId} not found`);
    this.movePoints([pointId], { x: x - found.point.x, y: y - found.point.y });
  }

  removePoints(pointIds: PointId[]): void {
    if (pointIds.length === 0) return;
    this.#dispatchVoid(this.#raw.removePoints(pointIds));
  }

  toggleSmooth(pointId: PointId): void {
    this.#dispatchVoid(this.#raw.toggleSmooth(pointId));
  }

  addContour(): ContourId {
    this.#requireSession();
    const response = this.#execute(this.#raw.addContour());
    this.emitGlyph(response.snapshot);
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

  reverseContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.reverseContour(contourId));
  }

  openContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.openContour(contourId));
  }

  setXAdvance(width: number): void {
    this.#dispatchVoid(this.#raw.setXAdvance(width));
  }

  translateLayer(dx: number, dy: number): void {
    this.#dispatchVoid(this.#raw.translateLayer(dx, dy));
  }

  setNodePositions(updates: NodePositionUpdateList): void {
    if (!this.hasSession()) return;
    if (updates.length === 0) return;

    const glyph = this.getGlyph();
    if (!glyph) return;

    const updatedGlyph = produceGlyph(glyph, updates);
    this.emitGlyph(updatedGlyph);

    const nativeUpdates: BridgeNodePositionUpdate[] = updates.map((update) => ({
      node: { kind: update.node.kind, id: update.node.id },
      x: update.x,
      y: update.y,
    }));
    this.#raw.setNodePositions(nativeUpdates);
  }

  syncNodePositions(updates: NodePositionUpdateList): void {
    if (!this.hasSession()) return;
    if (updates.length === 0) return;

    const nativeUpdates: BridgeNodePositionUpdate[] = updates.map((update) => ({
      node: { kind: update.node.kind, id: update.node.id },
      x: update.x,
      y: update.y,
    }));
    this.#raw.setNodePositions(nativeUpdates);
  }

  applySmartEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    if (!this.hasSession()) return [];
    const glyph = this.getGlyph();
    if (!glyph) return [];

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
    this.emitGlyph(snapshot);

    return {
      success: raw.success,
      createdPointIds: raw.createdPointIds,
      createdContourIds: raw.createdContourIds,
      error: raw.error,
    };
  }

  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#requireSession();
    if (!ValidateSnapshot.isGlyphSnapshot(snapshot)) {
      throw new NativeOperationError("Cannot restore invalid snapshot");
    }
    const success = this.#raw.restoreSnapshot(JSON.stringify(snapshot));
    if (!success) {
      throw new NativeOperationError("Failed to restore snapshot");
    }
    this.emitGlyph(snapshot);
  }
}
