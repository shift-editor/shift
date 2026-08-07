import type { Axis, AxisId, InterpolationSupport } from "@shift/types";
import type { AxisLocation, AxisMappingSample } from "@/types/variation";

export function mappingAdjustments(
  samples: readonly AxisMappingSample[],
  target: AxisLocation,
  axes: readonly Axis[],
): number[] {
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));
  const orderedSamples = sortSamples([...samples], axes);
  const regions = masterInfluence(axes, regionsFor(axes, orderedSamples));
  const deltas: number[][] = [];
  for (let sampleIndex = 0; sampleIndex < orderedSamples.length; sampleIndex++) {
    const sample = orderedSamples[sampleIndex];
    if (!sample) continue;
    const delta = [...sample.values];
    for (let previous = 0; previous < sampleIndex; previous++) {
      const weight = regionScalar(regions[previous] ?? [], sample.location, axesById);
      const previousDelta = deltas[previous];
      if (!previousDelta || weight === 0) continue;
      for (let outputIndex = 0; outputIndex < delta.length; outputIndex++) {
        delta[outputIndex] = (delta[outputIndex] ?? 0) - (previousDelta[outputIndex] ?? 0) * weight;
      }
    }
    deltas.push(delta);
  }

  const adjustments = samples[0]?.values.map(() => 0) ?? [];
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const scalar = regionScalar(regions[regionIndex] ?? [], target, axesById);
    const delta = deltas[regionIndex];
    if (!delta || scalar === 0) continue;
    for (let outputIndex = 0; outputIndex < adjustments.length; outputIndex++) {
      adjustments[outputIndex] =
        (adjustments[outputIndex] ?? 0) + (delta[outputIndex] ?? 0) * scalar;
    }
  }
  return adjustments;
}

function regionsFor(
  axes: readonly Axis[],
  samples: readonly AxisMappingSample[],
): InterpolationSupport[][] {
  const ranges = new Map<AxisId, [number, number]>();
  for (const axis of axes) ranges.set(axis.id, [0, 0]);
  for (const sample of samples) {
    for (const axis of axes) {
      const value = sample.location.get(axis.id) ?? 0;
      const range = ranges.get(axis.id);
      if (!range) continue;
      range[0] = Math.min(range[0], value);
      range[1] = Math.max(range[1], value);
    }
  }

  return samples.map((sample) =>
    axes.map((axis) => {
      const peak = sample.location.get(axis.id) ?? 0;
      const [minimum, maximum] = ranges.get(axis.id) ?? [0, 0];
      return {
        axisId: axis.id,
        lower: peak > 0 ? 0 : minimum,
        peak,
        upper: peak < 0 ? 0 : maximum,
      };
    }),
  );
}

function masterInfluence(
  axes: readonly Axis[],
  regions: readonly (readonly InterpolationSupport[])[],
): InterpolationSupport[][] {
  const influence: InterpolationSupport[][] = [];
  for (const original of regions) {
    const region = original.map((support) => ({ ...support }));
    for (const previous of influence) {
      if (!sameActiveAxes(region, previous)) continue;
      const previousByAxis = new Map(previous.map((support) => [support.axisId, support]));
      const overlaps = region.every((support) => {
        const previousPeak = previousByAxis.get(support.axisId)?.peak ?? 0;
        return (
          previousPeak === support.peak ||
          (support.lower < previousPeak && previousPeak < support.upper)
        );
      });
      if (!overlaps) continue;

      let bestRatio = -1;
      const replacements = new Map<AxisId, InterpolationSupport>();
      for (const axis of axes) {
        const support = region.find((candidate) => candidate.axisId === axis.id);
        if (!support || (support.lower === 0 && support.peak === 0 && support.upper === 0)) {
          continue;
        }
        const previousPeak = previousByAxis.get(axis.id)?.peak ?? 0;
        if (previousPeak === support.peak) continue;
        const replacement = { ...support };
        const ratio =
          previousPeak < support.peak
            ? (previousPeak - support.peak) / (support.lower - support.peak)
            : (previousPeak - support.peak) / (support.upper - support.peak);
        if (previousPeak < support.peak) replacement.lower = previousPeak;
        else replacement.upper = previousPeak;
        if (ratio > bestRatio) {
          replacements.clear();
          bestRatio = ratio;
        }
        if (ratio === bestRatio) replacements.set(axis.id, replacement);
      }
      for (const [axisId, replacement] of replacements) {
        const index = region.findIndex((support) => support.axisId === axisId);
        if (index >= 0) region[index] = replacement;
      }
    }
    influence.push(region);
  }
  return influence;
}

