import {
  mintAxisLabelId,
  removeBy,
  replaceBy,
  type AxisId,
  type AxisKind,
  type AxisKindName,
  type AxisLabel,
  type AxisLabelId,
  type Axis as AxisRecord,
  type AxisRole,
} from "@shift/types";
import { axes } from "@shift/wasm";
import type { AxisLabelBound, AxisLabelKind } from "../../types/variation";

/**
 * One variation axis of a font, answering its range and positions as
 * shift-font decides them, and building its edited records.
 *
 * @remarks
 * Wraps an immutable axis record. Every rule (range, whether it varies,
 * which values it accepts, normalization, converting between kinds) is a
 * call to shift-font's `AxisKind` through `@shift/wasm`, so the editor and
 * export agree; the class keeps no copy of them. A discrete axis ranges from
 * its smallest to its largest value. The `with*` methods return a new
 * record and never change this one. The record fields are exposed
 * unchanged, so an `Axis` reads wherever an axis record is expected; send
 * {@link Axis.record} when the plain record must be copied or cloned across
 * a port, since a clone or spread of an `Axis` keeps only `record`.
 */
export class Axis {
  /** The plain axis record this axis wraps: what edits copy and boundaries send. */
  readonly record: AxisRecord;

  /** @param record - the axis as the engine reads it; never mutated. */
  constructor(record: AxisRecord) {
    this.record = record;
  }

  get id(): AxisId {
    return this.record.id;
  }

  get tag(): string {
    return this.record.tag;
  }

  get name(): string {
    return this.record.name;
  }

  get role(): AxisRole {
    return this.record.role;
  }

  /** The authored range or values, kept for editing them. */
  get kind(): AxisKind {
    return this.record.kind;
  }

  get labels(): readonly AxisLabel[] {
    return this.record.labels;
  }

  get hidden(): boolean {
    return this.record.hidden;
  }

  /** Returns whether the axis takes only its listed {@link Axis.values}. */
  get isDiscrete(): boolean {
    return this.record.kind.kind === "discrete";
  }

  /** Returns the lowest position: the minimum, or a discrete axis's smallest value. */
  get minimum(): number {
    return axes.minimum(this.record.kind);
  }

  get default(): number {
    return this.record.kind.default;
  }

  /** Returns the highest position: the maximum, or a discrete axis's largest value. */
  get maximum(): number {
    return axes.maximum(this.record.kind);
  }

  /** Returns a discrete axis's values in authored order; empty for a continuous axis. */
  get values(): readonly number[] {
    return this.record.kind.kind === "discrete" ? this.record.kind.values : [];
  }

  /** Returns whether the axis has more than one position to vary between. */
  get varies(): boolean {
    return axes.varies(this.record.kind);
  }

  /**
   * Returns whether `value` is a position this axis allows.
   *
   * @param value - a user-space coordinate.
   * @returns true for a finite value inside a continuous range, or one of a
   *   discrete axis's values.
   */
  accepts(value: number): boolean {
    return axes.accepts(this.record.kind, value);
  }

  /**
   * Maps a user-space coordinate to `-1..=1` around the default.
   *
   * @param value - a user-space coordinate; not clamped to the range.
   * @returns `0` at the default, `-1` at the minimum and `1` at the maximum,
   *   linear on each side; `0` on a side with no extent.
   */
  normalize(value: number): number {
    return axes.normalize(this.record.kind, value);
  }

  /**
   * Returns this axis's record renamed.
   *
   * @param name - the new name; not trimmed or validated, so a blank name is
   *   rejected only when the engine applies the edit.
   */
  withName(name: string): AxisRecord {
    return { ...this.record, name };
  }

  /**
   * Returns this axis's record with a new tag.
   *
   * @param tag - the new tag; not validated, so a tag that is not four ASCII
   *   characters is rejected only when the engine applies the edit.
   */
  withTag(tag: string): AxisRecord {
    return { ...this.record, tag };
  }

  /**
   * Returns this axis's record shown in or hidden from user interfaces.
   *
   * @param hidden - true hides the axis from apps' axis controls.
   */
  withHidden(hidden: boolean): AxisRecord {
    return { ...this.record, hidden };
  }

  /**
   * Returns this axis's record with its lowest position moved.
   *
   * @param minimum - the new continuous minimum, in user space; not validated.
   * @returns a new record; this record unchanged for a discrete axis, whose
   *   range follows its values.
   */
  withMinimum(minimum: number): AxisRecord {
    const kind = this.record.kind;
    if (kind.kind === "discrete") return this.record;

    return { ...this.record, kind: { ...kind, minimum } };
  }

