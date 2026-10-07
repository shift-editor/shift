//! Product presets use complete external locations and never create master sources.

use miette::{Result, bail, miette};
use shift_font::{
    AxisKind, AxisRole, ExternalLocation, Font, FontIntent, FontIntentSet, NamedInstance,
};

use crate::cli::{AddInstanceArgs, RemoveInstanceArgs, SetInstanceArgs};

use super::{AuthoringReport, apply_mutation, glyph::load_font, parse_location};

pub(super) mod report;

const STANDARD_WEIGHTS: [(f64, &str); 9] = [
    (100.0, "Thin"),
    (200.0, "ExtraLight"),
    (300.0, "Light"),
    (400.0, "Regular"),
    (500.0, "Medium"),
    (600.0, "SemiBold"),
    (700.0, "Bold"),
    (800.0, "ExtraBold"),
    (900.0, "Black"),
];

/// Adds a product or missing standard weights without replacing existing IDs.
///
/// Omitted external axes use their authored defaults. Presets skip occupied
/// external locations regardless of the existing product's name.
///
/// # Errors
///
/// Returns an error for invalid location syntax, missing external `wght` for
/// presets, invalid product authoring, or document/persistence failure.
pub fn add_instance(args: AddInstanceArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let intents = if args.standard_weights {
        standard_weights(&font)?
    } else {
        let name = args
            .name
            .ok_or_else(|| miette!("instance add requires --name or --standard-weights"))?;
        let mut location = default_location(&font);
        for (axis_id, value) in parse_location(&font, &args.location)? {
            location.set(axis_id, value);
        }
        vec![FontIntent::CreateNamedInstance {
            instance: NamedInstance::new(name, location, args.postscript_name),
        }]
    };
    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
}

/// Edits supplied product fields while preserving identity, order, and omissions.
///
/// Location flags replace only supplied external coordinates. An authored
/// PostScript name survives unless replaced or explicitly cleared.
///
/// # Errors
///
/// Returns an error for an unknown/ambiguous selector, empty edit, invalid
/// location or product authoring, or document/persistence failure.
pub fn set_instance(args: SetInstanceArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let current = resolve_instance(&font, &args.instance)?;
    if args.name.is_none()
        && args.location.is_empty()
        && args.postscript_name.is_none()
        && !args.clear_postscript_name
    {
        bail!("instance set requires a name, location, or PostScript-name edit");
    }
    let mut location = current.location().clone();
    for (axis_id, value) in parse_location(&font, &args.location)? {
        location.set(axis_id, value);
    }
    let name = args.name.unwrap_or_else(|| current.name().to_string());
    let postscript_name = if args.clear_postscript_name {
        None
    } else {
        args.postscript_name
            .or_else(|| current.postscript_name().map(str::to_string))
    };
    let instance = NamedInstance::with_id(current.id(), name, location, postscript_name);
    apply_mutation(
        &args.path,
        &args.mutation,
        FontIntentSet {
            intents: vec![FontIntent::UpdateNamedInstance { instance }],
        },
    )
}

/// Removes one product preset without deleting any source or glyph geometry.
///
/// # Errors
///
/// Returns an error for an unknown/ambiguous selector or document/persistence failure.
pub fn remove_instance(args: RemoveInstanceArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let instance = resolve_instance(&font, &args.instance)?;
    apply_mutation(
        &args.path,
        &args.mutation,
        FontIntentSet {
            intents: vec![FontIntent::DeleteNamedInstance {
                instance_id: instance.id(),
            }],
        },
    )
}

fn default_location(font: &Font) -> ExternalLocation {
    let mut location = ExternalLocation::new();
    for axis in font
        .axes()
        .iter()
        .filter(|axis| axis.role() == AxisRole::External)
    {
        location.set(axis.id(), axis.default());
    }
    location
}

fn resolve_instance<'a>(font: &'a Font, selector: &str) -> Result<&'a NamedInstance> {
    if let Some(instance) = font
        .named_instances()
        .iter()
        .find(|instance| instance.id().to_string() == selector)
    {
        return Ok(instance);
    }
    let mut matches = font
        .named_instances()
        .iter()
        .filter(|instance| instance.name() == selector);
    let instance = matches
        .next()
        .ok_or_else(|| miette!("instance {selector:?} does not exist"))?;
    if matches.next().is_some() {
        bail!("instance name {selector:?} is ambiguous; use a full stable instance id");
    }
    Ok(instance)
}

fn standard_weights(font: &Font) -> Result<Vec<FontIntent>> {
    let axis = font
        .axis_id_by_tag("wght")
        .and_then(|axis_id| font.axis(&axis_id))
        .filter(|axis| axis.role() == AxisRole::External)
        .ok_or_else(|| miette!("--standard-weights requires an external wght axis"))?;
    let mut intents = Vec::new();
    for (value, name) in STANDARD_WEIGHTS {
        let in_range = match axis.kind() {
            AxisKind::Continuous {
                minimum, maximum, ..
            } => value >= *minimum && value <= *maximum,
            AxisKind::Discrete { values, .. } => values.contains(&value),
        };
        if !in_range {
            continue;
        }
        let mut location = default_location(font);
        location.set(axis.id(), value);
        if font
            .named_instances()
            .iter()
            .any(|instance| instance.location() == &location)
        {
            continue;
        }
        intents.push(FontIntent::CreateNamedInstance {
            instance: NamedInstance::new(name.to_string(), location, None),
        });
    }
    Ok(intents)
}
