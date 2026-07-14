use shift_font::{MetricDefinition, MetricKind, MetricValue, Source};

pub(crate) fn metric_position(
    definitions: &[MetricDefinition],
    source: &Source,
    kind: MetricKind,
) -> Option<f64> {
    let definition = definitions
        .iter()
        .find(|definition| definition.kind() == kind)?;
    source
        .metric_value(&definition.id())
        .map(|value| value.position)
}

pub(crate) fn set_metric_position(
    definitions: &[MetricDefinition],
    source: &mut Source,
    kind: MetricKind,
    position: Option<f64>,
) {
    let Some(position) = position else {
        return;
    };
    let Some(definition) = definitions
        .iter()
        .find(|definition| definition.kind() == kind)
    else {
        return;
    };
    let overshoot = source
        .metric_value(&definition.id())
        .map(|value| value.overshoot)
        .unwrap_or_default();
    source.set_metric_value(definition.id(), MetricValue::new(position, overshoot));
}

pub(crate) fn copy_source_metrics(
    source_definitions: &[MetricDefinition],
    source: &Source,
    target_definitions: &[MetricDefinition],
    target: &mut Source,
) {
    for kind in [
        MetricKind::Ascender,
        MetricKind::CapHeight,
        MetricKind::XHeight,
        MetricKind::Baseline,
        MetricKind::Descender,
    ] {
        set_metric_position(
            target_definitions,
            target,
            kind,
            metric_position(source_definitions, source, kind),
        );
    }

    target.set_italic_angle(source.italic_angle());
    target.set_line_gap(source.line_gap());
    target.set_underline_position(source.underline_position());
    target.set_underline_thickness(source.underline_thickness());
}
