import type { GlyphId, RunId } from "@shift/types";
import type {
  CharacterGlyph,
  LayoutRequest,
  LayoutUnit,
  PlacedText,
  TextLayout as LaidOutText,
  TypedFont,
  TypedGlyph,
} from "@shift/wasm/protocol";
import { computed, effect, track } from "../signals";
import type { ComputedSignal, Effect, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextPlace, TextRunRecord } from "../../types/text";
import { engineModuleCell, loadEngine } from "../wasm/engine";
import { glyphIdForItem, TextLayout, type TextItem } from "./layout";

/** What a run's text reads from the {@link Text} that owns it. */
export interface RunTextOwner {
  /** Reactive like `Text.run`. */
  run(id: RunId): TextRunRecord | null;
  /** Bumped when a glyph the text shows finishes loading. */
  readonly glyphsLoadedCell: Signal<number>;
  /** Called with each layout Rust returns, such as to load the glyphs shaping substituted in. */
  onLaidOut(laidOut: LaidOutText): void;
}

/**
 * Keeps one run's text laid out.
 *
 * @remarks
 * Layout runs synchronously in the window's engine (`Font.layoutText`,
 * shift-layout over the engine's font): shaping, kerning, marks, cursive
 * joins, lines, bidi order and caret stops, so the run lays out again as
 * soon as its text changes or an edit changes what layout reads. A window
 * without an engine, such as a preview's, has shift-layout lay the text out
 * as typed from its glyphs' advances, once the engine module has loaded.
 * Construct outside any reactive reader: the effect that reports layouts,
 * and loads what they lack, starts at once.
 */
export class RunText {
  readonly #editor: Editor;
  readonly #laidOutCell: ComputedSignal<PlacedText | null>;
  readonly #reports: Effect;
  readonly #layoutCell: ComputedSignal<TextLayout | null>;
  // non-reactive: glyphs already asked of the engine, read only by the reporting effect
  readonly #preloaded = new Set<GlyphId>();