  /**
   * Returns this axis's record with its highest position moved.
   *
   * @param maximum - the new continuous maximum, in user space; not validated.
   * @returns a new record; this record unchanged for a discrete axis, whose
   *   range follows its values.
   */
  withMaximum(maximum: number): AxisRecord {
    const kind = this.record.kind;
    if (kind.kind === "discrete") return this.record;

    return { ...this.record, kind: { ...kind, maximum } };
  }

  /**
   * Returns this axis's record with its default moved.
   *
   * @param value - the new default, in user space; not validated, so a
   *   discrete axis's default may leave its values until the engine rejects it.
   * @returns a new record.
   */
  withDefault(value: number): AxisRecord {
    return { ...this.record, kind: { ...this.record.kind, default: value } };
  }

  /**
   * Returns this axis's record converted to `kind` over the same positions,
   * as shift-font converts it.
   *
   * @param kind - the kind to convert to.
   * @returns a new record: a range becomes its minimum, default and maximum
   *   as ascending discrete values, each once; discrete values become the
   *   range from the smallest to the largest. This record unchanged when the
   *   axis already has `kind`.
   */
  withKind(kind: AxisKindName): AxisRecord {
    if (kind === this.record.kind.kind) return this.record;

    switch (kind) {
      case "continuous":
        return { ...this.record, kind: axes.toContinuous(this.record.kind) };
      case "discrete":
        return { ...this.record, kind: axes.toDiscrete(this.record.kind) };
    }
  }

  /**
   * Returns this axis's record with a new style label at `value`, last in order.
   *
   * @param value - the label's nominal value, in user space.
   * @param kind - `range` starts the label's range at its value on both ends.
   * @returns a new record holding a label named "New style", not elidable.
   */
  withNewLabel(value: number, kind: AxisLabelKind): AxisRecord {
    const label: AxisLabel = {
      id: mintAxisLabelId(),
      name: "New style",
      value,
      range: kind === "range" ? { minimum: value, maximum: value } : null,
      elidable: false,
    };
    return { ...this.record, labels: [...this.record.labels, label] };
  }

  /**
   * Returns this axis's record with one style label renamed.
   *
   * @param labelId - the label to change; the record is copied unchanged
   *   when the axis has no such label.
   * @param name - the new name; not trimmed or validated.
   */
  withLabelName(labelId: AxisLabelId, name: string): AxisRecord {
    return this.#withLabel(labelId, (label) => ({ ...label, name }));
  }

  /**
   * Returns this axis's record with one style label's nominal value moved.
   *
   * @param labelId - the label to change.
   * @param value - the new nominal value, in user space; its range is kept.
   */
  withLabelValue(labelId: AxisLabelId, value: number): AxisRecord {
    return this.#withLabel(labelId, (label) => ({ ...label, value }));
  }

  /**
   * Returns this axis's record with one style label's linked value set or cleared.
   *
   * @param labelId - the label to change.
   * @param linkedValue - the value the style links to, or null to remove the link.
   */
  withLabelLinkedValue(labelId: AxisLabelId, linkedValue: number | null): AxisRecord {
    return this.#withLabel(labelId, (label) => ({
      ...label,
      linkedValue: linkedValue ?? undefined,
    }));
  }

  /**
   * Returns this axis's record with one end of a style label's range moved.
   *
   * @param labelId - the label to change.
   * @param bound - the end to move and its new value; an end the label lacks
   *   reads as its nominal value, so a value label gains a range.
   */
  withLabelRange(labelId: AxisLabelId, bound: AxisLabelBound): AxisRecord {
    return this.#withLabel(labelId, (label) => {
      const { value: nominal, range } = label;
      return { ...label, range: { minimum: nominal, maximum: nominal, ...range, ...bound } };
    });
  }

  /**
   * Returns this axis's record with one style label made elidable or not.
   *
   * @param labelId - the label to change.
   * @param elidable - true makes it the axis's only elidable label, clearing
   *   the flag on every other label.
   */
  withLabelElidable(labelId: AxisLabelId, elidable: boolean): AxisRecord {
    return {
      ...this.record,
      labels: this.record.labels.map((label) => {
        if (label.id === labelId) return { ...label, elidable };
        if (!elidable || !label.elidable) return label;

        return { ...label, elidable: false };
      }),
    };
  }

  /**
   * Returns this axis's record without one style label.
   *
   * @param labelId - the label to remove; the record is copied unchanged
   *   when the axis has no such label.
   */
  withoutLabel(labelId: AxisLabelId): AxisRecord {
    return { ...this.record, labels: removeBy(this.record.labels, labelId, labelIdOf) };
  }

  #withLabel(labelId: AxisLabelId, edit: (label: AxisLabel) => AxisLabel): AxisRecord {
    return { ...this.record, labels: replaceBy(this.record.labels, labelId, edit, labelIdOf) };
  }
}

function labelIdOf(label: AxisLabel): AxisLabelId {
  return label.id;
}
