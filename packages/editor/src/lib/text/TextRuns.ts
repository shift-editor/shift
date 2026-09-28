/**
 * TextRuns — per-glyph store of TextRun instances.
 *
 * One TextRun per glyph name (each glyph carries its own typing context
 * across glyph editing changes). Plus a default-active run keyed by `__default__`
 * for cases where no specific glyph owns the run yet.
 *
 * Active run is selected via `switchTo(glyphName | null)`, which returns
 * the now-active run for ergonomic chaining.
 */
import {
  batch,
  signal,
  computed,
  track,
  type Signal,
  type WritableSignal,
  type ComputedSignal,
} from "../signals/signal";
import { TextRun } from "./TextRun";
import type { FocusedGlyph } from "./TextRun";
import type { Positioner } from "./layout";
import type { Editor } from "../editor/Editor";
import type { TextBufferSnapshot } from "./TextBuffer";
import type { GlyphAnchor } from "./layout";

const DEFAULT_RUN_KEY = "__default__";
export const EDITOR_RUN_ID = "__editor__";

export interface PersistedTextRun {
  buffer: TextBufferSnapshot;
}

export class TextRuns {
  readonly #runsCell: WritableSignal<ReadonlyMap<string, TextRun>>;
  readonly #activeKey: WritableSignal<string>;
  readonly #active: ComputedSignal<TextRun>;
  readonly #editor: Editor;
  readonly #positioner: Positioner;
  readonly #editorRun: TextRun;

  constructor(editor: Editor, positioner: Positioner) {
    this.#editor = editor;
    this.#positioner = positioner;
    this.#runsCell = signal<ReadonlyMap<string, TextRun>>(
      new Map([[DEFAULT_RUN_KEY, this.#createRun(DEFAULT_RUN_KEY)]]),
      { name: "textRuns.runs" },
    );
    this.#activeKey = signal(DEFAULT_RUN_KEY);
    this.#editorRun = new TextRun(EDITOR_RUN_ID, this.#editor, this.#positioner);
    // Every writer of the active key ensures its run exists first.
    this.#active = computed(() => this.#runsCell.value.get(this.#activeKey.value)!);
  }

  /** The currently-active run. */
  get active(): TextRun {
    return this.#active.peek();
  }

  /** Reactive view of the active run — fires on `switchTo`. */
  get activeCell(): Signal<TextRun> {
    return this.#active;
  }

  /**
   * Return the implicit one-glyph run used by legacy text-glyph focus.
   *
   *   editorRun.setSingleGlyph(S)
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
    this.#ensureRun(key);
    this.#activeKey.set(key);
    return this.active;
  }

  /** @knipclassignore — used by tool deactivation paths (TODO) */
  clear(): void {
    const run = this.active;
    run.buffer.clear();
    run.interaction.clear();
  }

  /** Drop every run; the active key restarts with an empty run. */
  clearAll(): void {
    this.#runsCell.set(new Map());
    this.#ensureRun(this.#activeKey.peek());
    this.#editorRun.buffer.clear();
    this.#editorRun.interaction.clear();
  }

  get(runId: string): TextRun | null {
    if (runId === EDITOR_RUN_ID) return this.#editorRun;
    track(this.#runsCell);
    return this.#runsCell.peek().get(runId) ?? null;
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
    for (const [key, run] of this.#runsCell.peek()) {
      if (key === DEFAULT_RUN_KEY) continue;
      const buffer = run.buffer.snapshot();
      if (buffer.items && buffer.items.length > 0) {
        out[key] = { buffer };
      }
    }
    return out;
  }

  deserialize(persisted: Record<string, PersistedTextRun>): void {
    const runs = new Map<string, TextRun>();
    for (const [key, entry] of Object.entries(persisted)) {
      const run = this.#createRun(key);
      run.buffer.restore(entry.buffer);
      runs.set(key, run);
    }

    const key = this.#activeKey.peek();
    const targetKey = runs.has(key) ? key : DEFAULT_RUN_KEY;
    if (!runs.has(targetKey)) runs.set(targetKey, this.#createRun(targetKey));

    batch(() => {
      this.#runsCell.set(runs);
      this.#activeKey.set(targetKey);
    });
  }

  #ensureRun(key: string): void {
    const runs = this.#runsCell.peek();
    if (runs.has(key)) return;

    this.#runsCell.set(new Map(runs).set(key, this.#createRun(key)));
  }

  #createRun(key: string): TextRun {
    return new TextRun(key, this.#editor, this.#positioner);
  }
}
