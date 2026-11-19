//! Batch planning over directory facts; geometry is acquired by the workspace only when needed.

use shift_font::{
    CreateGlyph, Glyph, GlyphSwap, LayerLocation, SetGlyphSwaps, SetMarkColor, SwapId, UpdateGlyph,
};
use std::collections::{BTreeMap, BTreeSet, HashMap};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_font::{FontIntentSet, GlyphId, GlyphName};

use crate::cli::SetGlyphsArgs;

use super::glyph::{load_font, parse_unicodes};
use super::input::{GlyphBatchInput, GlyphEntryInput, MarkColorEdit, MetricsKeysInput, SwapInput};
use super::layer_payload::read_json_input;
use super::layer_place::{create_layer, layer_at, layer_location_from_values};
use super::metrics_keys::check_written_keys;
use super::swap::parse_when;
use super::{AuthoringReport, apply_checked_mutation};
use crate::selector::FontSelectors;

/// The glyph batch format `glyph export` writes and `glyph set` reads.
pub(crate) const GLYPH_BATCH_FORMAT: u32 = 1;

/// Records one glyph's value for a field the batch sets once per glyph.
///
/// # Errors
///
/// Returns an error when an earlier entry for the same glyph gave a different value.
fn record_once<T: PartialEq>(
    map: &mut BTreeMap<String, T>,
    name: &str,
    value: T,
    what: &str,
) -> Result<()> {
    if let Some(previous) = map.get(name)
        && *previous != value
    {
        bail!("conflicting {what} for this glyph");
    }
    map.insert(name.to_string(), value);
    Ok(())
}

