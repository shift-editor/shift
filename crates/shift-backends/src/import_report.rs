use shift_font::NamedInstance;

/// Describes source concepts changed or omitted while importing into Shift.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ImportReport {
    pub losses: Vec<ImportLoss>,
}

/// One source concept that Shift cannot represent with identical semantics.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportLoss {
    pub kind: ImportLossKind,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ImportLossKind {
    Converted,
    Approximated,
    Omitted,
}

/// Keeps the first named instance at each location and describes the rest.
///
/// Sources can list two instances at one location, for example an italic
/// instance left at the condensed width, or an instance whose missing weight
/// class maps it onto another. A font can only name each location once, so
/// the later instance is left out rather than refusing the whole source.
pub(crate) fn distinct_named_instances(
    instances: Vec<NamedInstance>,
) -> (Vec<NamedInstance>, Option<ImportLoss>) {
    let mut kept: Vec<NamedInstance> = Vec::with_capacity(instances.len());
    let mut dropped = Vec::new();
    for instance in instances {
        match kept
            .iter()
            .find(|existing| existing.location() == instance.location())
        {
            Some(existing) => dropped.push(format!(
                "'{}' (at the same location as '{}')",
                instance.name(),
                existing.name()
            )),
            None => kept.push(instance),
        }
    }

    let loss = (!dropped.is_empty()).then(|| ImportLoss {
        kind: ImportLossKind::Omitted,
        message: format!(
            "{} named instance{} sit at the location of an earlier one and were omitted: {}.",
            dropped.len(),
            if dropped.len() == 1 { "" } else { "s" },
            dropped.join(", ")
        ),
    });
    (kept, loss)
}

#[cfg(test)]
mod tests {
    use shift_font::{AxisId, ExternalLocation, NamedInstance};

    use super::*;

    fn instance(name: &str, weight: f64) -> NamedInstance {
        let location = ExternalLocation::from([(AxisId::from_raw("wght"), weight)]);
        NamedInstance::new(name.to_string(), location, None)
    }

    #[test]
    fn keeps_the_first_instance_at_a_location_and_reports_the_rest() {
        let (kept, loss) = distinct_named_instances(vec![
            instance("Regular", 400.0),
            instance("Bold", 400.0),
            instance("Black", 900.0),
        ]);

        let names = kept.iter().map(NamedInstance::name).collect::<Vec<_>>();
        assert_eq!(names, ["Regular", "Black"]);
        let message = loss.unwrap().message;
        assert!(message.contains("'Bold' (at the same location as 'Regular')"));
    }

    #[test]
    fn distinct_instances_are_kept_without_a_report() {
        let (kept, loss) =
            distinct_named_instances(vec![instance("Regular", 400.0), instance("Bold", 700.0)]);

        assert_eq!(kept.len(), 2);
        assert!(loss.is_none());
    }
}
