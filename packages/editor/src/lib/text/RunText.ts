import type { RunId } from "@shift/types";
import type {
  Direction,
  FeatureSetting,
  LayoutLine,
  LayoutRequest,
  LayoutUnit,
  CaretStop,
  PlacedGlyph,
  TextLayout as LaidOutText,
} from "@shift/wasm/protocol";
import { computed, effect, track } from "../signals";
import type { ComputedSignal, Effect, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { TextRunRecord } from "../../types/text";
import { displayAdvance } from "../utils/displayAdvance";
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
 * soon as its text changes or an edit changes what layout reads. A preview,
 * which has no engine, lays its text out as typed. Construct outside any
 * reactive reader: the effect that reports layouts starts at once.
 */
export class RunText {
  readonly #laidOutCell: ComputedSignal<LaidOutText | null>;
  readonly #reports: Effect;
  readonly #layoutCell: ComputedSignal<TextLayout | null>;
  readonly #scriptsCell: ComputedSignal<readonly string[]>;
  readonly #directionCell: ComputedSignal<Direction>;

  constructor(editor: Editor, runIdCell: Signal<RunId>, owner: RunTextOwner) {
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
        return editor.font.layoutText(request, location, sourceId) ?? typed(editor, record.items);
      },
      // An edit that leaves the text where it was, such as dragging an anchor
      // no mark uses, keeps the layout and everything drawn from it.
      { name: "text.laidOut", equals: samePlacement },
    );

    this.#reports = effect(
      () => {
        const laidOut = this.#laidOutCell.value;
        if (laidOut) owner.onLaidOut(laidOut);
      },
      { name: "text.reportLaidOut" },
    );

    this.#layoutCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        const laidOut = this.#laidOutCell.value;
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

    this.#scriptsCell = computed(() => this.#layoutCell.value?.scripts ?? [], {
      name: "text.scripts",
      equals: sameStrings,
    });

    this.#directionCell = computed(() => this.#layoutCell.value?.lineDirection(0) ?? "ltr", {
      name: "text.direction",
    });
  }

  /** The ISO 15924 scripts the run's text is laid out in, in order of first use. */
  get scriptsCell(): ComputedSignal<readonly string[]> {
    return this.#scriptsCell;
  }

  /** The direction the run's first paragraph reads in, as layout resolved it. */
  get directionCell(): ComputedSignal<Direction> {
    return this.#directionCell;
  }

  /** The run's layout; invalidates on content, location, source, glyph loads, and edits layout reads. */
  get layoutCell(): ComputedSignal<TextLayout | null> {
    return this.#layoutCell;
  }

  dispose(): void {
    this.#reports.dispose();
    this.#directionCell.dispose();
    this.#scriptsCell.dispose();
    this.#layoutCell.dispose();
    this.#laidOutCell.dispose();
  }
}

/** The layout request for a run: its items, with the run's settings as layout options. */
function layoutRequest(record: TextRunRecord): LayoutRequest {
  return {
    units: record.items.map(layoutUnit),
    options: {
      language: record.language,
      script: record.script,
      features: featureSettings(record.features),
      shaping: record.shaping,
      align: record.align,
      lineHeight:
        record.lineHeight === null ? { kind: "auto" } : { kind: "em", em: record.lineHeight },
      width: null,
    },
  };
}

/** A run's forced features as layout settings: `1` turns one on, `0` off. */
function featureSettings(features: Readonly<Record<string, boolean>>): FeatureSetting[] {
  return Object.entries(features).map(([tag, on]) => ({ tag, value: on ? 1 : 0 }));
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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

/**
 * A preview's text as typed, without the engine that lays text out: one
 * glyph per item at its drawn advance, one line per paragraph.
 */
function typed(editor: Editor, items: readonly TextItem[]): LaidOutText {
  // Called from the layout computed, which tracks the location.
  const metrics = editor.font.metricsAtLocation(editor.externalLocationCell.peek());
  const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
  const glyphs: PlacedGlyph[] = [];
  const lines: LayoutLine[] = [];
  const carets: CaretStop[] = [];
  let start = 0;
  let pen = 0;
  const endLine = (end: number, withBreak: boolean) => {
    const first = glyphs.findIndex((glyph) => glyph.line === lines.length);
    // WORKAROUND (Needs from PR 1): a preview has no engine to place caret
    // stops, so its typed text stands one at each glyph's left and one at
    // the line's end, left to right, as the engine places them for
    // unshaped text.
    for (const glyph of glyphs.slice(first < 0 ? glyphs.length : first)) {
      carets.push(typedStop(glyph.start, lines.length, glyph.left));
    }
    carets.push(typedStop(end, lines.length, pen));
    lines.push({
      paragraph: lines.length,
      start,
      end: end + (withBreak ? 1 : 0),
      baseline: -lineHeight * lines.length,
      ascent: metrics.ascender,
      descent: metrics.descender,
      left: 0,
      advance: pen,
      direction: "ltr",
      runs: [
        {
          start,
          end,
          level: 0,
          direction: "ltr",
          script: null,
          glyphStart: first < 0 ? glyphs.length : first,
          glyphEnd: glyphs.length,
        },
      ],
    });
  };
  for (const [index, item] of items.entries()) {
    if (item.kind === "linebreak") {
      endLine(index, true);
      start = index + 1;
      pen = 0;
      continue;
    }
    const glyphId = glyphIdForItem(item, editor.font);
    const glyph = glyphId ? editor.glyphForId(glyphId) : null;
    const model = glyph?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    if (model) track(model.xAdvanceCell);
    const name = glyphId ? editor.font.glyphName(glyphId) : null;
    const advance = displayAdvance(
      model?.xAdvance ?? 0,
      name !== null && editor.font.isNonspacingMark(name),
    );
    glyphs.push({
      glyphId: glyphId ?? null,
      start: index,
      end: index + 1,
      line: lines.length,
      left: pen,
      baseline: -lineHeight * lines.length,
      xOffset: 0,
      yOffset: 0,
      advance,
      kern: 0,
      direction: "ltr",
      isMark: false,
      bounds: null,
    });
    pen += advance;
  }
  if (items.length > 0) endLine(items.length, false);
  return { lines, glyphs, unitGlyphs: [], carets, width: 0, unshaped: null };
}

function typedStop(unit: number, line: number, x: number): CaretStop {
  return { unit, line, x, direction: "ltr", secondary: null };
}

/**
 * Whether two layouts place every glyph, line and caret alike. Glyph bounds,
 * which the editor's {@link TextLayout} does not keep, are left out, so an
 * outline edit that moves nothing keeps the layout.
 */
function samePlacement(previous: LaidOutText | null, next: LaidOutText | null): boolean {
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
