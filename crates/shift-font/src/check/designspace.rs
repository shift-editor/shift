//! Checks on axes, axis mappings, and where masters sit.

use crate::{CoreResult, DesignNormalization, Font, Source};

use super::{Check, Finding};

/// Locations closer than this, in design units, are the same location.
const SAME: f64 = 1e-6;

pub(super) fn check(font: &Font) -> CoreResult<Vec<Finding>> {
    if !font.is_variable() {
        return Ok(Vec::new());
    }

    let normalization = font.design_normalization()?;
    let masters = font.masters().collect::<Vec<_>>();
    let findings = default_master(font, &normalization)
        .into_iter()
        .chain(duplicate_locations(font, &masters))
        .chain(outside_axes(font, &masters, &normalization))
        .chain(beyond_masters(font, &masters, &normalization))
        .chain(mappings(font))
        .collect();
    Ok(findings)
}

fn default_master(font: &Font, normalization: &[DesignNormalization]) -> Option<Finding> {
    let at_default = |source: &Source| {
        font.axes().iter().zip(normalization).all(|(axis, bounds)| {
            let value = source.location().get(&axis.id()).unwrap_or(bounds.default);
            (value - bounds.default).abs() <= SAME
        })
    };

    if font.masters().any(at_default) {
        return None;
    }

    let defaults = font
        .axes()
        .iter()
        .zip(normalization)
        .map(|(axis, bounds)| format!("{} {}", axis.tag(), number(bounds.default)))
        .collect::<Vec<_>>()
        .join(", ");
    Some(Finding::font(
        Check::NoDefaultMaster,
        format!("no master sits at the default location ({defaults})"),
    ))
}

fn duplicate_locations<'a>(
    font: &'a Font,
    masters: &'a [&Source],
) -> impl Iterator<Item = Finding> + 'a {
    masters.iter().enumerate().filter_map(|(index, master)| {
        let earlier = masters[..index].iter().find(|earlier| {
            earlier
                .location()
                .is_equivalent_to(master.location(), font.axes())
        })?;

        Some(
            Finding::font(
                Check::DuplicateMasterLocation,
                format!(
                    "masters '{}' and '{}' sit at the same location",
                    earlier.name(),
                    master.name()
                ),
            )
            .in_source(master.id()),
        )
    })
}

fn outside_axes<'a>(
    font: &'a Font,
    masters: &'a [&Source],
    normalization: &'a [DesignNormalization],
) -> impl Iterator<Item = Finding> + 'a {
    masters.iter().flat_map(move |master| {
        font.axes()
            .iter()
            .zip(normalization)
            .filter_map(move |(axis, bounds)| {
                let value = master.location().get(&axis.id())?;
                if value >= bounds.minimum - SAME && value <= bounds.maximum + SAME {
                    return None;
                }

                Some(
                    Finding::font(
                        Check::MasterOutsideAxis,
                        format!(
                            "master '{}' sits at {} {}, outside the axis ({} to {})",
                            master.name(),
                            axis.tag(),
                            number(value),
                            number(bounds.minimum),
                            number(bounds.maximum)
                        ),
                    )
                    .in_source(master.id()),
                )
            })
    })
}

fn beyond_masters<'a>(
    font: &'a Font,
    masters: &'a [&Source],
    normalization: &'a [DesignNormalization],
) -> impl Iterator<Item = Finding> + 'a {
    let axes = font.axes().iter().zip(normalization);
    axes.filter_map(|(axis, bounds)| {
        let values = masters
            .iter()
            .map(|master| master.location().get(&axis.id()).unwrap_or(bounds.default))
            .collect::<Vec<_>>();
        let lowest = values.iter().copied().fold(bounds.default, f64::min);
        let highest = values.iter().copied().fold(bounds.default, f64::max);

        let mut ends = Vec::new();
        if lowest - bounds.minimum > SAME {
            ends.push(format!(
                "below {} (the axis goes to {})",
                number(lowest),
                number(bounds.minimum)
            ));
        }
        if bounds.maximum - highest > SAME {
            ends.push(format!(
                "above {} (the axis goes to {})",
                number(highest),
                number(bounds.maximum)
            ));
        }
        if ends.is_empty() {
            return None;
        }

        Some(Finding::font(
            Check::AxisBeyondMasters,
            format!(
                "no master on {} {}, so the font stops changing there",
                axis.tag(),
                ends.join(" or ")
            ),
        ))
    })
}

/// Reports independent mappings whose output rises and falls, so two inputs
/// reach the same design value.
///
/// A mapping that only ever falls is a deliberately reversed axis, not a
/// mistake.
fn mappings(font: &Font) -> impl Iterator<Item = Finding> + '_ {
    let independent = font
        .axis_mappings()
        .iter()
        .filter(|mapping| mapping.is_independent());
    independent.filter_map(|mapping| {
        let axis_id = &mapping.inputs()[0];
        let mut points = mapping
            .points()
            .iter()
            .filter_map(|point| Some((point.input.get(*axis_id)?, point.output.get(*axis_id)?)))
            .collect::<Vec<_>>();
        points.sort_by(|left, right| left.0.total_cmp(&right.0));

        let rises = points.windows(2).find(|pair| pair[1].1 > pair[0].1 + SAME);
        let falls = points.windows(2).find(|pair| pair[1].1 < pair[0].1 - SAME);
        let (Some(_), Some(fall)) = (rises, falls) else {
            return None;
        };

        let tag = font.axis(*axis_id).map_or("?", |axis| axis.tag());
        Some(Finding::font(
            Check::MappingNotMonotonic,
            format!(
                "mapping '{}' turns back on {tag}: {} maps to {} but {} maps to {}",
                mapping.name(),
                number(fall[0].0),
                number(fall[0].1),
                number(fall[1].0),
                number(fall[1].1)
            ),
        ))
    })
}

/// Formats a coordinate without a trailing `.0`.
pub(super) fn number(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded.fract() == 0.0 {
        format!("{rounded:.0}")
    } else {
        format!("{rounded}")
    }
}
