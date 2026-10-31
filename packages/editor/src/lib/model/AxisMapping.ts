import {
  ascending,
  comparing,
  mintAxisMappingId,
  type AxisMappingPoint,
  type AxisMapping as AxisMappingRecord,
} from "@shift/types";
import type { AxisMappingCoordinate } from "../../types/variation";
import { Axis } from "./Axis";

/**
 * An axis's independent mapping, the curve from its user values to its
 * design values, building its edited records.
 *
 * @remarks
 * Wraps an immutable mapping record that maps one axis onto itself. Every
 * `with*` method returns a new record and never changes this one; points
 * are addressed by their index in stored order. The engine validates a
 * mapping when it is applied, not here.
 */
export class AxisMapping {
  /** The plain mapping record this mapping wraps: what edits send. */
  readonly record: AxisMappingRecord;
  readonly #axis: Axis;

  /**
   * @param record - an independent mapping of `axis`; never mutated.
   * @param axis - the axis it maps, whose default fills a point missing a value.
   */
  constructor(record: AxisMappingRecord, axis: Axis) {
    this.record = record;
    this.#axis = axis;
  }

  /**
   * Returns a new, unsaved mapping that maps each of `axis`'s positions onto itself.
   *
   * @param axis - the axis to map.
   * @returns a mapping with a fresh id and one point at each position the
   *   axis would keep as discrete values: its values, or a range's minimum,
   *   default and maximum, ascending and each once.
   */
  static identity(axis: Axis): AxisMapping {
    const positions = new Axis(axis.withKind("discrete")).values;
    const record: AxisMappingRecord = {
      id: mintAxisMappingId(),
      name: `${axis.name} mapping`,
      inputs: [axis.id],
      outputs: [axis.id],
      points: positions.map((value) => mappingPoint(axis, value, value)),
    };
    return new AxisMapping(record, axis);
  }

  get points(): readonly AxisMappingPoint[] {
    return this.record.points;
  }

  /**
   * Returns each point's input and output along the axis, in stored order.
   *
   * @returns a fresh array; a point without a value on the axis reads as the
   *   axis's default there.
   */
  get coordinates(): readonly AxisMappingCoordinate[] {
    const axis = this.#axis;
    return this.record.points.map((point, index) => ({
      index,
      input: point.input.values[axis.id] ?? axis.default,
      output: point.output.values[axis.id] ?? axis.default,
    }));
  }

  /**
   * Returns the points along the axis in input order, the order the curve runs.
   *
   * @returns a fresh array of {@link AxisMapping.coordinates}, sorted by input.
   */
  get curve(): readonly AxisMappingCoordinate[] {
    return this.coordinates.toSorted(byInput);
  }

  /**
   * Returns this mapping's record with one point's user value moved.
   *
   * @param index - the point's index in stored order; out of range changes nothing.
   * @param input - the new user value; the points are not re-sorted.
   */
  withPointInput(index: number, input: number): AxisMappingRecord {
    return this.#withPoint(index, (point) => ({
      ...point,
      input: { values: { ...point.input.values, [this.#axis.id]: input } },
    }));
  }

  /**
   * Returns this mapping's record with one point's design value moved.
   *
   * @param index - the point's index in stored order; out of range changes nothing.
   * @param output - the new design value.
   */
  withPointOutput(index: number, output: number): AxisMappingRecord {
    return this.#withPoint(index, (point) => ({
      ...point,
      output: { values: { ...point.output.values, [this.#axis.id]: output } },
    }));
  }

  /**
   * Returns this mapping's record with one point moved on both sides.
   *
   * @param index - the point's index in stored order; out of range changes nothing.
   * @param input - the new user value; the points are not re-sorted.
   * @param output - the new design value.
   */
  withPoint(index: number, input: number, output: number): AxisMappingRecord {
    return new AxisMapping(this.withPointInput(index, input), this.#axis).withPointOutput(
      index,
      output,
    );
  }

  /**
   * Returns this mapping's record without one point.
   *
   * @param index - the point's index in stored order; out of range changes nothing.
   * @returns a new record, which may have no points, which the engine rejects.
   */
  withoutPoint(index: number): AxisMappingRecord {
    return {
      ...this.record,
      points: this.record.points.filter((_, pointIndex) => pointIndex !== index),
    };
  }

  /**
   * Returns the point to add next, at a position the mapping lacks.
   *
   * @remarks
   * A discrete axis takes its first unmapped value. A continuous axis takes
   * its default, minimum or maximum, in that order, then the midpoint of the
   * widest gap between mapped inputs inside its range. The output follows
   * the existing curve linearly at that input, holding its ends beyond them.
   *
   * @returns null when no such position is left.
   */
  nextPoint(): AxisMappingPoint | null {
    const axis = this.#axis;
    const coordinates = this.curve;
    const input = nextInput(axis, new Set(coordinates.map((point) => point.input)));
    if (input === null) return null;

    return mappingPoint(axis, input, outputAt(coordinates, input));
  }

  /**
   * Returns this mapping's record with {@link AxisMapping.nextPoint} added,
   * its points in input order.
   *
   * @returns this record unchanged when no position is left.
   */
  withNextPoint(): AxisMappingRecord {
    const point = this.nextPoint();
    if (!point) return this.record;

    const axis = this.#axis;
    const byPointInput = comparing(
      (candidate: AxisMappingPoint) => candidate.input.values[axis.id] ?? axis.default,
      ascending,
    );
    return { ...this.record, points: [...this.record.points, point].toSorted(byPointInput) };
  }

  #withPoint(
    index: number,
    edit: (point: AxisMappingPoint) => AxisMappingPoint,
  ): AxisMappingRecord {
    return {
      ...this.record,
      points: this.record.points.map((point, pointIndex) =>
        pointIndex === index ? edit(point) : point,
      ),
    };
  }
}

/** Mapping coordinates in input order, the order the mapping curve runs. */
const byInput = comparing((point: AxisMappingCoordinate) => point.input, ascending);

function mappingPoint(axis: Axis, input: number, output: number): AxisMappingPoint {
  return {
    input: { values: { [axis.id]: input } },
    output: { values: { [axis.id]: output } },
  };
}

function nextInput(axis: Axis, inputs: ReadonlySet<number>): number | null {
  if (axis.isDiscrete) return axis.values.find((value) => !inputs.has(value)) ?? null;

  const preferred = [axis.default, axis.minimum, axis.maximum].find((value) => !inputs.has(value));
  if (preferred !== undefined) return preferred;

  const ordered = [...inputs].filter((value) => axis.accepts(value)).toSorted(ascending);
  let largestGap = 0;
  let input: number | null = null;

  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    const gap = right - left;
    const midpoint = left + gap / 2;
    if (gap <= largestGap || midpoint === left || midpoint === right) continue;

    largestGap = gap;
    input = midpoint;
  }

  return input;
}

function outputAt(coordinates: readonly AxisMappingCoordinate[], input: number): number {
  const first = coordinates[0];
  if (!first || input <= first.input) return first?.output ?? input;

  const last = coordinates.at(-1);
  if (!last || input >= last.input) return last?.output ?? input;

  for (let index = 1; index < coordinates.length; index += 1) {
    const right = coordinates[index];
    if (input > right.input) continue;

    const left = coordinates[index - 1];
    const progress = (input - left.input) / (right.input - left.input);
    return left.output + progress * (right.output - left.output);
  }

  return input;
}
