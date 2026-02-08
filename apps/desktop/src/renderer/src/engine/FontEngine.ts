import type { GlyphSnapshot, FontMetadata, FontMetrics, ContourId } from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative, hasNative } from "./native";
import { NativeOperationError } from "./errors";
import { EditingManager } from "./editing";
import { SessionManager } from "./session";
import { InfoManager } from "./info";
import { IOManager } from "./io";
import type { FontEngineAPI, PointMove } from "@shared/bridge/FontEngineAPI";
import type { EngineCore, PasteResult } from "@/types/engine";
import { Bounds } from "@shift/geo";

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

  get raw(): FontEngineAPI {
    return this.#raw;
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

  getGlyphBbox(unicode: number): Bounds | null {
    const bbox = this.#raw.getGlyphBbox(unicode);
    if (!bbox) return null;

    return Bounds.create({ x: bbox[0], y: bbox[1] }, { x: bbox[2], y: bbox[3] });
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

  setPointPositions(moves: PointMove[]): boolean {
    return this.#raw.setPointPositions(moves);
  }

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult {
    const raw = JSON.parse(this.#raw.pasteContours(contoursJson, offsetX, offsetY));
    return {
      success: raw.success,
      createdPointIds: raw.createdPointIds,
      createdContourIds: raw.createdContourIds,
      error: raw.error,
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
