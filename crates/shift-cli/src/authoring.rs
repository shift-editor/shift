//! Semantic `.shift` authoring commands.
//!
//! CLI flags are translated into [`FontIntentSet`] values and applied to a
//! cloned [`Font`]. The destination is written only after the complete intent
//! set validates, so a failed command cannot partially mutate a package.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use serde::Serialize;
use shift_font::{Axis, AxisId, Font, FontChange, FontIntent, FontIntentSet, Location, SourceId};
use shift_source::ShiftSourcePackage;

use crate::cli::{AddAxisArgs, AddSourceArgs, CreateFontArgs, MutationArgs};

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
    let axis_id = args.id.map_or_else(AxisId::new, AxisId::from_raw);
    let axis = Axis::with_id(
        axis_id,
        args.tag,
        args.name,
        args.minimum,
        args.default,
        args.maximum,
    );
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateAxis { axis }],
    };

    apply_mutation(&args.path, &args.mutation, font, set, None)
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
    let (location, rendered_location) = parse_location(&font, &args.location)?;
    let source_id = args.id.map_or_else(SourceId::new, SourceId::from_raw);
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateSource {
            source_id,
            name: args.name,
            location,
        }],
    };

    apply_mutation(
        &args.path,
        &args.mutation,
        font,
        set,
        Some(rendered_location),
    )
}

fn apply_mutation(
    path: &Path,
    options: &MutationArgs,
    font: Font,
    set: FontIntentSet,
    source_location: Option<BTreeMap<String, f64>>,
) -> Result<AuthoringReport> {
    let destination = mutation_destination(path, options.output.as_deref())?;
    let mut next = font.clone();
    let outcome = next
        .apply_intents(set)
        .into_diagnostic()
        .wrap_err("authoring change is invalid")?;
    let changes = report_changes(outcome.changes.changes, source_location);

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

fn report_changes(
    changes: Vec<FontChange>,
    source_location: Option<BTreeMap<String, f64>>,
) -> Vec<AuthoringChange> {
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
                location: source_location.clone().unwrap_or_default(),
            }),
            FontChange::NamedInstancesUpdated(change) => {
                Some(AuthoringChange::NamedInstancesUpdated {
                    count: change.instances.len(),
                })
            }
            _ => None,
        })
        .collect()
}

fn parse_location(
    font: &Font,
    coordinates: &[String],
) -> Result<(Location, BTreeMap<String, f64>)> {
    let mut location = Location::new();
    let mut rendered = BTreeMap::new();
    for axis in font.axes() {
        location.set(axis.id(), axis.default());
        rendered.insert(axis.tag().to_string(), axis.default());
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
        rendered.insert(tag.to_string(), value);
    }

    Ok((location, rendered))
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
mod tests {
    use std::fs;

    use super::*;

    fn mutation(dry_run: bool) -> MutationArgs {
        MutationArgs {
            output: None,
            dry_run,
            json: false,
        }
    }

    fn create_package(path: &Path) {
        create_font(CreateFontArgs {
            path: path.to_path_buf(),
            dry_run: false,
            json: false,
        })
        .unwrap();
    }

    fn weight_axis(path: &Path, mutation: MutationArgs) -> AddAxisArgs {
        AddAxisArgs {
            path: path.to_path_buf(),
            id: Some("weight".to_string()),
            tag: "wght".to_string(),
            name: "Weight".to_string(),
            minimum: 100.0,
            default: 400.0,
            maximum: 900.0,
            mutation,
        }
    }

    #[test]
    fn create_font_writes_a_new_package_and_refuses_to_overwrite_it() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");

        let report = create_font(CreateFontArgs {
            path: path.clone(),
            dry_run: false,
            json: false,
        })
        .unwrap();

        assert!(report.wrote);
        assert_eq!(
            ShiftSourcePackage::load_font(&path)
                .unwrap()
                .sources()
                .len(),
            1
        );
        assert!(
            create_font(CreateFontArgs {
                path,
                dry_run: false,
                json: false,
            })
            .is_err()
        );
    }

    #[test]
    fn axis_dry_run_uses_real_validation_without_writing() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");
        create_package(&path);
        let before = fs::read(&path).unwrap();

        let report = add_axis(weight_axis(&path, mutation(true))).unwrap();

        assert!(!report.wrote);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(
            ShiftSourcePackage::load_font(&path)
                .unwrap()
                .axes()
                .is_empty()
        );
    }

    #[test]
    fn axis_mutation_preserves_package_identity() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");
        create_package(&path);
        let package_id = ShiftSourcePackage::open(&path)
            .unwrap()
            .package_id()
            .clone();

        add_axis(weight_axis(&path, mutation(false))).unwrap();

        let package = ShiftSourcePackage::open(&path).unwrap();
        let font = ShiftSourcePackage::load_font(&path).unwrap();
        assert_eq!(package.package_id(), &package_id);
        assert_eq!(font.axes()[0].tag(), "wght");
    }

    #[test]
    fn invalid_axis_does_not_change_the_package() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");
        create_package(&path);
        let before = fs::read(&path).unwrap();
        let mut args = weight_axis(&path, mutation(false));
        args.minimum = 500.0;
        args.default = 400.0;

        assert!(add_axis(args).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn output_writes_an_independent_package_without_changing_input() {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("Lab.shift");
        let output = temp.path().join("Variant.shift");
        create_package(&input);
        let before = fs::read(&input).unwrap();
        let mut options = mutation(false);
        options.output = Some(output.clone());

        add_axis(weight_axis(&input, options)).unwrap();

        assert_eq!(fs::read(&input).unwrap(), before);
        assert!(
            ShiftSourcePackage::load_font(&input)
                .unwrap()
                .axes()
                .is_empty()
        );
        assert_eq!(
            ShiftSourcePackage::load_font(&output).unwrap().axes().len(),
            1
        );
        assert_ne!(
            ShiftSourcePackage::open(&input).unwrap().package_id(),
            ShiftSourcePackage::open(&output).unwrap().package_id()
        );
    }

    #[test]
    fn source_location_is_completed_with_axis_defaults() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Lab.shift");
        create_package(&path);
        add_axis(weight_axis(&path, mutation(false))).unwrap();

        add_source(AddSourceArgs {
            path: path.clone(),
            id: Some("black".to_string()),
            name: "Black".to_string(),
            location: vec!["wght=900".to_string()],
            mutation: mutation(false),
        })
        .unwrap();

        let font = ShiftSourcePackage::load_font(&path).unwrap();
        let source = font
            .sources()
            .iter()
            .find(|source| source.name() == "Black")
            .unwrap();
        assert_eq!(source.location().get(&font.axes()[0].id()), Some(900.0));
    }
}
