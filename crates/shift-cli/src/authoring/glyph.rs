//! Glyph identity and sparse authored-layer commands.
//!
//! The command path and selectors establish layer membership. A layer JSON
//! payload owns only authored values: advance, contours, points, and anchors.
//! Every payload is lowered to a single [`FontIntentSet`], preserving the same
//! validation and all-or-nothing behavior as interactive authoring.

use std::collections::HashSet;
use std::io::{self, Read};
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use serde::Deserialize;
use shift_font::{
    AnchorId, AnchorSeed, ContourId, Font, FontIntent, FontIntentSet, GlyphId, LayerId, PointId,
    PointSeed, PointType, SourceId,
};
use shift_source::ShiftSourcePackage;

use crate::cli::{AddGlyphArgs, AddLayerArgs, CopyLayerArgs};

use super::{AuthoringReport, apply_mutation};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerInput {
    advance: f64,
    #[serde(default)]
    contours: Vec<ContourInput>,
    #[serde(default)]
    anchors: Vec<AnchorInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContourInput {
    closed: bool,
    points: Vec<PointInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PointInput {
    x: f64,
    y: f64,
    #[serde(default)]
    point_type: PointType,
    #[serde(default)]
    smooth: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnchorInput {
    name: Option<String>,
    x: f64,
    y: f64,
}

/// Adds glyph identity and Unicode assignments without implicitly creating geometry.
///
/// Unicode arguments use `U+XXXX` notation and preserve their command order.
/// Authored layers remain explicit, separate mutations.
///
/// # Errors
///
/// Returns an error when a Unicode value is malformed, the glyph conflicts
/// with existing identity, the package cannot be loaded, or saving fails.
pub fn add_glyph(args: AddGlyphArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let unicodes = parse_unicodes(&args.unicode)?;
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateGlyph {
            glyph_id: None,
            name: args.name,
            unicodes,
        }],
    };

    apply_mutation(&args.path, &args.mutation, font, set)
}

/// Adds one sparse authored layer from a semantic JSON payload.
///
/// Glyph and source selectors accept a unique authored name or a full stable
/// id. The payload is read completely before mutation; `-` reads stdin. Shift
/// mints every layer, contour, point, and anchor identity.
///
/// # Errors
///
/// Returns an error for unreadable or invalid JSON, unsupported payload
/// fields, non-finite values, unresolved selectors, invalid authoring, or
/// persistence failures.
pub fn add_layer(args: AddLayerArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = resolve_glyph_id(&font, &args.glyph)?;
    let source_id = resolve_source_id(&font, &args.source)?;
    let layer_id = LayerId::new();
    let input = read_layer_input(&args.input)?;
    let set = layer_intents(layer_id, glyph_id, source_id, input)?;

    apply_mutation(&args.path, &args.mutation, font, set)
}

/// Copies one glyph layer to another source with fresh internal identities.
///
/// The copied layer retains advance, contours, components, anchors, guidelines,
/// and library data while receiving a new layer id, contour ids, point ids, and
/// other internal identities.
///
/// # Errors
///
/// Returns an error when selectors cannot be resolved, the origin layer is
/// absent, the destination already owns a layer for the glyph, or saving fails.
pub fn copy_layer(args: CopyLayerArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = resolve_glyph_id(&font, &args.glyph)?;
    let from_source_id = resolve_source_id(&font, &args.from_source)?;
    let source_id = resolve_source_id(&font, &args.source)?;
    let from_layer_id = font
        .layer_id_for_glyph_source(glyph_id.clone(), from_source_id.clone())
        .ok_or_else(|| {
            miette!(
                "glyph {:?} has no authored layer at source {:?}",
                args.glyph,
                args.from_source
            )
        })?;
    let layer_id = LayerId::new();
    let set = FontIntentSet {
        intents: vec![FontIntent::CloneGlyphLayer {
            layer_id,
            glyph_id,
            source_id,
            from_layer_id,
        }],
    };

    apply_mutation(&args.path, &args.mutation, font, set)
}

fn load_font(path: &Path) -> Result<Font> {
    ShiftSourcePackage::load_font(path)
        .into_diagnostic()
        .wrap_err("failed to load Shift font")
}

fn parse_unicodes(values: &[String]) -> Result<Vec<u32>> {
    let mut seen = HashSet::new();
    let mut unicodes = Vec::with_capacity(values.len());

    for value in values {
        let digits = value
            .strip_prefix("U+")
            .or_else(|| value.strip_prefix("u+"))
            .ok_or_else(|| miette!("invalid Unicode {value:?}; expected U+XXXX"))?;
        if digits.is_empty() {
            bail!("invalid Unicode {value:?}; expected hexadecimal digits after U+");
        }
        let scalar = u32::from_str_radix(digits, 16)
            .into_diagnostic()
            .wrap_err_with(|| format!("invalid Unicode {value:?}"))?;
        if char::from_u32(scalar).is_none() {
            bail!("Unicode {value:?} is not a scalar value");
        }
        if !seen.insert(scalar) {
            bail!("Unicode {value:?} is repeated");
        }

        unicodes.push(scalar);
    }

    Ok(unicodes)
}

fn read_layer_input(path: &Path) -> Result<LayerInput> {
    let mut json = String::new();
    if path == Path::new("-") {
        io::stdin()
            .read_to_string(&mut json)
            .into_diagnostic()
            .wrap_err("failed to read layer payload from stdin")?;
    } else {
        json = std::fs::read_to_string(path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read layer payload from {}", path.display()))?;
    }

    serde_json::from_str(&json)
        .into_diagnostic()
        .wrap_err_with(|| format!("invalid layer payload from {}", path.display()))
}

fn layer_intents(
    layer_id: LayerId,
    glyph_id: GlyphId,
    source_id: SourceId,
    input: LayerInput,
) -> Result<FontIntentSet> {
    require_finite(input.advance, "layer advance")?;
    let mut intents = vec![
        FontIntent::CreateGlyphLayer {
            layer_id: layer_id.clone(),
            glyph_id,
            source_id,
        },
        FontIntent::SetXAdvance {
            layer_id: layer_id.clone(),
            width: input.advance,
        },
    ];
    for contour in input.contours {
        let contour_id = ContourId::new();
        let mut points = Vec::with_capacity(contour.points.len());

        for point in contour.points {
            require_finite(point.x, "point x")?;
            require_finite(point.y, "point y")?;
            points.push(PointSeed {
                id: PointId::new(),
                x: point.x,
                y: point.y,
                point_type: point.point_type,
                smooth: point.smooth,
            });
        }

        intents.push(FontIntent::AddContour {
            layer_id: layer_id.clone(),
            contour_id: contour_id.clone(),
            closed: contour.closed,
        });
        if !points.is_empty() {
            intents.push(FontIntent::AddPoints {
                layer_id: layer_id.clone(),
                contour_id: Some(contour_id),
                before: None,
                points,
            });
        }
    }

    let mut anchors = Vec::with_capacity(input.anchors.len());
    for anchor in input.anchors {
        require_finite(anchor.x, "anchor x")?;
        require_finite(anchor.y, "anchor y")?;
        anchors.push(AnchorSeed {
            id: AnchorId::new(),
            name: anchor.name,
            x: anchor.x,
            y: anchor.y,
        });
    }
    if !anchors.is_empty() {
        intents.push(FontIntent::AddAnchors { layer_id, anchors });
    }

    Ok(FontIntentSet { intents })
}

fn resolve_glyph_id(font: &Font, selector: &str) -> Result<GlyphId> {
    if let Ok(glyph_id) = selector.parse::<GlyphId>()
        && font.glyph(glyph_id.clone()).is_some()
    {
        return Ok(glyph_id);
    }
    if let Some(glyph_id) = font.glyph_id_by_name(selector) {
        return Ok(glyph_id);
    }

    Err(miette!(
        "glyph {selector:?} does not exist; use its name or full glyph_ id"
    ))
}

fn resolve_source_id(font: &Font, selector: &str) -> Result<SourceId> {
    if let Ok(source_id) = selector.parse::<SourceId>()
        && font.sources().iter().any(|source| source.id() == source_id)
    {
        return Ok(source_id);
    }
    if let Some(source) = font
        .sources()
        .iter()
        .find(|source| source.name() == selector)
    {
        return Ok(source.id());
    }

    Err(miette!(
        "source {selector:?} does not exist; use its name or full source_ id"
    ))
}

fn require_finite(value: f64, label: &str) -> Result<()> {
    if !value.is_finite() {
        bail!("{label} must be finite");
    }
    Ok(())
}
