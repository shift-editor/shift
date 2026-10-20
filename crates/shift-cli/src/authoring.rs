//! Semantic `.shift` authoring commands.
//!
//! CLI flags are translated into [`FontIntentSet`] values and applied to a
//! cloned [`Font`]. The destination is written only after the complete intent
//! set validates, so a failed command cannot partially mutate a package.

use shift_font::{CreateAxis, CreateSource};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_backends::font_loader::FontLoader;
use shift_font::{
    Axis, AxisId, BinaryData, DesignLocation, FeatureData, Font, FontIntent, FontIntentSet,
    Kerning, LibData, SourceId,
};
use shift_store::ShiftStore;
use shift_workspace::FontWorkspace;

use crate::cli::{AddAxisArgs, AddSourceArgs, CreateFontArgs, MutationArgs};

mod axis;
mod font_info;
mod glyph;
mod glyph_batch;
mod glyph_export;
mod input;
mod instance;
mod kerning;
mod layer_payload;
mod report;

pub(crate) use axis::set_axis;
pub(crate) use font_info::{font_info, set_font};
pub(crate) use glyph::{add_glyph, add_layer, copy_layer, set_layer};
pub(crate) use glyph::{resolve_glyph_id, resolve_source_id};
pub(crate) use glyph_batch::set_glyphs;
pub(crate) use glyph_export::{ExportSources, export_glyphs};
pub(crate) use instance::{add_instance, remove_instance, set_instance};
pub(crate) use kerning::{
    assign_kerning_group, create_kerning_group, delete_kerning_group, remove_kerning,
    rename_kerning_group, set_kerning, unassign_kerning_group,
};
use report::report_changes;
pub(crate) use report::{AuthoringChange, AuthoringReport};

/// Creates a canonical SQLite `.shift` document with the model's default source.
///
/// A dry run validates the path and overwrite precondition without writing.
///
/// # Errors
///
/// Returns an error for a non-`.shift` path, an existing destination, or a
/// document serialization or filesystem failure.
pub(crate) fn create_font(args: CreateFontArgs) -> Result<AuthoringReport> {
    validate_new_document_path(&args.path)?;
    let font = match &args.from {
        Some(source) => font_structure(source)?,
        None => Font::new(),
    };

    let document_id = if args.dry_run {
        None
    } else {
        let document = ShiftStore::create_document(&args.path, &font)
            .into_diagnostic()
            .wrap_err("failed to create Shift font")?;
        Some(
            document
                .document_metadata()
                .into_diagnostic()?
                .document_id
                .to_string(),
        )
    };

    Ok(AuthoringReport {
        valid: true,
        document: args.path.clone(),
        output: args.path,
        wrote: !args.dry_run,
        changes: vec![AuthoringChange::FontCreated { document_id }],
    })
}

/// The structure of the font at `path`: names, units per em, vertical metrics,
/// axes, mappings, masters, and named instances, with no glyphs, kerning,
/// feature code, library data, or embedded files.
fn font_structure(path: &Path) -> Result<Font> {
    let path_text = path
        .to_str()
        .ok_or_else(|| miette!("font path is not valid UTF-8"))?;
    let mut font = FontLoader::new()
        .read_font(path_text)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to load font {}", path.display()))?;
    // Removing from the end keeps each removal an incremental index update.
    let glyph_ids: Vec<_> = font.glyphs().map(shift_font::Glyph::id).collect();
    for glyph_id in glyph_ids.into_iter().rev() {
        font.pop_glyph(glyph_id).into_diagnostic()?;
    }
    *font.kerning_mut() = Kerning::new();
    *font.features_mut() = FeatureData::new();
    *font.lib_mut() = LibData::new();
    *font.data_files_mut() = BinaryData::new();
    *font.images_mut() = BinaryData::new();
    Ok(font)
}

/// Adds one continuous axis through Shift's semantic intent path.
///
/// # Errors
///
/// Returns an error when the document cannot be loaded, the axis is invalid or
/// conflicts with existing authoring data, or the destination cannot be saved.
pub(crate) fn add_axis(args: AddAxisArgs) -> Result<AuthoringReport> {
    let axis = Axis::new(
        args.tag,
        args.name,
        args.minimum,
        args.default,
        args.maximum,
    );
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateAxis(CreateAxis { axis })],
    };

    apply_mutation(&args.path, &args.mutation, &set)
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
pub(crate) fn add_source(args: AddSourceArgs) -> Result<AuthoringReport> {
    let font = glyph::load_font(&args.path)?;
    let mut location = DesignLocation::at_defaults(font.axes());
    for (axis_id, value) in parse_location(&font, &args.location)? {
        location.set(axis_id, value);
    }
    let source_id = SourceId::new();
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateSource(CreateSource {
            source_id,
            name: args.name,
            location,
        })],
    };

    apply_mutation(&args.path, &args.mutation, &set)
}

pub(super) fn apply_mutation(
    path: &Path,
    options: &MutationArgs,
    set: &FontIntentSet,
) -> Result<AuthoringReport> {
    let destination = mutation_destination(path, options.output.as_deref())?;
    let recovery = tempfile::tempdir()
        .into_diagnostic()
        .wrap_err("failed to create temporary recovery directory")?;
    let mut workspace = FontWorkspace::open_document(path, recovery.path().join("recovery.sqlite"))
        .into_diagnostic()
        .wrap_err("failed to open Shift document")?;
    let changes = if set.intents.is_empty() {
        Vec::new()
    } else {
        let outcome = workspace
            .apply(set, None)
            .into_diagnostic()
            .wrap_err("authoring change is invalid")?;
        report_changes(workspace.font(), &outcome.changes)
    };
    let wrote = !options.dry_run && (options.output.is_some() || !changes.is_empty());

    if !options.dry_run {
        if options.output.is_some() {
            workspace
                .save_as_document(&destination, recovery.path().join("output-recovery.sqlite"))
                .into_diagnostic()
                .wrap_err("failed to save independent Shift font")?;
        } else {
            workspace
                .save()
                .into_diagnostic()
                .wrap_err("failed to save Shift font")?;
        }
    }

    Ok(AuthoringReport {
        valid: true,
        document: path.to_path_buf(),
        output: destination,
        wrote,
        changes,
    })
}

pub(super) fn require_finite(value: f64, label: &str) -> Result<()> {
    if !value.is_finite() {
        bail!("{label} must be finite");
    }
    Ok(())
}

pub(super) fn resolve_axis_id(font: &Font, selector: &str) -> Result<AxisId> {
    if let Ok(axis_id) = selector.parse::<AxisId>()
        && font.axis(&axis_id).is_some()
    {
        return Ok(axis_id);
    }

    font.axis_id_by_tag(selector)
        .ok_or_else(|| miette!("axis {selector:?} does not exist; use its tag or full id"))
}

// Parsing resolves identity and numeric syntax only. Callers construct the
// appropriate nominal location; parsing never applies an axis mapping.
fn parse_location(font: &Font, coordinates: &[String]) -> Result<BTreeMap<AxisId, f64>> {
    let mut location = BTreeMap::new();
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
        let label = format!("location value for axis tag {tag:?}");
        require_finite(value, &label)?;

        location.insert(axis_id, value);
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
    validate_new_document_path(output)?;
    Ok(output.to_path_buf())
}

fn validate_new_document_path(path: &Path) -> Result<()> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("shift"))
    {
        bail!("Shift font path must use the .shift extension");
    }
    if path.exists() {
        bail!("refusing to overwrite existing path {}", path.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
