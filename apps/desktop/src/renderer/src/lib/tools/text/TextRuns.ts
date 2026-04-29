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
} from "@/lib/reactive/signal";
import { TextRun } from "./TextRun";
import type { Positioner } from "./layout";
import type { Font } from "@/lib/model/Font";
import type { TextBufferSnapshot } from "./TextBuffer";

const DEFAULT_RUN_KEY = "__default__";

export interface PersistedTextRun {
  buffer: TextBufferSnapshot;
}

export class TextRuns {
  readonly #runs: Map<string, TextRun>;
  readonly #$activeKey: WritableSignal<string>;
  readonly #$active: ComputedSignal<TextRun>;
  readonly #font: Font;
  readonly #positioner: Positioner;

  constructor(font: Font, positioner: Positioner) {
    this.#runs = new Map();
    this.#$activeKey = signal(DEFAULT_RUN_KEY);
    this.#font = font;
    this.#positioner = positioner;
    this.#$active = computed(() => this.#getOrCreate(this.#$activeKey.value));
  }

  /** The currently-active run. Lazily creates one for the active key if needed. */
  get active(): TextRun {
    return this.#$active.value;
  }

  /** Reactive view of the active run — fires on `switchTo`. */
  get $active(): Signal<TextRun> {
    return this.#$active;
  }

  /**
   * Switch active run to the one keyed by `glyphName` (or default if null).
   * Returns the now-active run for chaining.
   */
  switchTo(glyphName: string | null): TextRun {
    const key = glyphName ?? DEFAULT_RUN_KEY;
    this.#$activeKey.set(key);
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
  }

  serialize(): Record<string, PersistedTextRun> {
    const out: Record<string, PersistedTextRun> = {};
    for (const [key, run] of this.#runs) {
      if (key === DEFAULT_RUN_KEY) continue;
      const buffer = run.buffer.snapshot();
      if (buffer.cells && buffer.cells.length > 0) {
        out[key] = { buffer };
      }
    }
    return out;
  }

  deserialize(persisted: Record<string, PersistedTextRun>): void {
    this.#runs.clear();
    for (const [key, entry] of Object.entries(persisted)) {
      const run = new TextRun(this.#font, this.#positioner);
      run.buffer.restore(entry.buffer);
      this.#runs.set(key, run);
    }
    if (!this.#runs.has(this.#$activeKey.peek())) {
      this.#$activeKey.set(DEFAULT_RUN_KEY);
    }
  }

  #getOrCreate(key: string): TextRun {
    let run = this.#runs.get(key);
    if (run) return run;
    run = new TextRun(this.#font, this.#positioner);
    this.#runs.set(key, run);
    return run;
  }
}
