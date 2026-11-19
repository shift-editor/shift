import type { Editor } from "@shift/editor";
import type { Axis } from "@shift/editor/model";
import { track } from "@shift/editor/signals";
import { axisValue } from "@shift/editor/variation";
import { sameConditionRange } from "@shift/glyph-state";
import type { Condition, ConditionRange, GlyphId } from "@shift/types";
import type { ChipAxisGroup, ChipReading, ConditionChip } from "@/types/conditions";

/**
 * The axes a condition's chips are written on, and how a chip's text reads
 * and writes: the font's axes users see and, for a component's condition,
 * the axes of the glyph it sits in. Reading and writing are the engine's
 * (shift-font's `ConditionSpace`); this only names axes and builds lists.
 *
 * @remarks
 * Its reads subscribe to what they read, so a computed that builds chips
 * reruns when the axes or the location change.
 */
export class ConditionChipSpace {
  readonly #editor: Editor;
  readonly #glyphId: GlyphId | null;

  /**
   * @param glyphId - The glyph whose own axes a condition may read (the
   *   glyph a component sits in); null for font axes only, as alternates read.
   */
  constructor(editor: Editor, glyphId: GlyphId | null) {
    this.#editor = editor;
    this.#glyphId = glyphId;
  }

  /** The axes a chip's + offers: the font's, then the glyph's own under their own heading. */
  get axisGroups(): readonly ChipAxisGroup[] {
    const groups: ChipAxisGroup[] = [{ label: "Font axes", axes: this.#fontAxes() }];
    const own = this.#ownAxes();
    if (own.length > 0) groups.push({ label: "Glyph axes", axes: own });
    return groups.filter((group) => group.axes.length > 0);
  }

  /** Each range of `condition` as its chip shows it; a range on an axis the space lacks is left out. */
  chips(condition: Condition): readonly ConditionChip[] {
    return condition.all.flatMap((range) => {
      const axis = this.#axis(range);
      if (!axis) return [];

      const valueText = this.#editor.font.conditionValueText(this.#glyphId, range);
      return [{ axis, range, valueText, displayText: chipDisplayText(valueText, axis) }];
    });
  }

  /** A new chip's text on `axis`: from where the canvas draws now, `≥ 700`. */
  prefill(axis: Axis): string {
    const own = this.#ownAxes().includes(axis);
    const location = own
      ? this.#editor.glyphLocationCell.peek()
      : this.#editor.externalLocationCell.peek();
    return `≥ ${Math.round(axisValue(location, axis) * 100) / 100}`;
  }

  /** What `text`, typed in a chip on `axis`, reads as; a problem reads as a sentence. */
  read(axis: Axis, text: string): ChipReading {
    const value = this.#editor.font.conditionValue(this.#glyphId, axis.id, text);
    switch (value.kind) {
      case "range":
        return value;
      case "problem":
        return { kind: "problem", message: asSentence(value.message) };
    }
  }

  #axis(range: ConditionRange): Axis | null {
    return (
      [...this.#fontAxes(), ...this.#ownAxes()].find((axis) => axis.id === range.axisId) ?? null
    );
  }

  #fontAxes(): readonly Axis[] {
    const axesCell = this.#editor.font.externalAxesCell;
    track(axesCell);
    return axesCell.peek();
  }

  #ownAxes(): readonly Axis[] {
    if (!this.#glyphId) return [];

    const glyph = this.#editor.glyphForId(this.#glyphId);
    if (!glyph) return [];

    track(glyph.axesCell);
    return glyph.axesCell.peek();
  }
}

/** `condition` with its range at `index` replaced by `range`, or `range` added after the rest when `index` is null. */
export function withRange(
  condition: Condition,
  index: number | null,
  range: ConditionRange,
): Condition {
  if (index === null) return { all: [...condition.all, range] };

  return { all: condition.all.map((current, at) => (at === index ? range : current)) };
}

/** `condition` without its range at `index`. */
export function withoutRange(condition: Condition, index: number): Condition {
  return { all: condition.all.filter((_, at) => at !== index) };
}

/** The ranges every one of `conditions` has, in the first's order. */
export function sharedRanges(conditions: readonly Condition[]): readonly ConditionRange[] {
  const [first, ...rest] = conditions;
  if (!first) return [];

  return first.all.filter((range) => rest.every((condition) => hasRange(condition, range)));
}

/** Whether `condition` has `range` among its ranges. */
function hasRange(condition: Condition, range: ConditionRange): boolean {
  return condition.all.some((other) => sameConditionRange(range, other));
}

/**
 * A chip's exact value text, as the engine writes it (`≥ 694.444`,
 * `≤ 80`, `400–900`), as the chip shows it: each number rounded for
 * reading, and a range whose end is the axis's own written open there,
 * `694.444–900` on an axis up to 900 as `≥ 694`. Only the shown text: the
 * range and the text editing starts from stay exact.
 */
export function chipDisplayText(valueText: string, axis: Axis): string {
  const both = /^(-?[\d.]+)–(-?[\d.]+)$/.exec(valueText);
  if (both) {
    const [from, upTo] = [Number(both[1]), Number(both[2])];
    if (upTo === axis.maximum && from !== axis.minimum) return `≥ ${roundedValue(from)}`;
    if (from === axis.minimum && upTo !== axis.maximum) return `≤ ${roundedValue(upTo)}`;
    return `${roundedValue(from)}–${roundedValue(upTo)}`;
  }

  return valueText.replace(/-?\d+(?:\.\d+)?/g, (number) => roundedValue(Number(number)));
}

/** A value as a chip shows it: whole from 100 up, else to one decimal place, `694`, `16.8`. */
function roundedValue(value: number): string {
  const places = Math.abs(value) >= 100 ? 0 : 1;
  const factor = 10 ** places;
  return String(Math.round(value * factor) / factor);
}

/** An engine message as the chip shows it: capitalised, with a full stop. */
function asSentence(message: string): string {
  const sentence = message.charAt(0).toUpperCase() + message.slice(1);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
