//! Glyph identity and sparse authored-layer commands.
//!
//! The command path and selectors establish layer membership. A layer JSON
//! payload owns only authored values: advance, contours, points, and anchors.
//! Every payload is lowered to a single [`FontIntentSet`], preserving the same
//! validation and all-or-nothing behavior as interactive authoring.

use std::collections::HashSet;
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_font::{Font, FontIntent, FontIntentSet, GlyphId, LayerId, SourceId};
use shift_store::ShiftStore;

use crate::cli::{AddGlyphArgs, CopyLayerArgs, LayerPayloadArgs};

use super::input::LayerInput;
use super::layer_payload::read_json_input;
use super::{AuthoringReport, apply_mutation};

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
    let unicodes = parse_unicodes(&args.unicode)?;
    let set = FontIntentSet {
        intents: vec![FontIntent::CreateGlyph {
            glyph_id: None,
            name: args.name,
            unicodes,
        }],
    };

    apply_mutation(&args.path, &args.mutation, set)
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
pub fn add_layer(args: LayerPayloadArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = resolve_glyph_id(&font, &args.glyph)?;
    let source_id = resolve_source_id(&font, &args.source)?;
    let layer_id = LayerId::new();
    let input = read_json_input::<LayerInput>(&args.input, "layer payload")?;
    let set = FontIntentSet {
        intents: vec![
            FontIntent::CreateGlyphLayer {
                layer_id: layer_id.clone(),
                glyph_id,
                source_id,
            },
            input.into_intent(layer_id)?,
        ],
    };

    apply_mutation(&args.path, &args.mutation, set)
}

/// Creates or replaces one layer's drawing, preserving an existing layer's identity.
///
/// Source binding, height, guidelines, and lib data survive replacement. Components
/// are removed because the JSON payload only expresses outlines and anchors.
///
/// # Errors
///
/// Rejects invalid payloads or selectors without writing; persistence failures are reported.
pub fn set_layer(args: LayerPayloadArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = resolve_glyph_id(&font, &args.glyph)?;
    let source_id = resolve_source_id(&font, &args.source)?;
    let input = read_json_input::<LayerInput>(&args.input, "layer payload")?;
    let existing = font.layer_id_for_glyph_source(glyph_id.clone(), source_id.clone());
    let layer_id = existing.clone().unwrap_or_default();
    let mut intents = Vec::new();
    if existing.is_none() {
        intents.push(FontIntent::CreateGlyphLayer {
            layer_id: layer_id.clone(),
            glyph_id,
            source_id,
        });
    }
    intents.push(input.into_intent(layer_id)?);

    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
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

    apply_mutation(&args.path, &args.mutation, set)
}

pub(super) fn load_font(path: &Path) -> Result<Font> {
    ShiftStore::open_document(path)
        .and_then(|store| store.load_font_directory())
        .into_diagnostic()
        .wrap_err("failed to load Shift font")
}

pub(super) fn parse_unicodes(values: &[String]) -> Result<Vec<u32>> {
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

fn resolve_glyph_id(font: &Font, selector: &str) -> Result<GlyphId> {
    if let Ok(glyph_id) = selector.parse::<GlyphId>()
        && font.glyph(&glyph_id).is_some()
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

pub(super) fn resolve_source_id(font: &Font, selector: &str) -> Result<SourceId> {
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
