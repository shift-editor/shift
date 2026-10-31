import type { AxisId, AxisKind, AxisLabel, Axis as AxisRecord, AxisRole } from "@shift/types";
import { axes } from "@shift/wasm";

/**
 * One variation axis of a font, answering its range and positions as
 * shift-font decides them.
 *
 * @remarks
 * Wraps an immutable axis record. Every rule (range, whether it varies,
 * which values it accepts, normalization) is a call to shift-font's
 * `AxisKind` through `@shift/wasm`, so the editor and export agree; the
 * class keeps no copy of them. A discrete axis ranges from its smallest to
 * its largest value. The record fields are exposed unchanged, so an `Axis`
 * reads wherever an axis record is expected; send {@link Axis.record} when
 * the plain record must be copied, edited or cloned across a port, since a
 * clone or spread of an `Axis` keeps only `record`.
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
}
