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
  Location,
} from "@shift/types";
import type { MasterSnapshot } from "@/lib/interpolation/interpolate";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { Bounds } from "@shift/geo";
import { Bounds as BoundsUtil } from "@shift/geo";
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
  readonly #$fontLoaded: WritableSignal<boolean>;
  readonly #$fontUnicodes: WritableSignal<number[]>;
  readonly #$fontMetrics: WritableSignal<FontMetrics | null>;
  readonly #$variationLocation: WritableSignal<Location | null>;
  #raw: FontEngineAPI;

  constructor(raw?: FontEngineAPI) {
    this.#raw = raw ?? getNative();
    this.#$glyph = signal<GlyphSnapshot | null>(null);
    this.#$fontLoaded = signal(false);
    this.#$fontUnicodes = signal<number[]>([]);
    this.#$fontMetrics = signal<FontMetrics | null>(null);
    this.#$variationLocation = signal<Location | null>(null);
  }

  get $glyph(): Signal<GlyphSnapshot | null> {
    return this.#$glyph;
  }

  /** @knipclassignore — used by React components via editor.fontEngine */
  get $fontLoaded(): Signal<boolean> {
    return this.#$fontLoaded;
  }

  /** @knipclassignore */
  get $fontUnicodes(): Signal<number[]> {
    return this.#$fontUnicodes;
  }

  /** @knipclassignore */
  get $fontMetrics(): Signal<FontMetrics | null> {
    return this.#$fontMetrics;
  }

  /** @knipclassignore — used by GlyphPreview for variation interpolation */
  get $variationLocation(): Signal<Location | null> {
    return this.#$variationLocation;
  }

  /** @knipclassignore — used by VariationPanel */
  setVariationLocation(location: Location | null): void {
    this.#$variationLocation.set(location);
  }

  setFontLoaded(unicodes: number[], metrics: FontMetrics): void {
    this.#$fontUnicodes.set(unicodes);
    this.#$fontMetrics.set(metrics);
    this.#$fontLoaded.set(true);
  }

  /** @knipclassignore */
  resetFontMetadata(): void {
    this.#$fontLoaded.set(false);
    this.#$fontUnicodes.set([]);
    this.#$fontMetrics.set(null);
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
    const ref =
      target.unicode !== null
        ? { glyphName: target.glyphName, unicode: target.unicode }
        : { glyphName: target.glyphName };
    this.#raw.startEditSession(ref);
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

  getGlyphNameForUnicode(unicode: number): string | null {
    return this.#raw.getGlyphNameForUnicode(unicode);
  }

  /** @knipclassignore — satisfies Font interface */
  getSvgPath(unicode: number): string | null {
    return this.#raw.getGlyphSvgPath(unicode) ?? null;
  }

  /** @knipclassignore — satisfies Font interface */
  getSvgPathByName(glyphName: string): string | null {
    return this.#raw.getGlyphSvgPathByName(glyphName) ?? null;
  }

  /** @knipclassignore — satisfies Font interface */
  getAdvance(unicode: number): number | null {
    return this.#raw.getGlyphAdvance(unicode) ?? null;
  }

  /** @knipclassignore — satisfies Font interface */
  getAdvanceByName(glyphName: string): number | null {
    return this.#raw.getGlyphAdvanceByName(glyphName) ?? null;
  }

  /** @knipclassignore — satisfies Font interface */
  getBbox(unicode: number): Bounds | null {
    const b = this.#raw.getGlyphBbox(unicode);
    if (b == null || b.length !== 4) return null;
    return BoundsUtil.create({ x: b[0], y: b[1] }, { x: b[2], y: b[3] });
  }

  getBboxByName(glyphName: string): Bounds | null {
    const b = this.#raw.getGlyphBboxByName(glyphName);
    if (b == null || b.length !== 4) return null;
    return BoundsUtil.create({ x: b[0], y: b[1] }, { x: b[2], y: b[3] });
  }

  getDependentUnicodesByName(glyphName: string): number[] {
    return this.#raw.getDependentUnicodesByName(glyphName);
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

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    const ids = this.#dispatch(
      this.#raw.addPointToContour(contourId, edit.x, edit.y, edit.pointType, edit.smooth),
    );
    const pointId = ids[0];
    if (pointId) return pointId;
    throw new NativeOperationError("Native addPointToContour returned no point ID");
  }

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
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

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
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

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
  reverseContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.reverseContour(contourId));
  }

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
  openContour(contourId: ContourId): void {
    this.#dispatchVoid(this.#raw.openContour(contourId));
  }

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
  setXAdvance(width: number): void {
    this.#dispatchVoid(this.#raw.setXAdvance(width));
  }

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
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

  /** @knipclassignore — used via Editor delegation or CommandEditingAPI */
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
