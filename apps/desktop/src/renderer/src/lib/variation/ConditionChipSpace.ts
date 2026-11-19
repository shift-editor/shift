import type { Editor } from "@shift/editor";
import type { Axis } from "@shift/editor/model";
import { track } from "@shift/editor/signals";
import { axisValue } from "@shift/editor/variation";
import { sameConditionRange } from "@shift/glyph-state";
import type { Condition, ConditionRange, GlyphId } from "@shift/types";
import type {
  BoundsReading,
  ChipAxisGroup,
  ChipBounds,
  ChipReading,
  ConditionChip,
} from "@/types/conditions";

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

  /**
   * A new chip's bounds on `axis`: from where the canvas draws now, up to
   * the axis's end, `[694] ≤ wght ≤ [ ]`.
   */
  prefillBounds(axis: Axis): ChipBounds {
    return boundsOfText(this.prefill(axis));
  }

  /**
   * The range `bounds` make on `axis`: both ends `400–600`, only a minimum
   * `≥ 694`, only a maximum `≤ 80`. Read by the engine, which refuses a
   * minimum above the maximum or an end past the axis.
   */
  rangeOf(axis: Axis, bounds: ChipBounds): ChipReading {
    const min = bounds.min.trim();
    const max = bounds.max.trim();
    if (min === "" && max === "") {
      return { kind: "problem", message: "Give a lower or an upper bound." };
    }

    if (min === "") return this.read(axis, `<=${max}`);
    if (max === "") return this.read(axis, `>=${min}`);
    return this.read(axis, `${min}-${max}`);
  }

  /**
   * The bounds `text` typed or pasted into either field fills in: a plain
   * number fills only that field (`side`); a range in the chips' grammar,
   * `400-600`, `>=700`, `700+` or `<=80`, fills both, as the engine reads it.
   */
  boundsFromField(
    axis: Axis,
    bounds: ChipBounds,
    side: keyof ChipBounds,
    text: string,
  ): BoundsReading {
    if (PLAIN_NUMBER.test(text.trim()))
      return { kind: "bounds", bounds: { ...bounds, [side]: text } };

    const reading = this.read(axis, text);
    if (reading.kind === "problem") return reading;

    const valueText = this.#editor.font.conditionValueText(this.#glyphId, reading.range);
    return { kind: "bounds", bounds: boundsOfText(valueText) };
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

/** A plain number as a field holds it while typed: `694`, `-20`, `16.8`, or nothing yet. */
const PLAIN_NUMBER = /^-?\d*\.?\d*$/;

/**
 * A chip's exact value text, as the engine writes it (`≥ 694.444`, `≤ 80`,
 * `400–600`), as the popover's two fields.
 */
export function boundsOfText(valueText: string): ChipBounds {
  const from = /^≥\s*(\S+)$/.exec(valueText);
  if (from) return { min: from[1]!, max: "" };

  const upTo = /^≤\s*(\S+)$/.exec(valueText);
  if (upTo) return { min: "", max: upTo[1]! };

  const both = /^(-?[\d.]+)–(-?[\d.]+)$/.exec(valueText);
  if (both) return { min: both[1]!, max: both[2]! };

  return { min: "", max: "" };
}

/** Bounds as a chip shows them while its equation is open: `400–600`, `≥ 694`, `≤ 80`. */
export function boundsDisplayText(bounds: ChipBounds): string {
  const shown = (text: string) => {
    const value = Number(text);
    return text.trim() !== "" && Number.isFinite(value) ? roundedValue(value) : text.trim();
  };
  const [min, max] = [shown(bounds.min), shown(bounds.max)];
  if (min !== "" && max !== "") return `${min}–${max}`;
  if (min !== "") return `≥ ${min}`;
  return max === "" ? "" : `≤ ${max}`;
}

/** `bounds` moved onto `axis`: each end kept, pulled inside the axis's range. */
export function boundsOnAxis(bounds: ChipBounds, axis: Axis): ChipBounds {
  const clamp = (text: string) => {
    if (text.trim() === "") return text;

    const value = Number(text);
    if (!Number.isFinite(value)) return text;

    return String(Math.min(axis.maximum, Math.max(axis.minimum, value)));
  };
  return { min: clamp(bounds.min), max: clamp(bounds.max) };
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
export function roundedValue(value: number): string {
  const places = Math.abs(value) >= 100 ? 0 : 1;
  const factor = 10 ** places;
  return String(Math.round(value * factor) / factor);
}

/** An engine message as the chip shows it: capitalised, with a full stop. */
function asSentence(message: string): string {
  const sentence = message.charAt(0).toUpperCase() + message.slice(1);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
