import type { GlyphSnapshot, FontMetadata, FontMetrics, ContourId } from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative, hasNative } from "./native";
import { NativeOperationError } from "./errors";
import { EditingManager, type EditingEngineDeps } from "./editing";
import { SessionManager, type Session } from "./session";
import { InfoManager, type Info } from "./info";
import { IOManager, type IO } from "./io";
import type {
  FontEngineAPI,
  PointPositionUpdate,
  AnchorPositionUpdate,
} from "@shared/bridge/FontEngineAPI";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";
import type { PasteResult } from "@/types/engine";
import { Bounds } from "@shift/geo";

/**
 * Facade over the four engine managers ({@link EditingManager}, {@link SessionManager},
 * {@link InfoManager}, {@link IOManager}), each receiving a focused dep-interface slice.
 *
 * Owns the raw NAPI bridge and the reactive {@link $glyph} signal. Consumers interact
 * with the managers (`engine.editing`, `engine.session`, etc.) rather than calling
 * FontEngine methods directly.
 */
export class FontEngine implements EditingEngineDeps, Session, Info, IO {
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

  /** Reactive glyph snapshot. Updated by {@link emitGlyph} and {@link refreshGlyph}; null when no session is active. */
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

  /** Directly sets the glyph signal. Use when you already have a snapshot (e.g. optimistic update). */
  emitGlyph(glyph: GlyphSnapshot | null): void {
    this.#$glyph.set(glyph);
  }

  /** Re-reads the glyph from the native engine and emits it. Use after mutations that bypass {@link emitGlyph}. */
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

  getGlyphNameForUnicode(unicode: number): string | null {
    return this.#raw.getGlyphNameForUnicode(unicode);
  }

  getGlyphUnicodesForName(glyphName: string): number[] {
    return this.#raw.getGlyphUnicodesForName(glyphName);
  }

  getDependentUnicodes(unicode: number): number[] {
    return this.#raw.getDependentUnicodes(unicode);
  }

  getDependentUnicodesByName(glyphName: string): number[] {
    return this.#raw.getDependentUnicodesByName(glyphName);
  }

  getGlyphSvgPath(unicode: number): string | null {
    return this.#raw.getGlyphSvgPath(unicode);
  }

  getGlyphSvgPathByName(glyphName: string): string | null {
    return this.#raw.getGlyphSvgPathByName(glyphName);
  }

  getGlyphAdvance(unicode: number): number | null {
    return this.#raw.getGlyphAdvance(unicode);
  }

  getGlyphAdvanceByName(glyphName: string): number | null {
    return this.#raw.getGlyphAdvanceByName(glyphName);
  }

  getGlyphBbox(unicode: number): Bounds | null {
    const bbox = this.#raw.getGlyphBbox(unicode);
    if (!bbox) return null;

    return Bounds.create({ x: bbox[0], y: bbox[1] }, { x: bbox[2], y: bbox[3] });
  }

  getGlyphBboxByName(glyphName: string): Bounds | null {
    const bbox = this.#raw.getGlyphBboxByName(glyphName);
    if (!bbox) return null;
    return Bounds.create({ x: bbox[0], y: bbox[1] }, { x: bbox[2], y: bbox[3] });
  }

  getGlyphCompositeComponents(glyphName: string): CompositeComponentsPayload | null {
    const payload = this.#raw.getGlyphCompositeComponents(glyphName);
    if (!payload) return null;
    return JSON.parse(payload) as CompositeComponentsPayload;
  }

  startEditSession(unicode: number): void {
    this.#raw.startEditSession(unicode);
  }

  startEditSessionByName(glyphName: string): void {
    this.#raw.startEditSessionByName(glyphName);
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

  getEditingGlyphName(): string | null {
    return this.#raw.getEditingGlyphName();
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

  setPointPositions(updates: PointPositionUpdate[]): boolean {
    return this.#raw.setPointPositions(updates);
  }

  setAnchorPositions(updates: AnchorPositionUpdate[]): boolean {
    return this.#raw.setAnchorPositions(updates);
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

/** Creates a FontEngine backed by the native NAPI bridge. Throws if unavailable (tests should pass a mock to the constructor instead). */
export function createFontEngine(): FontEngine {
  if (hasNative()) {
    return new FontEngine();
  }

  console.warn("Native FontEngine not available, using mock implementation");
  throw new Error("MockFontEngine not yet implemented");
}