/// Creates or updates glyph identities and drawings with one atomic workspace application.
///
/// Omitted Unicode assignments remain unchanged; an empty list clears them. An omitted
/// mark colour remains unchanged; `null` clears it. Repeated glyph names may target
/// distinct sources but must agree on any supplied Unicode list, mark colour and glyph
/// metrics keys. Metrics keys are applied as the app applies them: the sides
/// they link follow in the same edit.
/// Input errors name the glyph and one-based entry; syntax errors retain JSON locations.
///
/// # Errors
///
/// An entry's `location` places its drawing anywhere in the glyph's design space,
/// laid over `source` or, without one, over no source.
///
/// # Errors
///
/// Rejects invalid payloads, selectors, repeated glyph/place pairs, conflicting
/// Unicode assignments, mark colours or glyph keys, and metrics keys that cannot be evaluated,
/// without writing. Also reports document and persistence failures.
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
    let mut unicodes = BTreeMap::<String, Vec<u32>>::new();
    let mut glyph_keys = BTreeMap::<String, MetricsKeysInput>::new();
    let mut glyph_swaps = BTreeMap::<String, Vec<SwapInput>>::new();
    let mut mark_colors = BTreeMap::<String, MarkColorEdit>::new();
    let mut seen: Vec<(String, LayerLocation)> = Vec::new();
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
        let base = entry
            .source
            .as_deref()
            .map(|selector| font.source_id_for(selector))
            .transpose()
            .wrap_err_with(context)?;
        let location = match &entry.location {
            Some(values) => {
                let existing = font.glyph_by_name(&name).map(Glyph::id);
                layer_location_from_values(&font, existing, base, values).wrap_err_with(context)?
            }
            None => {
                let source_id = match base {
                    Some(source_id) => source_id,
                    None => font
                        .default_source_id()
                        .ok_or_else(|| miette!("{}: the font has no default source", context()))?,
                };
                LayerLocation::at_source(source_id)
            }
        };
        if seen
            .iter()
            .any(|(seen_name, seen_location)| *seen_name == name && *seen_location == location)
        {
            bail!("{}: glyph/place pair appears more than once", context());
        }
        seen.push((name.clone(), location.clone()));

        let requested_unicodes = entry
            .unicodes
            .as_deref()
            .map(parse_unicodes)
            .transpose()
            .wrap_err_with(context)?;
        if let Some(values) = &requested_unicodes {
            record_once(&mut unicodes, &name, values.clone(), "Unicode assignments")
                .wrap_err_with(context)?;
        }
        if let Some(keys) = entry.metrics_keys {
            record_once(&mut glyph_keys, &name, keys, "glyph metrics keys")
                .wrap_err_with(context)?;
        }
        if let Some(swaps) = entry.swaps {
            record_once(&mut glyph_swaps, &name, swaps, "swaps").wrap_err_with(context)?;
        }
        if entry.mark_color != MarkColorEdit::Keep {
            record_once(&mut mark_colors, &name, entry.mark_color, "mark colours")
                .wrap_err_with(context)?;
        }

        if !glyphs.contains_key(&name) {
            let glyph = match font.glyph_by_name(&name) {
                Some(glyph) => (glyph.id(), glyph.unicodes().to_vec()),
                None => {
                    let glyph_id = GlyphId::new();
                    let values = requested_unicodes.clone().unwrap_or_default();
                    intents.push(
                        CreateGlyph {
                            glyph_id: Some(glyph_id),
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
                    glyph_id: *glyph_id,
                    new_name: glyph_name,
                    new_unicodes: values.clone(),
                }
                .into(),
            );
            *current_unicodes = values;
        }

        if let Some(input) = entry.layer {
            layers.push((*glyph_id, location, input, context()));
        }
    }

    for (name, edit) in mark_colors {
        let color = match edit {
            MarkColorEdit::Keep => continue,
            MarkColorEdit::Set(color) => Some(color),
            MarkColorEdit::Clear => None,
        };
        let Some(&(glyph_id, _)) = glyphs.get(&name) else {
            bail!("a mark colour names glyph `{name}`, which the batch did not plan");
        };
        intents.push(
            SetMarkColor {
                glyph_ids: vec![glyph_id],
                color,
            }
            .into(),
        );
    }

    // Layers come after every glyph is planned, so a component may name a glyph
    // that appears later in the batch.
    let base_glyph = |name: &str| match glyphs.get(name) {
        Some((glyph_id, _)) => Ok(*glyph_id),
        None => font.glyph_id_for(name),
    };
    let mut written = BTreeSet::new();
    for (glyph_id, location, input, context) in layers {
        let existing = layer_at(&font, glyph_id, &location);
        let layer_id = existing.unwrap_or_default();
        if existing.is_none() {
            intents.push(create_layer(layer_id, glyph_id, &location));
        }
        intents.extend(
            input
                .into_intents(glyph_id, layer_id, &base_glyph, &font, &mut written)
                .wrap_err_with(|| context)?,
        );
    }

    // Swaps follow the glyphs, so a swap glyph the batch creates
    // exists.
    for (name, inputs) in &glyph_swaps {
        let Some(&(glyph_id, _)) = glyphs.get(name) else {
            bail!("swaps name glyph `{name}`, which the batch did not create");
        };
        let swaps = planned_swaps(&font, glyph_id, inputs, &base_glyph)
            .wrap_err_with(|| format!("glyph {name:?} swaps"))?;
        intents.push(SetGlyphSwaps { glyph_id, swaps }.into());
    }

    // Glyph keys come last, so the glyphs and layers they read already exist.
    for (name, keys) in &glyph_keys {
        let Some(&(glyph_id, _)) = glyphs.get(name) else {
            bail!("metrics keys name glyph `{name}`, which the batch did not create");
        };
        intents.extend(keys.glyph_intents(glyph_id, &mut written));
    }

    apply_checked_mutation(
        &args.path,
        &args.mutation,
        &FontIntentSet { intents },
        |font| check_written_keys(font, &written),
    )
}

/// The swaps `inputs` give `glyph_id`, in order. Each keeps the id of
/// an existing swap with the same glyph and condition, so a batch that
/// writes the list back unchanged changes nothing.
///
/// # Errors
///
/// Rejects a swap glyph `base_glyph` can't find and condition text the
/// font can't read.
fn planned_swaps(
    font: &shift_font::Font,
    glyph_id: GlyphId,
    inputs: &[SwapInput],
    base_glyph: &dyn Fn(&str) -> Result<GlyphId>,
) -> Result<Vec<GlyphSwap>> {
    let existing = font.glyph(glyph_id).map(Glyph::swaps).unwrap_or_default();
    let mut swaps: Vec<GlyphSwap> = Vec::with_capacity(inputs.len());
    for input in inputs {
        let context = || format!("swap {:?}", input.glyph);
        let swap_glyph = base_glyph(&input.glyph).wrap_err_with(context)?;
        let condition = parse_when(font, Some(glyph_id), &input.when).wrap_err_with(context)?;
        let kept = existing.iter().find(|swap| {
            swap.glyph() == swap_glyph
                && *swap.condition() == condition
                && !swaps.iter().any(|taken| taken.id() == swap.id())
        });
        let id = kept.map_or_else(SwapId::new, GlyphSwap::id);
        swaps.push(GlyphSwap::new(id, condition, swap_glyph));
    }
    Ok(swaps)
}
