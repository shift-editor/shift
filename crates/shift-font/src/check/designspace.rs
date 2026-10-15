//! Checks on axes, axis mappings, and where masters sit.

use crate::{CoreResult, DesignNormalization, Font, Source};

use super::{Check, Finding};

/// Locations closer than this, in design units, are the same location.
const SAME: f64 = 1e-6;

pub(super) fn check(font: &Font) -> CoreResult<Vec<Finding>> {
    let mut findings = Vec::new();
    if !font.is_variable() {
        return Ok(findings);
    }

    let normalization = font.design_normalization()?;
    let masters = font.masters().collect::<Vec<_>>();
    default_master(font, &normalization, &mut findings);
    duplicate_locations(font, &masters, &mut findings);
    outside_axes(font, &masters, &normalization, &mut findings);
    beyond_masters(font, &masters, &normalization, &mut findings);
    mappings(font, &mut findings);
    Ok(findings)
}

fn default_master(font: &Font, normalization: &[DesignNormalization], out: &mut Vec<Finding>) {
    let at_default = |source: &Source| {
        font.axes().iter().zip(normalization).all(|(axis, bounds)| {
            let value = source.location().get(&axis.id()).unwrap_or(bounds.default);
            (value - bounds.default).abs() <= SAME
        })
    };

    if font.masters().any(at_default) {
        return;
    }

    let defaults = font
        .axes()
        .iter()
        .zip(normalization)
        .map(|(axis, bounds)| format!("{} {}", axis.tag(), number(bounds.default)))
        .collect::<Vec<_>>()
        .join(", ");
    out.push(Finding::font(
        Check::NoDefaultMaster,
        format!("no master sits at the default location ({defaults})"),
    ));
}

fn duplicate_locations(font: &Font, masters: &[&Source], out: &mut Vec<Finding>) {
    for (index, master) in masters.iter().enumerate() {
        let Some(earlier) = masters[..index].iter().find(|earlier| {
            earlier
                .location()
                .is_equivalent_to(master.location(), font.axes())
        }) else {
            continue;
        };

        out.push(
            Finding::font(
                Check::DuplicateMasterLocation,
                format!(
                    "masters '{}' and '{}' sit at the same location",
                    earlier.name(),
                    master.name()
                ),
            )
            .in_source(master.id()),
        );
    }
}

fn outside_axes(
    font: &Font,
    masters: &[&Source],
    normalization: &[DesignNormalization],
    out: &mut Vec<Finding>,
) {
    for master in masters {
        for (axis, bounds) in font.axes().iter().zip(normalization) {
            let Some(value) = master.location().get(&axis.id()) else {
                continue;
            };
            if value >= bounds.minimum - SAME && value <= bounds.maximum + SAME {
                continue;
            }

            out.push(
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
            );
        }
    }
}

fn beyond_masters(
    font: &Font,
    masters: &[&Source],
    normalization: &[DesignNormalization],
    out: &mut Vec<Finding>,
) {
    for (axis, bounds) in font.axes().iter().zip(normalization) {
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
            continue;
        }

        out.push(Finding::font(
            Check::AxisBeyondMasters,
            format!(
                "no master on {} {}, so the font stops changing there",
                axis.tag(),
                ends.join(" or ")
            ),
        ));
    }
}

/// Reports independent mappings whose output rises and falls, so two inputs
/// reach the same design value.
///
/// A mapping that only ever falls is a deliberately reversed axis, not a
/// mistake.
fn mappings(font: &Font, out: &mut Vec<Finding>) {
    for mapping in font.axis_mappings() {
        if !mapping.is_independent() {
            continue;
        }

        let axis_id = &mapping.inputs()[0];
        let mut points = mapping
            .points()
            .iter()
            .filter_map(|point| Some((point.input.get(axis_id)?, point.output.get(axis_id)?)))
            .collect::<Vec<_>>();
        points.sort_by(|left, right| left.0.total_cmp(&right.0));

        let rises = points.windows(2).find(|pair| pair[1].1 > pair[0].1 + SAME);
        let falls = points.windows(2).find(|pair| pair[1].1 < pair[0].1 - SAME);
        let (Some(_), Some(fall)) = (rises, falls) else {
            continue;
        };

        let tag = font.axis(axis_id).map_or("?", |axis| axis.tag());
        out.push(Finding::font(
            Check::MappingNotMonotonic,
            format!(
                "mapping '{}' turns back on {tag}: {} maps to {} but {} maps to {}",
                mapping.name(),
                number(fall[0].0),
                number(fall[0].1),
                number(fall[1].0),
                number(fall[1].1)
            ),
        ));
    }
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
