//! Batch planning over directory facts; geometry is acquired by the workspace only when needed.

use shift_font::{CreateGlyph, CreateGlyphLayer, UpdateGlyph};
use std::collections::{HashMap, HashSet};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_font::{FontIntentSet, GlyphId, GlyphName, LayerId};

use crate::cli::SetGlyphsArgs;

use super::glyph::{load_font, parse_unicodes};
use super::input::{GlyphBatchInput, GlyphEntryInput};
use super::layer_payload::read_json_input;
use super::{AuthoringReport, apply_mutation};
use crate::selector::FontSelectors;

/// The glyph batch format `glyph export` writes and `glyph set` reads.
pub(crate) const GLYPH_BATCH_FORMAT: u32 = 1;

/// Creates or updates glyph identities and drawings with one atomic workspace application.
///
/// Omitted Unicode assignments remain unchanged; an empty list clears them. Repeated
/// glyph names may target distinct sources but must agree on any supplied Unicode list.
/// Input errors name the glyph and one-based entry; syntax errors retain JSON locations.
///
/// # Errors
///
/// Rejects invalid payloads, selectors, repeated glyph/source pairs, and conflicting
/// Unicode assignments without writing. Also reports document and persistence failures.
pub(crate) fn set_glyphs(args: &SetGlyphsArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let batch = read_json_input::<GlyphBatchInput>(&args.input, "glyph batch")?;
    if batch.glyphs.is_empty() {
        bail!("glyph batch contains no glyphs");
    }
    if let Some(format) = batch.format
        && format != GLYPH_BATCH_FORMAT
    {
        bail!(
            "glyph batch format {format} is not supported; this shift-cli reads format {GLYPH_BATCH_FORMAT}"
        );
    }

    let mut glyphs = HashMap::<String, (GlyphId, Vec<u32>)>::new();
    let mut unicodes = HashMap::<String, Vec<u32>>::new();
    let mut seen = HashSet::new();
    let mut intents = Vec::new();
    let mut layers = Vec::new();
    for (index, input) in batch.glyphs.into_iter().enumerate() {
        let name = input["name"]
            .as_str()
            .unwrap_or("<unnamed>")
            .trim()
            .to_string();
        let context = || format!("glyph {name:?} (entry {})", index + 1);
        let entry: GlyphEntryInput = serde_json::from_value(input)
            .into_diagnostic()
            .wrap_err_with(context)?;
        let glyph_name = GlyphName::new(entry.name.trim())
            .into_diagnostic()
            .wrap_err_with(context)?;
        let source_id = match entry.source.as_deref() {
            Some(selector) => font.source_id_for(selector).wrap_err_with(context)?,
            None => font
                .default_source_id()
                .ok_or_else(|| miette!("{}: the font has no default source", context()))?,
        };
        if !seen.insert((name.clone(), source_id.clone())) {
            bail!("{}: glyph/source pair appears more than once", context());
        }

        let requested_unicodes = entry
            .unicodes
            .as_deref()
            .map(parse_unicodes)
            .transpose()
            .wrap_err_with(context)?;
        if let Some(values) = &requested_unicodes {
            if let Some(previous) = unicodes.get(&name)
                && previous != values
            {
                bail!(
                    "{}: conflicting Unicode assignments for this glyph",
                    context()
                );
            }
            unicodes.insert(name.clone(), values.clone());
        }

        if !glyphs.contains_key(&name) {
            let glyph = match font.glyph_by_name(&name) {
                Some(glyph) => (glyph.id(), glyph.unicodes().to_vec()),
                None => {
                    let glyph_id = GlyphId::new();
                    let values = requested_unicodes.clone().unwrap_or_default();
                    intents.push(
                        CreateGlyph {
                            glyph_id: Some(glyph_id.clone()),
                            name: name.clone(),
                            unicodes: values.clone(),
                        }
                        .into(),
                    );
                    (glyph_id, values)
                }
            };
            glyphs.insert(name.clone(), glyph);
        }
        let (glyph_id, current_unicodes) = glyphs.get_mut(&name).expect("glyph was planned");
        if let Some(values) = requested_unicodes
            && *current_unicodes != values
        {
            intents.push(
                UpdateGlyph {
                    glyph_id: glyph_id.clone(),
                    new_name: glyph_name,
                    new_unicodes: values.clone(),
                }
                .into(),
            );
            *current_unicodes = values;
        }

        if let Some(input) = entry.layer {
            layers.push((glyph_id.clone(), source_id, input, context()));
        }
    }

    // Layers come after every glyph is planned, so a component may name a glyph
    // that appears later in the batch.
    let base_glyph = |name: &str| match glyphs.get(name) {
        Some((glyph_id, _)) => Ok(glyph_id.clone()),
        None => font.glyph_id_for(name),
    };
    for (glyph_id, source_id, input, context) in layers {
        let existing = font.layer_id_for_glyph_source(glyph_id.clone(), source_id.clone());
        let layer_id = existing.clone().unwrap_or_else(LayerId::new);
        if existing.is_none() {
            intents.push(
                CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id,
                    source_id,
                }
                .into(),
            );
        }
        intents.push(
            input
                .into_intent(layer_id, &base_glyph)
                .wrap_err_with(|| context)?,
        );
    }

    apply_mutation(&args.path, &args.mutation, &FontIntentSet { intents })
}