  constructor(editor: Editor, runIdCell: Signal<RunId>, owner: RunTextOwner) {
    this.#editor = editor;
    this.#laidOutCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        if (!record) return null;
        const location = editor.externalLocationCell.value;
        const sourceId = editor.activeSourceIdCell.value;
        // A glyph's new Unicode value can change what the text lays out as.
        track(editor.font.glyphEntriesCell);
        // A glyph the text shows finished loading into the engine.
        track(owner.glyphsLoadedCell);
        const request = layoutRequest(record);
        return (
          editor.font.layoutText(request, location, sourceId) ??
          this.#laidOutAsTyped(record.items, request, { location, sourceId })
        );
      },
      // An edit that leaves the text where it was, such as dragging an anchor
      // no mark uses, keeps the layout and everything drawn from it.
      { name: "text.laidOut", equals: samePlacement },
    );

    // Loading happens here, not in the layout computed: a load changes what
    // layout reads, and the computed then lays the text out again.
    this.#reports = effect(
      () => {
        const placed = this.#laidOutCell.value;
        if (!placed) {
          // No engine to lay out with: the module that lays out as typed.
          if (owner.run(runIdCell.value)) void loadTypedLayout();
          return;
        }
        owner.onLaidOut(placed.layout);
        this.#preload(placed.unloaded);
      },
      { name: "text.reportLaidOut" },
    );

    this.#layoutCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        const laidOut = this.#laidOutCell.value?.layout;
        if (!record || !laidOut) return null;
        const activeSourceId = editor.activeSourceIdCell.value;
        // Glyphs are listed by name, which a rename changes without moving them.
        track(editor.font.glyphEntriesCell);
        // Metrics between sources follow the engine.
        if (!activeSourceId) track(editor.font.sourceMetricsRevisionCell);
        const metrics = activeSourceId
          ? editor.font.metricsForSource(activeSourceId)
          : editor.font.metricsAtLocation(editor.externalLocationCell.value);
        return new TextLayout({
          items: record.items,
          origin: { x: 0, y: 0 },
          font: editor.font,
          metrics,
          laidOut,
        });
      },
      { name: "text.layoutForRun" },
    );
  }

  /** The run's layout; invalidates on content, location, source, glyph loads, and edits layout reads. */
  get layoutCell(): ComputedSignal<TextLayout | null> {
    return this.#layoutCell;
  }

  /**
   * Loads into the engine the glyphs a layout showed from placeholders, once
   * each: the layout then runs again with them. A glyph still unloaded after
   * that, or a failed load, is not asked for again until a layout shows
   * every glyph loaded, so layout cannot loop.
   */
  #preload(unloaded: readonly GlyphId[]): void {
    if (unloaded.length === 0) {
      this.#preloaded.clear();
      return;
    }
    const wanted = unloaded.filter((glyphId) => !this.#preloaded.has(glyphId));
    if (wanted.length === 0) return;
    for (const glyphId of wanted) this.#preloaded.add(glyphId);
    try {
      this.#editor.font.preloadLaidOut(wanted);
    } catch (error) {
      console.warn("loading the glyphs text shows failed", error);
    }
  }

  /**
   * The text laid out as typed by shift-layout, for a window without an engine:
   * null until the engine module, which holds the layout, has loaded.
   */
  #laidOutAsTyped(
    items: readonly TextItem[],
    request: LayoutRequest,
    place: TextPlace,
  ): PlacedText | null {
    // Called from the layout computed, which lays out again once the module loads.
    track(engineModuleCell);
    const engine = engineModuleCell.peek();
    if (!engine) return null;
    const layout = engine.typedText.layoutTyped(request, this.#typedFont(items, place));
    return { layout, unloaded: [] };
  }

  /**
   * What layout as typed reads of the font: the glyph each of the text's
   * characters maps to, and each glyph's advance and mark class, at `place`.
   */
  #typedFont(items: readonly TextItem[], place: TextPlace): TypedFont {
    const editor = this.#editor;
    const { font } = editor;
    const metrics = place.sourceId
      ? font.metricsForSource(place.sourceId)
      : font.metricsAtLocation(place.location);
    const characters = new Map<number, CharacterGlyph>();
    const glyphs = new Map<GlyphId, TypedGlyph>();
    for (const item of items) {
      if (item.kind === "linebreak") continue;
      const glyphId = glyphIdForItem(item, font);
      if (!glyphId) continue;
      if (item.kind === "character") {
        characters.set(item.codepoint, { codepoint: item.codepoint, glyphId });
      }
      if (glyphs.has(glyphId)) continue;
      const model = editor
        .glyphForId(glyphId)
        ?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
      if (model) track(model.xAdvanceCell);
      const name = font.glyphName(glyphId);
      glyphs.set(glyphId, {
        glyphId,
        advance: model?.xAdvance ?? 0,
        isMark: name !== null && font.isNonspacingMark(name),
      });
    }
    return {
      characters: characters.values().toArray(),
      glyphs: glyphs.values().toArray(),
      metrics: {
        unitsPerEm: metrics.unitsPerEm,
        ascender: metrics.ascender,
        descender: metrics.descender,
        lineGap: metrics.lineGap ?? 0,
        capHeight: metrics.capHeight ?? null,
      },
    };
  }

  dispose(): void {
    this.#reports.dispose();
    this.#layoutCell.dispose();
    this.#laidOutCell.dispose();
  }
}

/** The layout request for a run, shaped with the font's default features unless shaping is off. */
function layoutRequest(record: TextRunRecord): LayoutRequest {
  return {
    units: record.items.map(layoutUnit),
    options: {
      language: null,
      script: null,
      features: [],
      shaping: record.shaping,
      align: null,
      lineHeight: { kind: "auto" },
      width: null,
    },
  };
}

function layoutUnit(item: TextItem): LayoutUnit {
  switch (item.kind) {
    case "character":
      return { kind: "character", codepoint: item.codepoint };
    case "glyph":
      return { kind: "glyph", glyphId: item.glyphId };
    case "linebreak":
      return { kind: "lineBreak" };
  }
}

/** Loads the engine module, which lays text out as typed; a failure is logged. */
async function loadTypedLayout(): Promise<void> {
  try {
    await loadEngine();
  } catch (error) {
    console.error("the module that lays text out did not load", error);
  }
}

/**
 * Whether two layouts place every glyph, line and caret alike. Glyph bounds,
 * which the editor's {@link TextLayout} does not keep, are left out, so an
 * outline edit that moves nothing keeps the layout.
 */
function samePlacement(previous: PlacedText | null, next: PlacedText | null): boolean {
  return equalValues(previous, next);
}

function equalValues(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (typeof previous !== "object" || typeof next !== "object" || !previous || !next) return false;
  if (Array.isArray(previous)) {
    return (
      Array.isArray(next) &&
      previous.length === next.length &&
      previous.every((value, index) => equalValues(value, next[index]))
    );
  }
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(before).filter((key) => key !== "bounds");
  return (
    keys.length === Object.keys(after).filter((key) => key !== "bounds").length &&
    keys.every((key) => equalValues(before[key], after[key]))
  );
}
