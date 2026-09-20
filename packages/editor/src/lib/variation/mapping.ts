import type { Axis, AxisId, AxisMappingBasis } from "@shift/types";
import { evaluateVariationBasis } from "../interpolation/VariationBasis";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";

type MappingInputLocation = ExternalAxisLocation | DesignAxisLocation;

export function mapAxisMappings(
  location: ExternalAxisLocation,
  axes: readonly Axis[],
  bases: readonly AxisMappingBasis[],
): DesignAxisLocation {
  const mapped = new Map(
    axes.map((axis) => [
      axis.id,
      axis.role === "external" ? axisLocationValue(location, axis) : axis.default,
    ]),
  );

  for (const basis of bases.filter(isIndependent)) {
    applyMapping(mapped, evaluateAxisMappingBasis(basis, location, axes));
  }

  const independentlyMapped = new Map(mapped) as unknown as DesignAxisLocation;
  for (const basis of bases.filter((basis) => !isIndependent(basis))) {
    applyMapping(mapped, evaluateAxisMappingBasis(basis, independentlyMapped, axes));
  }

  return mapped as unknown as DesignAxisLocation;
}

/**
 * Resolves external coordinates whose compiled mapping reaches a design location.
 *
 * @remarks
 * Independent mappings are piecewise linear, so their compiled support boundaries
 * provide an exact inverse without reading authoring points. When a design location
 * is not externally reachable, the result preserves its externally controlled axes;
 * derived internal axes remain owned by the forward mapping.
 *
 * @param location - Design-space source location to represent in user controls.
 * @param axes - Complete axis definitions governing defaults, ranges, and roles.
 * @param bases - Rust-compiled mappings evaluated by the forward mapping path.
 * @returns A fresh external location containing only user-controlled axes.
 */
export function unmapAxisMappings(
  location: DesignAxisLocation,
  axes: readonly Axis[],
  bases: readonly AxisMappingBasis[],
): ExternalAxisLocation {
  const external = new Map<AxisId, number>();

  for (const axis of axes) {
    if (axis.role !== "external") continue;

    const target = axisLocationValue(location, axis);
    const mapping = bases.find(
      (basis) => isIndependent(basis) && basis.outputAxisIds[0] === axis.id,
    );
    external.set(axis.id, mapping ? unmapIndependentAxis(target, axis, mapping, axes) : target);
  }

  return external as unknown as ExternalAxisLocation;
}

/** Evaluates one Rust/Fontdrasil-compiled axis mapping basis. */
export function evaluateAxisMappingBasis(
  mapping: AxisMappingBasis,
  location: MappingInputLocation,
  axes: readonly Axis[],
): DesignAxisLocation {
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));
  const adjustments = evaluateVariationBasis(mapping.basis, location, axes);

  return new Map(
    mapping.outputAxisIds.map((axisId, index) => {
      const axis = axesById.get(axisId);
      if (!axis)
        throw new Error(`axis mapping ${mapping.mappingId} references unknown axis ${axisId}`);
      const base = axisLocationValue(location, axis);
      return [
        axis.id,
        denormalizeAxis(normalizeAxis(base, axis) + (adjustments[index] ?? 0), axis),
      ];
    }),
  ) as unknown as DesignAxisLocation;
}

function unmapIndependentAxis(
  target: number,
  axis: Axis,
  mapping: AxisMappingBasis,
  axes: readonly Axis[],
): number {
  const candidates = inverseCandidates(target, axis, mapping);
  let best = candidates[0] ?? axis.default;
  let bestError = Math.abs(evaluateIndependentAxis(best, axis, mapping, axes) - target);

  for (let index = 1; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    const error = Math.abs(evaluateIndependentAxis(candidate, axis, mapping, axes) - target);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }

  return best;
}

function inverseCandidates(target: number, axis: Axis, mapping: AxisMappingBasis): number[] {
  const authoredValues = axis.axisType === "discrete" ? (axis.values ?? [axis.default]) : [];
  if (authoredValues.length > 0) return [...authoredValues].sort((left, right) => left - right);

  const minimum = axis.minimum ?? axis.default;
  const maximum = axis.maximum ?? axis.default;
  const values = [minimum, axis.default, maximum];
  for (const delta of mapping.basis.deltas) {
    const support = delta.region.find((candidate) => candidate.axisId === axis.id);
    if (!support) continue;

    values.push(
      denormalizeAxis(support.lower, axis),
      denormalizeAxis(support.peak, axis),
      denormalizeAxis(support.upper, axis),
    );
  }

  const breakpoints = [...new Set(values)].sort((left, right) => left - right);
  const candidates = [...breakpoints];
  for (let index = 1; index < breakpoints.length; index++) {
    const left = breakpoints[index - 1]!;
    const right = breakpoints[index]!;
    const leftMapped = evaluateIndependentAxis(left, axis, mapping, [axis]);
    const rightMapped = evaluateIndependentAxis(right, axis, mapping, [axis]);
    const mappedRange = rightMapped - leftMapped;
    if (Math.abs(mappedRange) < Number.EPSILON) continue;

    const ratio = (target - leftMapped) / mappedRange;
    if (ratio > 0 && ratio < 1) candidates.push(left + ratio * (right - left));
  }

  return candidates.sort((left, right) => left - right);
}

function evaluateIndependentAxis(
  value: number,
  axis: Axis,
  mapping: AxisMappingBasis,
  axes: readonly Axis[],
): number {
  const location = new Map([[axis.id, value]]) as unknown as ExternalAxisLocation;
  return evaluateAxisMappingBasis(mapping, location, axes).get(axis.id) ?? value;
}

function applyMapping(target: Map<AxisId, number>, output: DesignAxisLocation): void {
  for (const [axisId, value] of output) target.set(axisId, value);
}

function isIndependent(basis: AxisMappingBasis): boolean {
  return (
    basis.inputAxisIds.length === 1 &&
    basis.outputAxisIds.length === 1 &&
    basis.inputAxisIds[0] === basis.outputAxisIds[0]
  );
}

function axisLocationValue(location: MappingInputLocation, axis: Axis): number {
  return location.get(axis.id) ?? axis.default;
}

function normalizeAxis(value: number, axis: Axis): number {
  const minimum = axis.minimum ?? Math.min(...(axis.values ?? [axis.default]));
  const maximum = axis.maximum ?? Math.max(...(axis.values ?? [axis.default]));

  if (value < axis.default) {
    const range = axis.default - minimum;
    return Math.abs(range) < Number.EPSILON ? 0 : (value - axis.default) / range;
  }
  if (value > axis.default) {
    const range = maximum - axis.default;
    return Math.abs(range) < Number.EPSILON ? 0 : (value - axis.default) / range;
  }
  return 0;
}

function denormalizeAxis(value: number, axis: Axis): number {
  const minimum = axis.minimum ?? Math.min(...(axis.values ?? [axis.default]));
  const maximum = axis.maximum ?? Math.max(...(axis.values ?? [axis.default]));

  if (value < 0) return axis.default + value * (axis.default - minimum);
  if (value > 0) return axis.default + value * (maximum - axis.default);
  return axis.default;
}
