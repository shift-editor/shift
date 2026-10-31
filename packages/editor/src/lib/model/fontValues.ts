import type {
  Axis,
  AxisDefinition,
  AxisId,
  AxisLabel,
  FontAxis,
  FontAxisLabel,
  MetricId,
  MetricValue,
  SourceMetricValue,
} from "@shift/types";

/**
 * `axis`, as the font's records carry it, in the shape shift-font's axis
 * edits take: its bounds or values as one kind, each label's bounds as one
 * range.
 *
 * @throws When a continuous axis lacks a bound, a discrete one its values, or
 * a label has one bound without the other.
 */
export function fontAxis(axis: AxisDefinition & { readonly id: AxisId }): FontAxis {
  return {
    id: axis.id,
    tag: axis.tag,
    name: axis.name,
    role: axis.role,
    kind: axisKind(axis),
    labels: axis.labels.map(fontAxisLabel),
    hidden: axis.hidden,
  };
}

function axisKind(axis: Pick<Axis, "axisType" | "minimum" | "default" | "maximum" | "values">) {
  if (axis.axisType === "discrete") {
    if (axis.values == null) throw new Error("a discrete axis needs its values");
    return { kind: "discrete", values: axis.values, default: axis.default } as const;
  }
  if (axis.minimum == null || axis.maximum == null) {
    throw new Error("a continuous axis needs a minimum and a maximum");
  }
  return {
    kind: "continuous",
    minimum: axis.minimum,
    default: axis.default,
    maximum: axis.maximum,
  } as const;
}

function fontAxisLabel(label: AxisLabel): FontAxisLabel {
  // Destructured: `label.value` reads like a signal's to the reactive lint.
  const { minimum, maximum, value } = label;
  if ((minimum == null) !== (maximum == null)) {
    throw new Error("an axis label range needs both a minimum and a maximum");
  }
  const range = minimum == null || maximum == null ? null : { minimum, maximum };
  return {
    id: label.id,
    name: label.name,
    value,
    range,
    linkedValue: label.linkedValue ?? null,
    elidable: label.elidable,
  };
}

/** A source's metric values by metric row, as shift-font's source edits take them. */
export function metricValuesById(
  values: readonly SourceMetricValue[],
): Readonly<Record<MetricId, MetricValue>> {
  return Object.fromEntries(
    values.map(({ metricId, position, overshoot }) => [metricId, { position, overshoot }]),
  );
}
