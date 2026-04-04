import type { GlyphSnapshot, FontMetadata, FontMetrics, ContourId } from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative } from "./native";
import { NativeOperationError } from "./errors";
import { EditingManager, type EditingEngineDeps } from "./editing";
import type {
  FontEngineAPI,
  NodePositionUpdate as BridgeNodePositionUpdate,
} from "@shared/bridge/FontEngineAPI";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";
import type { PasteResult } from "@/types/engine";
import { Bounds } from "@shift/geo";
import type { GlyphRef } from "@/lib/tools/text/layout";

/**
 * Owns the raw NAPI bridge and the reactive {@link $glyph} signal.
 * Provides font queries, session lifecycle, and editing (via {@link EditingManager}).
 */
export class FontEngine implements EditingEngineDeps {
  readonly editing: EditingManager;

  readonly #$glyph: WritableSignal<GlyphSnapshot | null>;
  #raw: FontEngineAPI;

  constructor(raw?: FontEngineAPI) {
    this.#raw = raw ?? getNative();
    this.#$glyph = signal<GlyphSnapshot | null>(null);

    this.editing = new EditingManager(this);
  }

  /** Reactive glyph snapshot. Updated by {@link emitGlyph} and {@link refreshGlyph}; null when no session is active. */
  get $glyph(): Signal<GlyphSnapshot | null> {
    return this.#$glyph;
  }

  get raw(): FontEngineAPI {
    return this.#raw;
  }

  hasSession(): boolean {
    return this.#raw.hasEditSession();
  }

  /** No-op if the same glyph is already active; ends the previous session if a different glyph is active. */
  startEditSession(target: GlyphRef): void {
    if (this.hasSession()) {
      const currentName = this.getEditingGlyphName();
      if (currentName === target.glyphName) return;
      this.endEditSession();
    }
    this.#raw.startEditSession(target);
    const glyph = this.getSessionGlyph();
    this.emitGlyph(glyph);
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

  setNodePositions(updates: BridgeNodePositionUpdate[]): boolean {
    return this.#raw.setNodePositions(updates);
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
