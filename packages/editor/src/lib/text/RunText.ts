import type { RunId, ShapedParagraph, ShapedRun, ShapeUnit } from "@shift/types";
import { computed, effect, signal, track } from "../signals";
import type { ComputedSignal, Effect, Signal, WritableSignal } from "../signals";
import type { Editor } from "../editor/Editor";
import type {
  ShapedTextParagraph,
  ShapingRequest,
  ShapingSettings,
  TextRunRecord,
} from "../../types/text";
import type { RegisteredShaper } from "../wasm/shaping";
import { locationFromExternalAxisLocation } from "../variation/location";
import {
  splitParagraphs,
  TextLayout,
  type Direction,
  type Paragraph,
  type ParagraphItem,
} from "./layout";

/** A run's paragraphs as shaped, indexed like `splitParagraphs`. */
export interface ShapedText {
  readonly paragraphs: readonly ShapedTextParagraph[];
}

/** What a run's text reads from the {@link Text} that owns it. */
export interface RunTextOwner {
  /** Reactive like `Text.run`. */
  run(id: RunId): TextRunRecord | null;
  /** Bumped when a glyph the text shows finishes loading. */
  readonly glyphsLoadedCell: Signal<number>;
  /** The shaper to shape with; null until it is ready, when text lays out literally. */
  readonly shaperCell: Signal<RegisteredShaper | null>;
  /** Whether every glyph a shaping result shows is loaded; reactive through `glyphsLoadedCell`. */
  isLoaded(shaped: ShapedText): boolean;
  /** Starts loading the glyphs a shaping result substitutes in, which no item names directly. */
  load(shaped: ShapedText): void;
}

/**
 * Keeps one run's text shaped and laid out.
 *
 * @remarks
 * Shaping runs synchronously in `@shift/wasm/shaping`, so the layout shapes
 * text in the same pass that changes it. Only a result that substitutes in an
 * unloaded glyph, such as an alternate a stylistic set brings in, waits: the
 * last result whose glyphs were all loaded stays shown, paragraph by
 * paragraph where its text is unchanged, until the glyph loads, so a new
 * ligature never draws blank. Until the owner's shaper is ready the text
 * lays out literally, as does a run with shaping off. Construct outside any
 * reactive reader: the effect that loads substituted glyphs starts at once.
 */
export class RunText {
  readonly #requestCell: ComputedSignal<ShapingRequest | null>;
  readonly #shapedCell: ComputedSignal<ShapedText | null>;
  /**
   * The last result whose glyphs were all loaded. State, not a derivation:
   * it remembers an earlier result while a newer one waits on glyph loads.
   */
  readonly #readyCell: WritableSignal<ShapedText | null> = signal(null, { name: "text.ready" });
  readonly #loads: Effect;
  readonly #layoutCell: ComputedSignal<TextLayout | null>;
  readonly #scriptsCell: ComputedSignal<readonly string[]>;
  readonly #directionCell: ComputedSignal<Direction>;

