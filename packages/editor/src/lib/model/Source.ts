import type {
  AxisId,
  Location,
  MetricId,
  MetricValue,
  SourceId,
  Source as SourceRecord,
} from "@shift/types";
import type { Axis } from "./Axis";

/**
 * One source of a font, building its edited records for the settings forms.
 *
 * @remarks
 * Wraps an immutable source record. Every `with*` method returns a new record
 * and never changes this one; the engine validates the record when the edit
 * is applied, not here.
 */
export class Source {
  /** The plain source record this source wraps: what edits send. */
  readonly record: SourceRecord;

  /** @param record - the source as the engine reads it; never mutated. */
  constructor(record: SourceRecord) {
    this.record = record;
  }

  get id(): SourceId {
    return this.record.id;
  }

  get name(): string {
    return this.record.name;
  }

  get location(): Location {
    return this.record.location;
  }

  /** Returns the italic angle in degrees, or null when the source sets none. */
  get italicAngle(): number | null {
    return this.record.italicAngle ?? null;
  }

  /** Returns the line gap in font units, or null when the source sets none. */
  get lineGap(): number | null {
    return this.record.lineGap ?? null;
  }

  /** Returns the underline position in font units, or null when the source sets none. */
  get underlinePosition(): number | null {
    return this.record.underlinePosition ?? null;
  }

  /** Returns the underline thickness in font units, or null when the source sets none. */
  get underlineThickness(): number | null {
    return this.record.underlineThickness ?? null;
  }

  /**
   * Returns the source's position on `axis`.
   *
   * @param axis - one of the font's axes.
   * @returns the stored coordinate, or the axis default when the source has none on it.
   */
  locationValue(axis: Axis): number {
    return this.record.location.values[axis.id] ?? axis.default;
  }

  /**
   * Returns the source's value for one metric row.
   *
   * @param metricId - the font's metric row.
   * @returns the stored value; a row the source has never set reads as zero.
   */
  metricValue(metricId: MetricId): MetricValue {
    return this.record.metricValues[metricId] ?? { position: 0, overshoot: 0 };
  }

  /**
   * Returns this source's record renamed.
   *
   * @param name - the new name; not trimmed, and not checked against other sources' names.
   */
  withName(name: string): SourceRecord {
    return { ...this.record, name };
  }

  /**
   * Returns this source's record moved on one axis.
   *
   * @param axisId - the axis to move along.
   * @param value - the new user-space coordinate there; not range-checked.
   */
  withLocationValue(axisId: AxisId, value: number): SourceRecord {
    return {
      ...this.record,
      location: { values: { ...this.record.location.values, [axisId]: value } },
    };
  }

  /**
   * Returns this source's record with one metric row's value set, added when it has none.
   *
   * @param metricId - the font's metric row.
   * @param value - the row's new position and overshoot.
   */
  withMetricValue(metricId: MetricId, value: MetricValue): SourceRecord {
    return {
      ...this.record,
      metricValues: { ...this.record.metricValues, [metricId]: value },
    };
  }

  /**
   * Returns this source's record with its italic angle set or cleared.
   *
   * @param italicAngle - degrees, or undefined to leave it unset.
   */
  withItalicAngle(italicAngle: number | undefined): SourceRecord {
    return { ...this.record, italicAngle };
  }

  /**
   * Returns this source's record with its line gap set or cleared.
   *
   * @param lineGap - font units, or undefined to leave it unset.
   */
  withLineGap(lineGap: number | undefined): SourceRecord {
    return { ...this.record, lineGap };
  }

  /**
   * Returns this source's record with its underline position set or cleared.
   *
   * @param underlinePosition - font units, or undefined to leave it unset.
   */
  withUnderlinePosition(underlinePosition: number | undefined): SourceRecord {
    return { ...this.record, underlinePosition };
  }

  /**
   * Returns this source's record with its underline thickness set or cleared.
   *
   * @param underlineThickness - font units, or undefined to leave it unset.
   */
  withUnderlineThickness(underlineThickness: number | undefined): SourceRecord {
    return { ...this.record, underlineThickness };
  }
}
