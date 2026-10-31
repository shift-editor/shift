import type {
  AxisId,
  Location,
  NamedInstanceId,
  NamedInstance as NamedInstanceRecord,
} from "@shift/types";
import type { Axis } from "./Axis";

/**
 * One named instance of a font, building its edited records for the settings forms.
 *
 * @remarks
 * Wraps an immutable instance record. Every `with*` method returns a new
 * record and never changes this one; the engine validates the record when
 * the edit is applied, not here.
 */
export class NamedInstance {
  /** The plain instance record this instance wraps: what edits send. */
  readonly record: NamedInstanceRecord;

  /** @param record - the instance as the engine reads it; never mutated. */
  constructor(record: NamedInstanceRecord) {
    this.record = record;
  }

  get id(): NamedInstanceId {
    return this.record.id;
  }

  get name(): string {
    return this.record.name;
  }

  get location(): Location {
    return this.record.location;
  }

  /**
   * Returns the instance's position on `axis`.
   *
   * @param axis - one of the font's external axes.
   * @returns the stored coordinate, or the axis default when the instance has none on it.
   */
  locationValue(axis: Axis): number {
    return this.record.location.values[axis.id] ?? axis.default;
  }

  /**
   * Returns this instance's record renamed.
   *
   * @param name - the new name; not trimmed, and not checked against other instances' names.
   */
  withName(name: string): NamedInstanceRecord {
    return { ...this.record, name };
  }

  /**
   * Returns this instance's record moved on one axis.
   *
   * @param axisId - the axis to move along.
   * @param value - the new user-space coordinate there; not range-checked.
   */
  withLocationValue(axisId: AxisId, value: number): NamedInstanceRecord {
    return {
      ...this.record,
      location: { values: { ...this.record.location.values, [axisId]: value } },
    };
  }
}