  constructor(editor: Editor, runIdCell: Signal<RunId>, owner: RunTextOwner) {
    this.#requestCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        // A preview reads its source without a workspace, which compiles the shaper font.
        if (!record?.shaping || editor.sessionMode === "preview") return null;
        // A glyph's new Unicode value can change what the text shapes to.
        track(editor.font.glyphEntriesCell);
        const location = locationFromExternalAxisLocation(editor.externalLocationCell.value);
        const settings = shapingSettings(record);
        const paragraphs = splitParagraphs(record.items).map((paragraph) => ({
          key: paragraphKey(paragraph),
          request: { units: paragraph.items.map(shapeUnit), location, ...settings },
        }));
        return paragraphs.length > 0 ? { paragraphs } : null;
      },
      { name: "text.shapingRequest" },
    );

    this.#shapedCell = computed(
      () => {
        const request = this.#requestCell.value;
        const shaper = owner.shaperCell.value;
        if (!request || !shaper) return null;
        const shaped = shaper.shapeParagraphs(request.paragraphs.map(({ request }) => request));
        return {
          paragraphs: request.paragraphs.map(({ key }, index) => ({
            key,
            shaped: shaped[index] ?? null,
          })),
        };
      },
      { name: "text.shaped" },
    );

    this.#loads = effect(
      () => {
        const shaped = this.#shapedCell.value;
        if (!shaped) return;
        if (owner.isLoaded(shaped)) {
          this.#readyCell.set(shaped);
          return;
        }
        owner.load(shaped);
      },
      { name: "text.loadShaped" },
    );

    this.#layoutCell = computed(
      () => {
        const record = owner.run(runIdCell.value);
        track(editor.externalLocationCell);
        track(editor.activeSourceIdCell);
        // Items resolve to glyphs by Unicode value and id, so remapping or deleting a glyph re-lays out.
        track(editor.font.glyphEntriesCell);
        track(owner.glyphsLoadedCell);
        if (!record) return null;
        const { unitsPerEm } = editor.font.metricsCell.value;
        const shaped = record.shaping ? this.#shapedCell.value : null;
        const loaded = shaped !== null && owner.isLoaded(shaped);
        // Read, and so subscribed to, only while the current result waits on loads,
        // so publishing a ready result does not lay the run out again.
        const ready = record.shaping && !loaded ? this.#readyCell.value : null;
        return new TextLayout({
          items: record.items,
          origin: { x: 0, y: 0 },
          editor,
          externalLocation: editor.externalLocationCell,
          shaped:
            loaded && shaped ? shaped.paragraphs.map(shapingOf) : readyParagraphs(record, ready),
          align: record.align,
          lineHeight: record.lineHeight === null ? null : record.lineHeight * unitsPerEm,
        });
      },
      { name: "text.layoutForRun" },
    );

    this.#scriptsCell = computed(
      () => {
        // Runs come in screen order; read each paragraph's in the order its text is written.
        const runs = this.#shapedCell.value?.paragraphs.flatMap(
          ({ shaped }) => shaped?.runs.toSorted(byStart) ?? [],
        );
        const scripts = new Set(runs?.flatMap((run) => (run.script ? [run.script] : [])));
        return [...scripts];
      },
      { name: "text.scripts", equals: sameStrings },
    );

    this.#directionCell = computed(() => this.#layoutCell.value?.lines[0]?.direction ?? "ltr", {
      name: "text.direction",
    });
  }

  /** The scripts the run's text was shaped in, in order of first use; empty until it is shaped. */
  get scriptsCell(): ComputedSignal<readonly string[]> {
    return this.#scriptsCell;
  }

  /** The direction of the run's first line; left to right until the text is shaped. */
  get directionCell(): ComputedSignal<Direction> {
    return this.#directionCell;
  }

  /** The run's layout; invalidates on content, location, source, glyph loads, shaping results, and the run's shaping settings. */
  get layoutCell(): ComputedSignal<TextLayout | null> {
    return this.#layoutCell;
  }

  dispose(): void {
    this.#directionCell.dispose();
    this.#scriptsCell.dispose();
    this.#loads.dispose();
    this.#layoutCell.dispose();
    this.#shapedCell.dispose();
    this.#requestCell.dispose();
  }
}

/**
 * Returns the last ready result's shaping for each paragraph whose text is
 * unchanged, so only an edited paragraph lays out literally while the
 * current result's glyphs load.
 */
function readyParagraphs(
  record: TextRunRecord,
  ready: ShapedText | null,
): readonly (ShapedParagraph | null)[] | null {
  if (!ready) return null;
  // A paragraph shaped from other text would map glyphs to the wrong items.
  const byKey = new Map(ready.paragraphs.map((paragraph) => [paragraph.key, paragraph.shaped]));
  return splitParagraphs(record.items).map(
    (paragraph) => byKey.get(paragraphKey(paragraph)) ?? null,
  );
}

/** The run's language, script, and features, as every paragraph is shaped with them. */
function shapingSettings(record: TextRunRecord): ShapingSettings {
  return {
    features: Object.entries(record.features).map(([tag, on]) => ({ tag, value: on ? 1 : 0 })),
    ...(record.language === null ? {} : { language: record.language }),
    ...(record.script === null ? {} : { script: record.script }),
  };
}

function byStart(a: ShapedRun, b: ShapedRun): number {
  return a.start - b.start;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function shapingOf(paragraph: ShapedTextParagraph): ShapedParagraph | null {
  return paragraph.shaped;
}

/**
 * Returns a key for the text a paragraph shapes: its characters and picked
 * glyphs.
 *
 * @remarks
 * Item ids are left out, so retyping the same text reuses its shaping.
 */
function paragraphKey(paragraph: Paragraph): string {
  return paragraph.items
    .map((item) => (item.kind === "character" ? `c${item.codepoint}` : `g${item.glyphId}`))
    .join(" ");
}

function shapeUnit(item: ParagraphItem): ShapeUnit {
  return item.kind === "character" ? { codepoint: item.codepoint } : { glyphId: item.glyphId };
}
