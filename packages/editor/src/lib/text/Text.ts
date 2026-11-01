import {
  mintRunId,
  type GlyphId,
  type GlyphName,
  type NodeId,
  type RunId,
  type TextItemId,
} from "@shift/types";
import { computed, effect, keyedCache, signal, track, untracked } from "../signals";
import type { ComputedSignal, Effect, Signal } from "../signals";
import type { Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { PageNode, TextRunNode } from "../../types/node";
import type {
  ParsedText,
  RunContent,
  RunPlacement,
  TextLayoutFailure,
  TextRunRecord,
} from "../../types/text";
import {
  characterTextItem,
  glyphTextItem,
  glyphIdForItem,
  lineBreakTextItem,
  typedTextItems,
  type TextItem,
  type TextLayout,
} from "./layout";
import type { TextLayout as LaidOutText, ProofTextItem } from "@shift/wasm/protocol";
import { proofTexts } from "@shift/wasm";
import { RunText } from "./RunText";

/**
 * Owns proof text: each run's items, kept in the scene's text run nodes, and
 * one reactive layout per run identity.
 */
export class Text {
  readonly #editor: Editor;
  readonly #glyphsLoadedCell = signal(0);
  // non-reactive: dedupes in-flight glyph loads; only read by the imperative load path
  readonly #loading = new Map<GlyphId, Promise<void>>();
  readonly #runsByItem: ComputedSignal<ReadonlyMap<TextItemId, TextRunRecord>>;
  // non-reactive: run nodes placed this session that go again if editing leaves them empty;
  // read only when editing ends.
  readonly #provisionalRuns = new Set<NodeId>();
  readonly #acquiring: Effect;
  /** The last reason text could not be shaped, so each is said once. */
  #lastUnshapable: string | null = null;
  readonly #runs = keyedCache({
    name: "text.run",
    key: (runId: RunId) => runId,
    dispose: (runText: RunText) => runText.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      // Created on a layout's first read; its shaping effect must not join that computed.
      untracked(
        () =>
          new RunText(this.#editor, runIdCell, {
            run: (id) => this.run(id),
            glyphsLoadedCell: this.#glyphsLoadedCell,
            onLaidOut: (laidOut) => this.#acquireLaidOutGlyphs(laidOut),
          }),
      ),
  });

  /**
   * The first run whose text has no layout, or whose layout could not load
   * what it shows, with why; null while every run lays out. The editor
   * shows it, so a failed layout is never just an empty run.
   */
  readonly layoutFailureCell: ComputedSignal<TextLayoutFailure | null> = computed(
    () => {
      for (const runId of this.#editor.scene.runsCell.value.keys()) {
        const failure = this.#runs.get(runId).failureCell.value;
        if (failure) return failure;
      }
      return null;
    },
    { name: "text.layoutFailure" },
  );

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#runsByItem = computed(
      () => {
        const runs = new Map<TextItemId, TextRunRecord>();
        for (const run of editor.scene.runsCell.value.values()) {
          for (const item of run.items) runs.set(item.id, run);
        }
        return runs;
      },
      { name: "text.runsByItem" },
    );
    // Loads the glyphs each run that arrived or changed shows.
    let acquired: ReadonlyMap<RunId, TextRunRecord> = new Map();
    this.#acquiring = effect(
      () => {
        const runs = editor.scene.runsCell.value;
        for (const [id, run] of runs) {
          if (acquired.get(id) !== run) untracked(() => this.#acquireGlyphs(run.items));
        }
        acquired = runs;
      },
      { name: "text.acquireGlyphs" },
    );
  }

  /** Returns the run holding an item and the item itself, or null for an unknown id. */
  itemLocation(id: TextItemId): { readonly run: TextRunRecord; readonly item: TextItem } | null {
    const run = this.runForItem(id);
    const item = run?.items.find((candidate) => candidate.id === id);
    return run && item ? { run, item } : null;
  }

  /**
   * Returns a new item that shows a glyph in the font.
   *
   * @remarks
   * A glyph the font maps a character to becomes that character, so it takes
   * part in shaping like typed text; any other glyph is picked by identity.
   *
   * @returns null when the glyph is not in the font.
   */
  glyphItem(glyphId: GlyphId): TextItem | null {
    const font = this.#editor.font;
    const entry = font.entryForId(glyphId);
    if (!entry) return null;
    const typed = entry.unicodes.find((unicode) => font.entryForUnicode(unicode)?.id === glyphId);
    return typed === undefined ? glyphTextItem(glyphId) : characterTextItem(typed);
  }

  /**
   * Returns the glyph an item shows in its run's layout.
   *
   * @returns null for a line break, an unknown item, or a character the font maps no glyph to.
   */
  glyphIdForItem(id: TextItemId): GlyphId | null {
    const run = this.runForItem(id);
    if (!run) return null;
    return this.layout(run.id)?.placedGlyphForItem(id)?.glyph.glyphId ?? null;
  }

  /**
   * Returns a run's content.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns only when this run changes.
   */
  run(id: RunId | null): TextRunRecord | null {
    if (!id) return null;
    return this.#editor.scene.run(id);
  }

  /**
   * Returns the items of the run a node places.
   *
   * @remarks
   * Reactive like {@link run}. Empty when the run record is gone.
   */
  items(node: TextRunNode): readonly TextItem[] {
    return this.run(node.runId)?.items ?? [];
  }

  /**
   * Returns the run holding an item, or null for an unknown item.
   *
   * @remarks
   * Reactive: the reader reruns when the item is added to or removed from a run.
   */
  runForItem(id: TextItemId): TextRunRecord | null {
    track(this.#runsByItem);
    return this.#runsByItem.peek().get(id) ?? null;
  }

  /** Replaces a run's items; the run's definition removes a child whose item went (`onContentChange`). */
  setItems(id: RunId, items: readonly TextItem[]): void {
    this.#editor.scene.setRunItems(id, items);
  }

  /**
   * Inserts items into a run directly after one of its items.
   *
   * @returns false when the run or `afterId` is missing.
   */
  insertAfter(id: RunId, afterId: TextItemId, items: readonly TextItem[]): boolean {
    const current = this.run(id)?.items;
    const index = current?.findIndex((item) => item.id === afterId) ?? -1;
    if (!current || index < 0) return false;

    this.setItems(id, [...current.slice(0, index + 1), ...items, ...current.slice(index + 1)]);
    return true;
  }

  /**
   * Places a new text run on a page: the only way a run node is made.
   *
   * @remarks
   * The run is set at the font's units per em, so its glyphs show at font
   * size. A run placed empty, to type into, is provisional: if text editing
   * leaves it with nothing typed, {@link leaveRun} removes it again. Placing is
   * not an undo step; what is typed into the run is.
   *
   * @returns the run node.
   */
  placeRun({ page, at, glyphs }: RunPlacement): TextRunNode {
    const items = glyphs.flatMap((glyphId) => this.glyphItem(glyphId) ?? []);
    const node = this.#editor.history.withoutRecording(() => this.#createRun(page, at, items));
    if (items.length === 0) this.#provisionalRuns.add(node.id);
    return node;
  }

  /**
   * Places a new run holding `items` on a page as one undo step, as typing
   * into a placed run is one; the run is never provisional.
   *
   * @returns the run node.
   * @throws When another history capture is open, or the document refuses the node.
   */
  addRun({ page, at, items }: RunContent): TextRunNode {
    return this.#editor.history.capture("Add text", () => this.#createRun(page, at, items));
  }

  /** Builds a run node set at the font's units per em: {@link placeRun} and {@link addRun} only. */
  #createRun(page: PageNode, at: Point2D, items: readonly TextItem[]): TextRunNode {
    return this.#editor.scene.createNode<TextRunNode>(
      {
        kind: "textRun",
        parentId: page.id,
        runId: mintRunId(),
        size: this.#editor.font.metricsCell.peek().unitsPerEm,
        position: { x: at.x, y: at.y },
      },
      items,
    );
  }

  /**
   * Called when text editing leaves a run node: a provisional run left empty
   * is removed, without an undo step; one with text in it is kept for good.
   */
  leaveRun(nodeId: NodeId): void {
    if (!this.#provisionalRuns.delete(nodeId)) return;

    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    if (!node || this.items(node).length > 0) return;

    this.#editor.history.withoutRecording(() => this.#editor.scene.deleteNode(node.id));
  }

  /** Returns a stable computed whose layout invalidates on content, location, source, or glyph acquisition. */
  layoutCell(id: RunId): ComputedSignal<TextLayout | null> {
    return this.#runs.get(id).layoutCell;
  }

  /**
   * Why a run has no layout, or what its layout needed that did not load
   * (glyphs into the engine, or a preview's layout module); null while it
   * lays out and loads what it shows.
   */
  runLayoutFailureCell(id: RunId): Signal<TextLayoutFailure | null> {
    return this.#runs.get(id).failureCell;
  }

  /**
   * The run's layout now, without subscribing; reactive readers use {@link layoutCell}.
   *
   * @returns null when the run cannot lay out.
   */
  layout(id: RunId): TextLayout | null {
    return this.layoutCell(id).peek();
  }

  /**
   * Reads pasted or imported proof text into items, as shift-font's
   * `ProofText` parses it: `/name` picks the glyph named `name` (the name
   * ends at a space, which it consumes), `//` is a slash and `\n` a line
   * break.
   *
   * @remarks
   * Lenient, as pasting must be: a `/name` the font lacks stays as its
   * characters, and text that is not proof text (a `/` naming nothing) is
   * taken character by character.
   */
  itemsFromText(text: string): TextItem[] {
    let parsed: readonly ProofTextItem[];
    try {
      parsed = proofTexts.parse(text);
    } catch {
      return typedTextItems(text);
    }
    return parsed.flatMap(
      (item) => this.#textItems(item) ?? typedTextItems(proofTexts.format([item])),
    );
  }

  /**
   * Reads proof text as {@link itemsFromText} does, strictly: each `/name`
   * the font lacks is reported rather than kept as text.
   *
   * @throws {PackError} carrying a `ProofTextFailure` for text that is not
   * proof text, such as a `/` naming nothing.
   */
  parseText(text: string): ParsedText {
    const unknownGlyphNames: GlyphName[] = [];
    const items = proofTexts.parse(text).flatMap((item) => {
      const items = this.#textItems(item);
      if (!items && item.kind === "glyph") unknownGlyphNames.push(item.name);
      return items ?? [];
    });
    return { items, unknownGlyphNames };
  }

  /**
   * Writes items as proof text, as shift-font's `ProofText` formats it, so
   * {@link parseText} reads them back as the same items. A picked glyph the
   * font no longer has is left out.
   *
   * @throws {PackError} carrying a `ProofTextFailure` for a glyph name that
   * cannot be written as `/name` (one with a space in it).
   */
  formatItems(items: readonly TextItem[]): string {
    const font = this.#editor.font;
    return proofTexts.format(
      items.flatMap((item): ProofTextItem[] => {
        switch (item.kind) {
          case "character":
            return [{ kind: "character", codepoint: item.codepoint }];
          case "linebreak":
            return [{ kind: "lineBreak" }];
          case "glyph": {
            const name = font.glyphName(item.glyphId);
            return name ? [{ kind: "glyph", name }] : [];
          }
        }
      }),
    );
  }

  /** The editor items for one parsed item; null for a glyph name the font lacks. */
  #textItems(item: ProofTextItem): TextItem[] | null {
    switch (item.kind) {
      case "character":
        return [characterTextItem(item.codepoint)];
      case "lineBreak":
        return [lineBreakTextItem()];
      case "glyph": {
        const entry = this.#editor.font.entryForName(item.name);
        const picked = entry ? this.glyphItem(entry.id) : null;
        return picked ? [picked] : null;
      }
    }
  }

  /**
   * Resolves once every glyph text needs has loaded.
   *
   * @remarks
   * Loading a glyph can reshape text and ask for more glyphs, so this waits
   * until a pass finds nothing pending.
   */
  async settled(): Promise<void> {
    for (;;) {
      const loads = this.#loading.values().toArray();
      if (loads.length === 0) return;
      await Promise.all(loads);
    }
  }

  dispose(): void {
    this.layoutFailureCell.dispose();
    this.#acquiring.dispose();
    this.#runsByItem.dispose();
    this.#runs.clear();
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind === "linebreak") continue;
      const glyphId = glyphIdForItem(item, this.#editor.font);
      if (glyphId && !this.#editor.glyphForId(glyphId)) void this.#loadGlyph(glyphId);
    }
  }

  /** Loads glyphs the shaper substituted in, which no item names directly. */
  /** Loads the glyphs a layout shows that are not loaded yet, such as ones shaping substituted in. */
  #acquireLaidOutGlyphs(laidOut: LaidOutText): void {
    if (laidOut.unshaped) this.#reportUnshapable(laidOut.unshaped);
    for (const glyph of laidOut.glyphs) {
      if (glyph.glyphId && !this.#editor.glyphForId(glyph.glyphId)) {
        void this.#loadGlyph(glyph.glyphId);
      }
    }
  }

  /** Says why text could not be shaped, once for each reason in a row. */
  #reportUnshapable(reason: string): void {
    if (reason === this.#lastUnshapable) return;
    this.#lastUnshapable = reason;
    console.warn(`text lays out unshaped: ${reason}`);
  }

  #loadGlyph(id: GlyphId): Promise<void> {
    const pending = this.#loading.get(id);
    if (pending) return pending;
    const load = this.#loadGlyphOnce(id);
    this.#loading.set(id, load);
    return load;
  }

  async #loadGlyphOnce(id: GlyphId): Promise<void> {
    try {
      await this.#editor.font.loadGlyph(id);
      this.#glyphsLoadedCell.update((version) => version + 1);
    } catch (error) {
      console.error("failed to load text glyph", error);
    } finally {
      this.#loading.delete(id);
    }
  }
}
