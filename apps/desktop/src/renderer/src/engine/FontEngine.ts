import type { GlyphSnapshot, CommandResult } from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative, hasNative, type NativeFontEngine } from "./native";
import { NativeOperationError } from "./errors";
import { EditingManager } from "./editing";
import { SessionManager } from "./session";
import { InfoManager } from "./info";
import { IOManager } from "./io";
import type { EngineCore } from "@/types/engine";

export class FontEngine implements EngineCore {
  readonly editing: EditingManager;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly io: IOManager;

  readonly #$glyph: WritableSignal<GlyphSnapshot | null>;
  #native: NativeFontEngine;

  constructor(native?: NativeFontEngine) {
    this.#native = native ?? getNative();
    this.#$glyph = signal<GlyphSnapshot | null>(null);

    this.session = new SessionManager(this);
    this.editing = new EditingManager(this);
    this.info = new InfoManager(this);
    this.io = new IOManager(this);
  }

  get native(): NativeFontEngine {
    return this.#native;
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

  commit(operation: () => string): void;
  commit<T>(operation: () => string, extract: (result: CommandResult) => T): T;
  commit<T = void>(operation: () => string, extract?: (result: CommandResult) => T): T {
    const json = operation();
    const result = this.#parseCommandResult(json);

    if (!result.success) {
      throw new NativeOperationError(result.error ?? "Unknown native error");
    }

    if (result.snapshot) {
      this.#$glyph.set(result.snapshot);
    }

    return extract ? extract(result) : (undefined as T);
  }

  emitGlyph(glyph: GlyphSnapshot | null): void {
    this.#$glyph.set(glyph);
  }

  refreshGlyph(): void {
    const glyph = this.session.getGlyph();
    this.#$glyph.set(glyph);
  }

  #parseCommandResult(json: string): CommandResult {
    const raw = JSON.parse(json) as CommandResult;
    return {
      success: raw.success,
      snapshot: raw.snapshot ?? null,
      error: raw.error ?? null,
      affectedPointIds: raw.affectedPointIds ?? null,
      canUndo: raw.canUndo ?? false,
      canRedo: raw.canRedo ?? false,
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
