import type {
  Axis,
  FontMetrics,
  MetricDefinition,
  MetricKind,
  SourceMetricField,
  SourceMetrics,
  SourceMetricsInterpolationSnapshot,
} from "@shift/types";
import {
  interpolateSourceValues,
  interpolationWeights,
} from "@/lib/interpolation/InterpolationBasis";
import type { AxisLocation } from "@/types/variation";

/**
 * Decodes a Rust-built numeric interpolation model into source-level metrics.
 *
 * @remarks
 * This is derived renderer state, not an authored source or named instance.
 * Rust owns variation-region construction; this object validates the flattened
 * value layout once and performs the inexpensive per-location evaluation used
 * by canvas and text layout code.
 */
export class SourceMetricsInterpolation {
  readonly #snapshot: SourceMetricsInterpolationSnapshot;
  readonly #unitsPerEm: number;
  readonly #positionIndexByKind: ReadonlyMap<MetricKind, number>;
  readonly #technicalIndexByField: ReadonlyMap<SourceMetricField, number>;
  readonly #valuesBySource: ReadonlyMap<string, Float64Array>;
  readonly #valueCount: number;

  private constructor(
    snapshot: SourceMetricsInterpolationSnapshot,
    unitsPerEm: number,
    positionIndexByKind: ReadonlyMap<MetricKind, number>,
    technicalIndexByField: ReadonlyMap<SourceMetricField, number>,
    valuesBySource: ReadonlyMap<string, Float64Array>,
    valueCount: number,
  ) {
    this.#snapshot = snapshot;
    this.#unitsPerEm = unitsPerEm;
    this.#positionIndexByKind = positionIndexByKind;
    this.#technicalIndexByField = technicalIndexByField;
    this.#valuesBySource = valuesBySource;
    this.#valueCount = valueCount;
  }

  /**
   * Validates and compiles a workspace interpolation snapshot.
   *
   * @returns A reusable interpolation object, or `null` when the transport
   * vector layout does not match its declared metric and technical fields.
   */
  static from(
    snapshot: SourceMetricsInterpolationSnapshot | null,
    definitions: readonly MetricDefinition[],
    metrics: FontMetrics,
  ): SourceMetricsInterpolation | null {
    if (!snapshot) return null;

    const positionIndexByKind = new Map<MetricKind, number>();
    for (const definition of definitions) {
      const metricIndex = snapshot.metricIds.indexOf(definition.id);
      if (metricIndex < 0) continue;

      positionIndexByKind.set(definition.kind, metricIndex * 2);
    }

    const technicalOffset = snapshot.metricIds.length * 2;
    const technicalIndexByField = new Map<SourceMetricField, number>();
    snapshot.technicalFields.forEach((field, index) => {
      technicalIndexByField.set(field, technicalOffset + index);
    });
    const valueCount = technicalOffset + snapshot.technicalFields.length;
    if (snapshot.basis.sourceIds.length !== snapshot.sources.length) return null;

    const valuesBySource = new Map(
      snapshot.sources.map((source) => [source.sourceId, Float64Array.from(source.values)]),
    );
    if (valuesBySource.size !== snapshot.sources.length) return null;
    if (snapshot.basis.sourceIds.some((sourceId) => !valuesBySource.has(sourceId))) return null;
    if ([...valuesBySource.values()].some((values) => values.length !== valueCount)) return null;

    return new SourceMetricsInterpolation(
      snapshot,
      metrics.unitsPerEm,
      positionIndexByKind,
      technicalIndexByField,
      valuesBySource,
      valueCount,
    );
  }

  /** Resolves interpolated source metrics at one internal design-space location. */
  resolve(location: AxisLocation, axes: readonly Axis[]): SourceMetrics | null {
    const weights = interpolationWeights(this.#snapshot.basis, location, axes);
    const values = interpolateSourceValues(
      this.#snapshot.basis,
      weights,
      (sourceId) => this.#valuesBySource.get(sourceId) ?? null,
    );
    if (!values) return null;
    if (values.length !== this.#valueCount) return null;

    const position = (kind: MetricKind): number | undefined => {
      const index = this.#positionIndexByKind.get(kind);
      return index === undefined ? undefined : values[index];
    };
    const technical = (field: SourceMetricField): number | undefined => {
      const index = this.#technicalIndexByField.get(field);
      return index === undefined ? undefined : values[index];
    };
    const metricValues = this.#snapshot.metricIds.map((metricId, metricIndex) => ({
      metricId,
      position: values[metricIndex * 2] ?? 0,
      overshoot: values[metricIndex * 2 + 1] ?? 0,
    }));

    return {
      unitsPerEm: this.#unitsPerEm,
      metricValues,
      ascender: position("ascender") ?? this.#unitsPerEm * 0.8,
      descender: position("descender") ?? this.#unitsPerEm * -0.2,
      baseline: position("baseline") ?? 0,
      capHeight: position("capHeight"),
      xHeight: position("xHeight"),
      italicAngle: technical("italicAngle"),
      lineGap: technical("lineGap"),
      underlinePosition: technical("underlinePosition"),
      underlineThickness: technical("underlineThickness"),
    };
  }
}
