import type { Axis, AxisId, AxisMappingBasis } from "@shift/types";
import { evaluateVariationBasis } from "@/lib/interpolation/VariationBasis";
import type { AxisLocation } from "@/types/variation";

export function mapAxisMappings(
  location: AxisLocation,
  axes: readonly Axis[],
  bases: readonly AxisMappingBasis[],
): AxisLocation {
  const mapped = new Map(
    axes.map((axis) => [
      axis.id,
      axis.role === "external" ? axisLocationValue(location, axis) : axis.default,
    ]),
  );

  for (const basis of bases.filter(isIndependent)) {
    applyMapping(mapped, evaluateAxisMappingBasis(basis, location, axes));
  }

  const independentlyMapped = new Map(mapped);
  for (const basis of bases.filter((basis) => !isIndependent(basis))) {
    applyMapping(mapped, evaluateAxisMappingBasis(basis, independentlyMapped, axes));
  }

  return mapped;
}

/** Evaluates one Rust/Fontdrasil-compiled axis mapping basis. */
export function evaluateAxisMappingBasis(
  mapping: AxisMappingBasis,
  location: AxisLocation,
  axes: readonly Axis[],
): AxisLocation {
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
  );
}

function applyMapping(target: Map<AxisId, number>, output: AxisLocation): void {
  for (const [axisId, value] of output) target.set(axisId, value);
}

function isIndependent(basis: AxisMappingBasis): boolean {
  return (
    basis.inputAxisIds.length === 1 &&
    basis.outputAxisIds.length === 1 &&
    basis.inputAxisIds[0] === basis.outputAxisIds[0]
  );
}

function axisLocationValue(location: AxisLocation, axis: Axis): number {
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