function sameActiveAxes(
  left: readonly InterpolationSupport[],
  right: readonly InterpolationSupport[],
): boolean {
  const active = (region: readonly InterpolationSupport[]) =>
    region
      .filter((support) => support.lower !== 0 || support.peak !== 0 || support.upper !== 0)
      .map((support) => support.axisId)
      .sort();
  const leftAxes = active(left);
  const rightAxes = active(right);
  return (
    leftAxes.length === rightAxes.length &&
    leftAxes.every((axis, index) => axis === rightAxes[index])
  );
}

function regionScalar(
  region: readonly InterpolationSupport[],
  location: AxisLocation,
  axesById: ReadonlyMap<AxisId, Axis>,
): number {
  let scalar = 1;
  for (const support of region) {
    if (support.lower > support.peak || support.peak > support.upper) continue;
    if (support.lower < 0 && support.upper > 0) continue;
    const axis = axesById.get(support.axisId);
    if (!axis) return 0;
    const value = location.get(axis.id) ?? 0;
    if (value === support.peak) continue;
    if (support.lower === 0 && support.peak === 0 && support.upper === 0) continue;
    if (value <= support.lower || support.upper <= value) return 0;
    const edge = value < support.peak ? support.lower : support.upper;
    scalar *= (value - edge) / (support.peak - edge);
  }
  return scalar;
}

function sortSamples(samples: AxisMappingSample[], axes: readonly Axis[]): AxisMappingSample[] {
  const onAxisPoints = new Map<AxisId, Set<number>>();
  for (const sample of samples) {
    const nonzero = axes.filter((axis) => (sample.location.get(axis.id) ?? 0) !== 0);
    if (nonzero.length !== 1) continue;
    const axis = nonzero[0];
    if (!axis) continue;
    const values = onAxisPoints.get(axis.id) ?? new Set<number>();
    values.add(sample.location.get(axis.id) ?? 0);
    onAxisPoints.set(axis.id, values);
  }

  return samples.sort((left, right) => {
    const leftValues = axes.map((axis) => left.location.get(axis.id) ?? 0);
    const rightValues = axes.map((axis) => right.location.get(axis.id) ?? 0);
    const leftNonzero = leftValues.filter((value) => value !== 0);
    const rightNonzero = rightValues.filter((value) => value !== 0);
    let comparison = leftNonzero.length - rightNonzero.length;
    if (comparison !== 0) return comparison;
    comparison =
      onAxisScore(leftValues, axes, onAxisPoints) - onAxisScore(rightValues, axes, onAxisPoints);
    if (comparison !== 0) return comparison;
    const leftIndexes = leftValues.flatMap((value, index) => (value === 0 ? [] : [index]));
    const rightIndexes = rightValues.flatMap((value, index) => (value === 0 ? [] : [index]));
    comparison = compareNumbers(leftIndexes, rightIndexes);
    if (comparison !== 0) return comparison;
    comparison = compareNumbers(leftNonzero.map(Math.sign), rightNonzero.map(Math.sign));
    if (comparison !== 0) return comparison;
    return compareNumbers(leftNonzero.map(Math.abs), rightNonzero.map(Math.abs));
  });
}

function onAxisScore(
  values: readonly number[],
  axes: readonly Axis[],
  onAxisPoints: ReadonlyMap<AxisId, ReadonlySet<number>>,
): number {
  return values.reduce((score, value, index) => {
    const axis = axes[index];
    return score - (axis && onAxisPoints.get(axis.id)?.has(value) ? 1 : 0);
  }, 0);
}

function compareNumbers(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const comparison = (left[index] ?? 0) - (right[index] ?? 0);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}
