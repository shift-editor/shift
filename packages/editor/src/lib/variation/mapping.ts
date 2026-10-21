import { ascending, type Axis, type AxisId, type AxisMappingBasis } from "@shift/types";
import { denormalizeAxis, evaluateAxisMapping } from "../wasm/variation";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import { asExternalAxisLocation } from "./location";

export { mapAxisMappings } from "../wasm/variation";

/**
 * Resolves external coordinates whose compiled mapping reaches a design location.
 *
 * @remarks
 * Independent mappings are piecewise linear, so their compiled support boundaries
 * provide an exact inverse without reading authoring points. When a design location
 * is not externally reachable, the result preserves its externally controlled axes;
 * derived internal axes remain owned by the forward mapping. The forward mapping
 * itself runs in Rust; only this inverse search lives here.
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

    const target = location.get(axis.id) ?? axis.default;
    const index = bases.findIndex(
      (basis) => isIndependent(basis) && basis.outputAxisIds[0] === axis.id,
    );
    const mapping = index < 0 ? null : { bases, index, axes };
    external.set(axis.id, mapping ? unmapIndependentAxis(target, axis, mapping) : target);
  }

  return asExternalAxisLocation(external);
}

/** One independent mapping among a font's compiled mappings. */
interface IndependentMapping {
  readonly bases: readonly AxisMappingBasis[];
  readonly index: number;
  readonly axes: readonly Axis[];
}

function unmapIndependentAxis(target: number, axis: Axis, mapping: IndependentMapping): number {
  const candidates = inverseCandidates(target, axis, mapping);
  let best = candidates[0] ?? axis.default;
  let bestError = Math.abs(evaluateIndependentAxis(best, axis, mapping) - target);

  for (let index = 1; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    const error = Math.abs(evaluateIndependentAxis(candidate, axis, mapping) - target);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }

  return best;
}

function inverseCandidates(target: number, axis: Axis, mapping: IndependentMapping): number[] {
  const authoredValues = axis.axisType === "discrete" ? (axis.values ?? [axis.default]) : [];
  if (authoredValues.length > 0) return authoredValues.toSorted(ascending);

  const minimum = axis.minimum ?? axis.default;
  const maximum = axis.maximum ?? axis.default;
  const values = [minimum, axis.default, maximum];
  for (const delta of mapping.bases[mapping.index]!.basis.deltas) {
    const support = delta.region.find((candidate) => candidate.axisId === axis.id);
    if (!support) continue;

    values.push(
      denormalizeAxis(mapping.axes, axis, support.lower),
      denormalizeAxis(mapping.axes, axis, support.peak),
      denormalizeAxis(mapping.axes, axis, support.upper),
    );
  }

  const breakpoints = [...new Set(values)].sort(ascending);
  const candidates = [...breakpoints];
  for (let index = 1; index < breakpoints.length; index++) {
    const left = breakpoints[index - 1]!;
    const right = breakpoints[index]!;
    const leftMapped = evaluateIndependentAxis(left, axis, mapping);
    const rightMapped = evaluateIndependentAxis(right, axis, mapping);
    const mappedRange = rightMapped - leftMapped;
    if (Math.abs(mappedRange) < Number.EPSILON) continue;

    const ratio = (target - leftMapped) / mappedRange;
    if (ratio > 0 && ratio < 1) candidates.push(left + ratio * (right - left));
  }

  return candidates.sort(ascending);
}

function evaluateIndependentAxis(value: number, axis: Axis, mapping: IndependentMapping): number {
  const location = new Map([[axis.id, value]]);
  return (
    evaluateAxisMapping(mapping.bases, mapping.index, location, mapping.axes).get(axis.id) ?? value
  );
}

function isIndependent(basis: AxisMappingBasis): boolean {
  return (
    basis.inputAxisIds.length === 1 &&
    basis.outputAxisIds.length === 1 &&
    basis.inputAxisIds[0] === basis.outputAxisIds[0]
  );
}
