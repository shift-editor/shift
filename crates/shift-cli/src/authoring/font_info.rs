//! Metadata and master-metric authoring through existing semantic intents.

use miette::{IntoDiagnostic, Result, bail, miette};
use shift_font::{
    Font, FontIntent, FontIntentSet, MetricDefinition, MetricKind, MetricValue, SourceId,
};

use crate::cli::{FontInfoArgs, SetFontArgs};

use super::glyph::{load_font, resolve_source_id};
use super::{AuthoringReport, apply_mutation, require_finite};
use report::{FontInfoReport, SourceMetrics, format_version};

pub(super) mod report;

/// Reads authored metadata and one source's metrics without acquiring glyph payloads.
///
/// The default source is selected unless an explicit source name or ID is supplied.
/// Missing authored metric roles remain absent rather than becoming compiled line-height values.
///
/// # Errors
///
/// Reports unreadable documents or unresolved source selectors.
pub fn font_info(args: FontInfoArgs) -> Result<FontInfoReport> {
    let font = load_font(&args.path)?;
    let source_id = target_source_id(&font, args.source.as_deref())?;
    let source = font
        .source(&source_id)
        .ok_or_else(|| miette!("source does not exist"))?;
    let metadata = font.metadata().clone();

    Ok(FontInfoReport {
        document: args.path,
        version: format_version(metadata.version_major, metadata.version_minor),
        metadata,
        units_per_em: font.metrics().units_per_em,
        source: SourceMetrics::from_source(&font, source),
    })
}

/// Sets metadata and one master's metrics atomically, preserving every omitted field.
///
/// Metric positions retain existing overshoots. A missing standard metric definition is
/// introduced through the model's normal default-value policy for all masters. UPM and
/// glyph geometry are unchanged. Attribution and license text retain their supplied whitespace.
///
/// # Errors
///
/// Rejects empty requests, blank metadata, ambiguous versions, non-finite metrics,
/// unresolved selectors, or metric edits on layer-only sources. Reports persistence failures.
pub fn set_font(args: SetFontArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let mut metadata = font.metadata().clone();
    let mut intents = Vec::new();
    let fields = [
        (
            &args.family_name,
            &mut metadata.family_name,
            "--family-name",
        ),
        (&args.style_name, &mut metadata.style_name, "--style-name"),
        (&args.copyright, &mut metadata.copyright, "--copyright"),
        (&args.designer, &mut metadata.designer, "--designer"),
        (
            &args.designer_url,
            &mut metadata.designer_url,
            "--designer-url",
        ),
        (&args.license, &mut metadata.license, "--license"),
        (
            &args.license_url,
            &mut metadata.license_url,
            "--license-url",
        ),
    ];
    let has_metadata = args.version.is_some() || fields.iter().any(|(value, _, _)| value.is_some());
    for (value, target, flag) in fields {
        let Some(value) = value else {
            continue;
        };
        if value.trim().is_empty() {
            bail!("{flag} must not be blank");
        }
        *target = Some(value.clone());
    }
    if let Some(version) = &args.version {
        let (major, minor) = parse_version(version)?;
        metadata.version_major = Some(major);
        metadata.version_minor = Some(minor);
    }
    if has_metadata {
        intents.push(FontIntent::UpdateFontMetadata { metadata });
    }

    let has_metrics = args.ascender.is_some()
        || args.descender.is_some()
        || args.x_height.is_some()
        || args.cap_height.is_some()
        || args.line_gap.is_some()
        || args.italic_angle.is_some();
    if has_metrics {
        let source_id = target_source_id(&font, args.source.as_deref())?;
        intents.extend(source_metric_intents(&font, source_id, &args)?);
    } else if args.source.is_some() {
        bail!("--source selects where metric flags apply; pass a metric flag");
    }
    if intents.is_empty() {
        bail!("font set needs at least one metadata or metric flag");
    }

    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
}

fn source_metric_intents(
    font: &Font,
    source_id: SourceId,
    args: &SetFontArgs,
) -> Result<Vec<FontIntent>> {
    let source = font
        .source(&source_id)
        .ok_or_else(|| miette!("source does not exist"))?;
    if !source.is_master() {
        bail!(
            "source {:?} is not a master and has no font metrics",
            source.name()
        );
    }

    let mut definitions = font.metric_definitions().to_vec();
    let mut metric_values = source.metric_values().clone();
    for (kind, position, flag, name) in [
        (
            MetricKind::Ascender,
            args.ascender,
            "--ascender",
            "Ascender",
        ),
        (
            MetricKind::Descender,
            args.descender,
            "--descender",
            "Descender",
        ),
        (MetricKind::XHeight, args.x_height, "--x-height", "x-Height"),
        (
            MetricKind::CapHeight,
            args.cap_height,
            "--cap-height",
            "Cap Height",
        ),
    ] {
        let Some(position) = position else {
            continue;
        };
        require_finite(position, flag)?;
        let metric_id = match font.metric_definition_for_kind(kind) {
            Some(definition) => definition.id(),
            None => {
                let definition = MetricDefinition::new(kind, name.to_string());
                let metric_id = definition.id();
                definitions.push(definition);
                metric_id
            }
        };
        let value = metric_values
            .get(&metric_id)
            .copied()
            .unwrap_or_else(|| MetricValue::for_kind(kind, font.metrics().units_per_em));
        metric_values.insert(metric_id, MetricValue::new(position, value.overshoot));
    }
    for (flag, value) in [
        ("--line-gap", args.line_gap),
        ("--italic-angle", args.italic_angle),
    ] {
        if let Some(value) = value {
            require_finite(value, flag)?;
        }
    }

    let mut intents = Vec::new();
    if definitions.len() != font.metric_definitions().len() {
        intents.push(FontIntent::SetMetricDefinitions { definitions });
    }
    intents.push(FontIntent::UpdateSource {
        source_id,
        name: source.name().to_string(),
        location: source.location().clone(),
        metric_values,
        italic_angle: args.italic_angle.or(source.italic_angle()),
        line_gap: args.line_gap.or(source.line_gap()),
        underline_position: source.underline_position(),
        underline_thickness: source.underline_thickness(),
    });
    Ok(intents)
}

fn target_source_id(font: &Font, selector: Option<&str>) -> Result<SourceId> {
    match selector {
        Some(selector) => resolve_source_id(font, selector),
        None => font
            .default_source_id()
            .ok_or_else(|| miette!("the font has no default source")),
    }
}

fn parse_version(version: &str) -> Result<(i32, i32)> {
    let (major, minor) = version
        .trim()
        .split_once('.')
        .unwrap_or((version.trim(), "000"));
    let digits = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(major) || !digits(minor) || minor.len() != 3 {
        bail!("invalid --version {version:?}; use MAJOR or MAJOR.NNN, such as 1.000 or 2.125");
    }
    let major = major.parse::<i32>().into_diagnostic()?;
    if major > i16::MAX as i32 {
        bail!("--version major must be between 0 and 32767");
    }
    Ok((major, minor.parse::<i32>().into_diagnostic()?))
}
