//! Semantic `.shift` authoring commands.
//!
//! CLI flags are translated into [`FontIntentSet`] values and applied to a
//! cloned [`Font`]. The destination is written only after the complete intent
//! set validates, so a failed command cannot partially mutate a package.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use serde::Serialize;
use shift_font::{Axis, Font, FontChange, FontIntent, FontIntentSet, Location, SourceId};
use shift_source::ShiftSourcePackage;

use crate::cli::{AddAxisArgs, AddSourceArgs, CreateFontArgs, MutationArgs};

mod glyph;

pub use glyph::{add_glyph, add_layer, copy_layer};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringReport {
    pub valid: bool,
    pub document: PathBuf,
    pub output: PathBuf,
    pub wrote: bool,
    pub changes: Vec<AuthoringChange>,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthoringChange {
    FontCreated {
        package_id: Option<String>,
    },
    AxisCreated {
        axis_id: String,
        tag: String,
        name: String,
        minimum: f64,
        default: f64,
        maximum: f64,
    },
    SourceCreated {
        source_id: String,
        name: String,
        location: BTreeMap<String, f64>,
    },
    GlyphCreated {
        glyph_id: String,
        name: String,
        unicodes: Vec<String>,
    },
    GlyphLayerCreated {
        layer_id: String,
        glyph_id: String,
        source_id: String,
        advance: f64,
        contour_count: usize,
        point_count: usize,
        anchor_count: usize,
        component_count: usize,
    },
    NamedInstancesUpdated {
        count: usize,
    },
}

impl AuthoringReport {
    pub fn render(&self) -> String {
        let mut lines = vec![self.document.display().to_string(), String::new()];
        for change in &self.changes {
            match change {
                AuthoringChange::FontCreated { package_id } => {
                    let id = package_id.as_deref().unwrap_or("assigned when written");
                    lines.push(format!("+ font    {id}"));
                }
                AuthoringChange::AxisCreated {
                    axis_id,
                    tag,
                    name,
                    minimum,
                    default,
                    maximum,
                } => lines.push(format!(
                    "+ axis    {name} ({tag})  {axis_id}  {minimum} · {default} · {maximum}"
                )),
                AuthoringChange::SourceCreated {
                    source_id,
                    name,
                    location,
                } => {
                    let location = location
                        .iter()
                        .map(|(tag, value)| format!("{tag}={value}"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    lines.push(format!("+ source  {name}  {source_id}  {location}"));
                }
                AuthoringChange::GlyphCreated {
                    glyph_id,
                    name,
                    unicodes,
                } => {
                    let unicodes = unicodes.join(", ");
                    let suffix = if unicodes.is_empty() {
                        String::new()
                    } else {
                        format!("  {unicodes}")
                    };
                    lines.push(format!("+ glyph   {name}  {glyph_id}{suffix}"));
                }
                AuthoringChange::GlyphLayerCreated {
                    layer_id,
                    glyph_id,
                    source_id,
                    advance,
                    contour_count,
                    point_count,
                    anchor_count,
                    component_count,
                } => lines.push(format!(
                    "+ layer   {layer_id}  {glyph_id} @ {source_id}  advance {advance}; {contour_count} contours, {point_count} points, {anchor_count} anchors, {component_count} components"
                )),
                AuthoringChange::NamedInstancesUpdated { count } => {
                    lines.push(format!("~ instances  {count} product locations completed"));
                }
            }
        }
        lines.push(String::new());
        if self.wrote {
            lines.push(format!("Saved {}", self.output.display()));
        } else {
            lines.push("Valid. No files written.".to_string());
        }
        lines.join("\n")
    }
}

/// Creates a canonical `.shift` package with the model's default source.
///
/// A dry run validates the path and overwrite precondition without writing.
///
/// # Errors
///
/// Returns an error for a non-`.shift` path, an existing destination, or a
/// package serialization or filesystem failure.
pub fn create_font(args: CreateFontArgs) -> Result<AuthoringReport> {
    validate_new_package_path(&args.path)?;

    let package_id = if args.dry_run {
        None
    } else {
        let package = ShiftSourcePackage::create_empty(&args.path)
            .into_diagnostic()
            .wrap_err("failed to create Shift font")?;
        Some(package.package_id().to_string())
    };

    Ok(AuthoringReport {
        valid: true,
        document: args.path.clone(),
        output: args.path,
        wrote: !args.dry_run,
        changes: vec![AuthoringChange::FontCreated { package_id }],
    })
}

/// Adds one continuous axis through Shift's semantic intent path.
///
/// # Errors
///
/// Returns an error when the package cannot be loaded, the axis is invalid or
/// conflicts with existing authoring data, or the destination cannot be saved.
pub fn add_axis(args: AddAxisArgs) -> Result<AuthoringReport> {
    let font = ShiftSourcePackage::load_font(&args.path)
        .into_diagnostic()
        .wrap_err("failed to load Shift font")?;
    let axis = Axis::new(
        args.tag,
        args.name,
        args.minimum,
        args.default,
        args.maximum,
    );
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateAxis { axis }],
    };

    apply_mutation(&args.path, &args.mutation, font, set)
}

/// Adds one master source after resolving axis tags to stable identities.
///
/// Omitted axes are completed with their design-space defaults before the
/// source is created, so the written source location is explicit.
///
/// # Errors
///
/// Returns an error for malformed coordinates, unknown or repeated tags,
/// non-finite values, invalid source authoring, or persistence failures.
pub fn add_source(args: AddSourceArgs) -> Result<AuthoringReport> {
    let font = ShiftSourcePackage::load_font(&args.path)
        .into_diagnostic()
        .wrap_err("failed to load Shift font")?;
    let location = parse_location(&font, &args.location)?;
    let source_id = SourceId::new();
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateSource {
            source_id,
            name: args.name,
            location,
        }],
    };

    apply_mutation(&args.path, &args.mutation, font, set)
}

