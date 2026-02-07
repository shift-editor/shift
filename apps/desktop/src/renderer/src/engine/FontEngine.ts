import type {
  GlyphSnapshot,
  FontMetadata,
  FontMetrics,
  PointId,
  ContourId,
  PointType,
} from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative, hasNative } from "./native";
import { NativeOperationError } from "./errors";
import { EditingManager } from "./editing";
import { SessionManager } from "./session";
import { InfoManager } from "./info";
import { IOManager } from "./io";
import type { FontEngineAPI, PointMove } from "@shared/bridge/FontEngineAPI";
import type { EngineCore, CommandResponse, PasteResult } from "@/types/engine";

export class FontEngine implements EngineCore {
  readonly editing: EditingManager;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly io: IOManager;

  readonly #$glyph: WritableSignal<GlyphSnapshot | null>;
  #raw: FontEngineAPI;

  constructor(raw?: FontEngineAPI) {
    this.#raw = raw ?? getNative();
    this.#$glyph = signal<GlyphSnapshot | null>(null);

    this.session = new SessionManager(this);
    this.editing = new EditingManager(this);
    this.info = new InfoManager(this);
    this.io = new IOManager(this);
  }

  get $glyph(): Signal<GlyphSnapshot | null> {
    return this.#$glyph;
  }

  hasSession(): boolean {
    return this.session.isActive();
  }

  getGlyph(): GlyphSnapshot | null {
    return this.#$glyph.value;
  }

  emitGlyph(glyph: GlyphSnapshot | null): void {
    this.#$glyph.set(glyph);
  }

  refreshGlyph(): void {
    this.#$glyph.set(this.getSnapshot());
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

  getGlyphCount(): number {
    return this.#raw.getGlyphCount();
  }

  getGlyphUnicodes(): number[] {
    return this.#raw.getGlyphUnicodes();
  }

  getGlyphSvgPath(unicode: number): string | null {
    return this.#raw.getGlyphSvgPath(unicode);
  }

  getGlyphAdvance(unicode: number): number | null {
    return this.#raw.getGlyphAdvance(unicode);
  }

  getGlyphBbox(unicode: number): [number, number, number, number] | null {
    return this.#raw.getGlyphBbox(unicode);
  }

  startEditSession(unicode: number): void {
    this.#raw.startEditSession(unicode);
  }

  endEditSession(): void {
    this.#raw.endEditSession();
  }

  hasEditSession(): boolean {
    return this.#raw.hasEditSession();
  }

  getEditingUnicode(): number | null {
    return this.#raw.getEditingUnicode();
  }

  addEmptyContour(): string {
    return this.#raw.addEmptyContour();
  }

  getActiveContourId(): ContourId | null {
    return this.#raw.getActiveContourId();
  }

  getSnapshot(): GlyphSnapshot {
    return JSON.parse(this.#raw.getSnapshotData()) as GlyphSnapshot;
  }

  restoreSnapshot(snapshot: GlyphSnapshot): void {
    const success = this.#raw.restoreSnapshot(JSON.stringify(snapshot));
    if (!success) {
      throw new NativeOperationError("Failed to restore snapshot");
    }
  }

  addPoint(x: number, y: number, pointType: PointType, smooth: boolean): CommandResponse {
    return this.#execute(this.#raw.addPoint(x, y, pointType, smooth));
  }

  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): CommandResponse {
    return this.#execute(this.#raw.addPointToContour(contourId, x, y, pointType, smooth));
  }

  movePoints(pointIds: PointId[], dx: number, dy: number): CommandResponse {
    return this.#execute(this.#raw.movePoints(pointIds, dx, dy));
  }

  removePoints(pointIds: PointId[]): CommandResponse {
    return this.#execute(this.#raw.removePoints(pointIds));
  }

  insertPointBefore(
    beforePointId: PointId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): CommandResponse {
    return this.#execute(this.#raw.insertPointBefore(beforePointId, x, y, pointType, smooth));
  }

  toggleSmooth(pointId: PointId): CommandResponse {
    return this.#execute(this.#raw.toggleSmooth(pointId));
  }

  addContour(): CommandResponse {
    return this.#execute(this.#raw.addContour());
  }

  closeContour(): CommandResponse {
    return this.#execute(this.#raw.closeContour());
  }

  setActiveContour(contourId: ContourId): CommandResponse {
    return this.#execute(this.#raw.setActiveContour(contourId));
  }

  clearActiveContour(): CommandResponse {
    return this.#execute(this.#raw.clearActiveContour());
  }

  reverseContour(contourId: ContourId): CommandResponse {
    return this.#execute(this.#raw.reverseContour(contourId));
  }

  removeContour(contourId: ContourId): CommandResponse {
    return this.#execute(this.#raw.removeContour(contourId));
  }

  openContour(contourId: ContourId): CommandResponse {
    return this.#execute(this.#raw.openContour(contourId));
  }

  setPointPositions(moves: PointMove[]): boolean {
    return this.#raw.setPointPositions(moves);
  }

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult {
    return this.#parsePasteResult(this.#raw.pasteContours(contoursJson, offsetX, offsetY));
  }

  #execute(json: string): CommandResponse {
    const raw = JSON.parse(json);
    if (!raw.success) {
      throw new NativeOperationError(raw.error ?? "Unknown native error");
    }

    const { snapshot, affectedPointIds } = raw;
    return {
      snapshot,
      affectedPointIds,
    };
  }

  #parsePasteResult(json: string): PasteResult {
    const raw = JSON.parse(json);
    const { success, createdPointIds, createdContourIds, error } = raw;

    return {
      success,
      createdPointIds,
      createdContourIds,
      error,
    };
  }
}

export function createFontEngine(): FontEngine {
  if (hasNative()) {
    return new FontEngine();
  }

  console.warn("Native FontEngine not available, using mock implementation");
  throw new Error("MockFontEngine not yet implemented");
}
