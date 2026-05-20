/**
 * TextRuns — per-glyph store of TextRun instances.
 *
 * One TextRun per glyph name (each glyph carries its own typing context
 * across edit sessions). Plus a default-active run keyed by `__default__`
 * for cases where no specific glyph owns the run yet.
 *
 * Active run is selected via `switchTo(glyphName | null)`, which returns
 * the now-active run for ergonomic chaining.
 */
import {
  signal,
  computed,
  type Signal,
  type WritableSignal,
  type ComputedSignal,
} from "@/lib/signals/signal";
import { TextRun } from "./TextRun";
import type { FocusedGlyph } from "./TextRun";
import type { Positioner } from "./layout";
import type { Font } from "@/lib/model/Font";
import type { TextBufferSnapshot } from "./TextBuffer";
import type { GlyphAnchor } from "./layout";
import type { AxisLocation } from "@/types/variation";

const DEFAULT_RUN_KEY = "__default__";
export const EDITOR_RUN_ID = "__editor__";

export interface PersistedTextRun {
  buffer: TextBufferSnapshot;
}

export class TextRuns {
  readonly #runs: Map<string, TextRun>;
  readonly #activeKey: WritableSignal<string>;
  readonly #active: ComputedSignal<TextRun>;
  readonly #font: Font;
  readonly #positioner: Positioner;
  readonly #designLocation: Signal<AxisLocation>;
  readonly #editorRun: TextRun;

  constructor(font: Font, positioner: Positioner, designLocation: Signal<AxisLocation>) {
    this.#runs = new Map();
    this.#activeKey = signal(DEFAULT_RUN_KEY);
    this.#font = font;
    this.#positioner = positioner;
    this.#designLocation = designLocation;
    this.#editorRun = new TextRun(
      EDITOR_RUN_ID,
      this.#font,
      this.#positioner,
      this.#designLocation,
    );
    this.#active = computed(() => this.#getOrCreate(this.#activeKey.value));
  }

  /** The currently-active run. Lazily creates one for the active key if needed. */
  get active(): TextRun {
    return this.#active.peek();
  }

  /** Reactive view of the active run — fires on `switchTo`. */
  get activeCell(): Signal<TextRun> {
    return this.#active;
  }

  /**
   * Return the implicit one-glyph run used by direct glyph editing.
   *
   *   openGlyph(S)
   *      │
   *      ▼
   *   editorRun = [S(id=s1)]
   *      │
   *      ▼
   *   GlyphAnchor { runId: "__editor__", itemId: s1 }
   *      │
   *      ▼
   *   TextLayout.editOriginForItem(s1)
   *      │
   *      ▼
   *   drawOffset
   */
  editorRun(): TextRun {
    return this.#editorRun;
  }

  /**
   * Switch active run to the one keyed by `glyphName` (or default if null).
   * Returns the now-active run for chaining.
   */
  switchTo(glyphName: string | null): TextRun {
    const key = glyphName ?? DEFAULT_RUN_KEY;
    this.#activeKey.set(key);
    return this.active;
  }

  /** @knipclassignore — used by tool deactivation paths (TODO) */
  clear(): void {
    const run = this.active;
    run.buffer.clear();
    run.interaction.clear();
  }

  /** Drop every run. */
  clearAll(): void {
    this.#runs.clear();
    this.#editorRun.buffer.clear();
    this.#editorRun.interaction.clear();
  }

  get(runId: string): TextRun | null {
    if (runId === EDITOR_RUN_ID) return this.#editorRun;
    return this.#runs.get(runId) ?? null;
  }

  resolveAnchor(anchor: GlyphAnchor): FocusedGlyph | null {
    const run = this.get(anchor.runId);
    if (!run) return null;
    // oxlint-disable-next-line shift/no-reactive-value-outside-boundary -- Anchor resolution is used by TextEditingState.focusedGlyph to track layout-driven edit origins.
    run.layoutCell.value;
    return run.resolveAnchor(anchor);
  }

  serialize(): Record<string, PersistedTextRun> {
    const out: Record<string, PersistedTextRun> = {};
    for (const [key, run] of this.#runs) {
      if (key === DEFAULT_RUN_KEY) continue;
      const buffer = run.buffer.snapshot();
      if (buffer.items && buffer.items.length > 0) {
        out[key] = { buffer };
      }
    }
    return out;
  }

  deserialize(persisted: Record<string, PersistedTextRun>): void {
    this.#runs.clear();
    for (const [key, entry] of Object.entries(persisted)) {
      const run = new TextRun(key, this.#font, this.#positioner, this.#designLocation);
      run.buffer.restore(entry.buffer);
      this.#runs.set(key, run);
    }

    // Force `activeCell` to re-resolve from the now-populated Map. Without this,
    // any consumer that already read `activeCell.value` before deserialize ran
    // (e.g., the Editor's auto-save effect during construction) holds a
    // stale reference to a pre-load empty TextRun — and any subsequent fire
    // of the effect serializes that empty state back over the loaded data.
    // The Map itself isn't a signal, so we toggle `activeKey` through a
    // sentinel to bypass the computed's equality skip.
    const key = this.#activeKey.peek();
    const targetKey = this.#runs.has(key) ? key : DEFAULT_RUN_KEY;
    this.#activeKey.set("__force_recompute__");
    this.#activeKey.set(targetKey);
  }

  #getOrCreate(key: string): TextRun {
    let run = this.#runs.get(key);
    if (run) return run;
    run = new TextRun(key, this.#font, this.#positioner, this.#designLocation);
    this.#runs.set(key, run);
    return run;
  }
}
