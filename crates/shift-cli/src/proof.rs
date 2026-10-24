//! `shift proof`: renders text or a glyph grid set in a font to an image so
//! a person or agent can look at it.
//!
//! The CLI only resolves input: it compiles the source in memory, finds the
//! locations to set, and writes the image. Shaping, layout, rendering, and
//! the report come from [`shift_proof`].

mod args;
mod summary;

use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_backends::FontExporter;
use shift_backends::font_loader::FontLoader;
use shift_font::Font;
use shift_proof::{
    AxisValue, Coordinates, ImageFormat, ProofError, ProofLocation, ProofMode, ProofRequest,
    ShapingOptions,
};

pub(crate) use args::ProofArgs;
pub(crate) use summary::ProofSummary;

/// Compiles the font at `args.path`, renders the proof, and writes it to
/// `args.output`, replacing any existing file.
///
/// Nothing is written when any step fails.
///
/// # Errors
///
/// Returns a diagnostic when the font cannot be read or compiled, masters
/// are asked of a compiled binary, the font has no named instances to set,
/// the proof is invalid (see [`ProofError`]), or the image cannot be
/// written.
pub(crate) fn proof(args: &ProofArgs) -> Result<ProofSummary> {
    let (binary, source) = compile_font(&args.path)?;
    let mut locations: Vec<ProofLocation> = args
        .at
        .iter()
        .map(|at| ProofLocation::user(at.0.clone()))
        .collect();
    if args.instances {
        let instances = shift_proof::named_instances(&binary).map_err(diagnose)?;
        if instances.is_empty() {
            bail!("the compiled font has no named instances");
        }
        locations.extend(instances);
    }
    if args.masters {
        let Some(source) = &source else {
            bail!(
                help = "use --instances, or proof the font source",
                "a compiled font has no masters"
            );
        };
        locations.extend(master_locations(source)?);
    }

    let request = ProofRequest {
        mode: if args.grid {
            ProofMode::Grid
        } else {
            ProofMode::Text
        },
        lines: args.text.clone(),
        locations,
        sizes: args.sizes.clone(),
        width: args.width,
        guides: args.metrics,
        shaping: ShapingOptions {
            features: args.features.clone(),
            script: args.script.clone(),
            language: args.language.clone(),
            direction: args.direction,
        },
        format: args.format.map_or_else(
            || ImageFormat::from_file_name(&args.output.to_string_lossy()),
            ImageFormat::from,
        ),
    };
    let proof = shift_proof::render_proof(&binary, &request).map_err(diagnose)?;
    std::fs::write(&args.output, &proof.image)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to write proof to {}", args.output.display()))?;

    Ok(ProofSummary {
        output: args.output.display().to_string(),
        report: proof.report,
    })
}

/// Reads `path` and returns TrueType or OpenType bytes ready for shaping,
/// plus the source font when there is one.
///
/// `.ttf` and `.otf` files are used as they are; every other source,
/// including `.shift`, is loaded into the Shift model and compiled in memory
/// through the same exporter as `compile`.
fn compile_font(path: &Path) -> Result<(Vec<u8>, Option<Font>)> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "ttf" | "otf") {
        let binary = std::fs::read(path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read font {}", path.display()))?;
        return Ok((binary, None));
    }

    let path_text = path
        .to_str()
        .ok_or_else(|| miette!("font path is not valid UTF-8"))?;
    let font = FontLoader::new()
        .read_font(path_text)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to load font {}", path.display()))?;
    let binary = FontExporter::new()
        .compile_ttf(&font)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to compile {} for proofing", path.display()))?;
    Ok((binary, Some(font)))
}

/// Locates every master by its design location, normalized by each axis's
/// design extrema: the coordinates the compiled variation data uses, so no
/// inverse of the axis mappings is needed.
///
/// Masters are ordered by location, axis by axis in font axis order, so
/// intermediate (brace) masters sit between the masters around them.
fn master_locations(font: &Font) -> Result<Vec<ProofLocation>> {
    let normalization = font
        .design_normalization()
        .into_diagnostic()
        .wrap_err("failed to normalize the master locations")?;
    let mut locations = font
        .masters()
        .map(|source| {
            let coordinates = font
                .axes()
                .iter()
                .zip(&normalization)
                .map(|(axis, axis_normalization)| {
                    let design = source
                        .location()
                        .get(&axis.id())
                        .unwrap_or(axis_normalization.default);
                    #[expect(
                        clippy::cast_possible_truncation,
                        reason = "a normalized coordinate lies in -1..=1, where f32 is exact enough"
                    )]
                    let value = axis_normalization.normalize(design) as f32;
                    AxisValue {
                        tag: axis.tag().to_string(),
                        value,
                    }
                })
                .collect();
            ProofLocation {
                label: Some(source.name().to_string()),
                coordinates: Coordinates::Normalized(coordinates),
            }
        })
        .collect::<Vec<_>>();
    locations.sort_by(|left, right| {
        let values = |location: &ProofLocation| match &location.coordinates {
            Coordinates::Normalized(values) | Coordinates::User(values) => {
                values.iter().map(|value| value.value).collect::<Vec<_>>()
            }
        };
        let (left, right) = (values(left), values(right));
        left.iter()
            .zip(&right)
            .map(|(a, b)| a.total_cmp(b))
            .find(|ordering| ordering.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(locations)
}

/// Adds the flag a person would change to fix a proof error.
fn diagnose(error: ProofError) -> miette::Report {
    let help = match &error {
        ProofError::NoCharacters => {
            Some("add glyphs with `glyph add NAME --unicode U+XXXX` and draw them with `layer add`")
        }
        ProofError::MultipleGridSizes => Some("pass a single --sizes value with --grid"),
        ProofError::PageTooLarge { .. } => Some("use fewer lines, smaller --sizes, or --width"),
        ProofError::UnknownAxis { .. } | ProofError::AxisOutOfRange { .. } => {
            Some("--at takes external user-space values, such as wght=700")
        }
        _ => None,
    };
    match help {
        Some(help) => miette!(help = help, "{error}"),
        None => miette::Report::new(DiagnosticError(error)),
    }
}

/// Carries a [`ProofError`] with its source chain into miette.
#[derive(Debug, thiserror::Error, miette::Diagnostic)]
#[error(transparent)]
struct DiagnosticError(ProofError);