pub(super) fn apply_mutation(
    path: &Path,
    options: &MutationArgs,
    font: Font,
    set: FontIntentSet,
) -> Result<AuthoringReport> {
    let destination = mutation_destination(path, options.output.as_deref())?;
    let mut next = font.clone();
    let outcome = next
        .apply_intents(set)
        .into_diagnostic()
        .wrap_err("authoring change is invalid")?;
    let changes = report_changes(&next, outcome.changes.changes);

    if !options.dry_run {
        if options.output.is_some() {
            ShiftSourcePackage::save_font_as(&destination, &next)
                .into_diagnostic()
                .wrap_err("failed to save independent Shift font")?;
        } else {
            ShiftSourcePackage::save_font(&destination, &next)
                .into_diagnostic()
                .wrap_err("failed to save Shift font")?;
        }
    }

    Ok(AuthoringReport {
        valid: true,
        document: path.to_path_buf(),
        output: destination,
        wrote: !options.dry_run,
        changes,
    })
}

fn report_changes(font: &Font, changes: Vec<FontChange>) -> Vec<AuthoringChange> {
    changes
        .into_iter()
        .filter_map(|change| match change {
            FontChange::AxisCreated(change) => Some(AuthoringChange::AxisCreated {
                axis_id: change.axis.id().to_string(),
                tag: change.axis.tag().to_string(),
                name: change.axis.name().to_string(),
                minimum: change.axis.minimum(),
                default: change.axis.default(),
                maximum: change.axis.maximum(),
            }),
            FontChange::SourceCreated(change) => Some(AuthoringChange::SourceCreated {
                source_id: change.source_id.to_string(),
                name: change.name,
                location: change
                    .location
                    .into_iter()
                    .filter_map(|coordinate| {
                        let tag = font
                            .axes()
                            .iter()
                            .find(|axis| axis.id() == coordinate.axis_id)?
                            .tag()
                            .to_string();
                        Some((tag, coordinate.value))
                    })
                    .collect(),
            }),
            FontChange::GlyphCreated(change) => Some(AuthoringChange::GlyphCreated {
                glyph_id: change.glyph_id.to_string(),
                name: change.name.to_string(),
                unicodes: change
                    .unicodes
                    .into_iter()
                    .map(|unicode| format!("U+{unicode:04X}"))
                    .collect(),
            }),
            FontChange::GlyphLayerCreated(change) => {
                let layer = font.layer(change.layer_id.clone())?;
                Some(AuthoringChange::GlyphLayerCreated {
                    layer_id: change.layer_id.to_string(),
                    glyph_id: change.glyph_id.to_string(),
                    source_id: change.source_id.to_string(),
                    advance: layer.width(),
                    contour_count: layer.contours().len(),
                    point_count: layer
                        .contours_iter()
                        .map(|contour| contour.points().len())
                        .sum(),
                    anchor_count: layer.anchors().len(),
                    component_count: layer.components().len(),
                })
            }
            FontChange::NamedInstancesUpdated(change) => {
                Some(AuthoringChange::NamedInstancesUpdated {
                    count: change.instances.len(),
                })
            }
            _ => None,
        })
        .collect()
}

fn parse_location(font: &Font, coordinates: &[String]) -> Result<Location> {
    let mut location = Location::new();
    for axis in font.axes() {
        location.set(axis.id(), axis.default());
    }

    let mut seen = HashSet::new();
    for coordinate in coordinates {
        let Some((tag, value)) = coordinate.split_once('=') else {
            return Err(miette!(
                "invalid location {coordinate:?}; expected TAG=VALUE"
            ));
        };
        let tag = tag.trim();
        if tag.is_empty() || !seen.insert(tag.to_string()) {
            bail!("axis tag {tag:?} is blank or repeated in the location");
        }
        let axis_id = font
            .axis_id_by_tag(tag)
            .ok_or_else(|| miette!("axis tag {tag:?} does not exist"))?;
        let value = value
            .trim()
            .parse::<f64>()
            .into_diagnostic()
            .wrap_err_with(|| format!("invalid value for axis tag {tag:?}"))?;
        if !value.is_finite() {
            bail!("location value for axis tag {tag:?} must be finite");
        }

        location.set(axis_id, value);
    }

    Ok(location)
}

fn mutation_destination(path: &Path, output: Option<&Path>) -> Result<PathBuf> {
    let Some(output) = output else {
        return Ok(path.to_path_buf());
    };
    if output == path {
        bail!("--output must differ from the input path");
    }
    validate_new_package_path(output)?;
    Ok(output.to_path_buf())
}

fn validate_new_package_path(path: &Path) -> Result<()> {
    if !ShiftSourcePackage::is_package_path(path) {
        bail!("Shift font path must use the .shift extension");
    }
    if path.exists() {
        bail!("refusing to overwrite existing path {}", path.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
