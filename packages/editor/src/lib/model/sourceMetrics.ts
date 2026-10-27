import { upsertBy, type MetricId, type Source, type SourceMetricValue } from "@shift/types";

/** The source's value for one metric row; a row it has never set reads as zero. */
export function sourceMetricValue(source: Source, metricId: MetricId): SourceMetricValue {
  return (
    source.metricValues.find((value) => value.metricId === metricId) ?? {
      metricId,
      position: 0,
      overshoot: 0,
    }
  );
}

/** `source` with `value` replacing its value for that metric row, or added when it has none. */
export function withSourceMetricValue(source: Source, value: SourceMetricValue): Source {
  return {
    ...source,
    metricValues: upsertBy(source.metricValues, value, (each) => each.metricId),
  };
}
