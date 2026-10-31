import type { MetricId, MetricValue, Source } from "@shift/types";

/** The source's value for one metric row; a row it has never set reads as zero. */
export function sourceMetricValue(source: Source, metricId: MetricId): MetricValue {
  return source.metricValues[metricId] ?? { position: 0, overshoot: 0 };
}

/** `source` with `value` replacing its value for metric row `metricId`, or added when it has none. */
export function withSourceMetricValue(
  source: Source,
  metricId: MetricId,
  value: MetricValue,
): Source {
  return { ...source, metricValues: { ...source.metricValues, [metricId]: value } };
}
