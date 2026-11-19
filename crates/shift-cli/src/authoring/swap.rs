//! Glyph swaps and component conditions: `glyph swap add`,
//! `remove`, `move` and `set`, and `component condition set`.
//!
//! Conditions are written as shift-font's condition text reads them (see
//! [`shift_font::condition_text`]), in user units on font axes.

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_font::{
    AddGlyphSwap, ComponentId, Condition, EditGlyphSwap, Font, FontIntentSet, GlyphId, GlyphSwap,
    GlyphSwapEdit, SetComponentCondition, SwapId,
};

use shift_store::ShiftStore;

use crate::cli::{
    AddSwapArgs, ConditionArgs, MoveSwapArgs, MutationArgs, RemoveSwapArgs,
    SetComponentConditionArgs, SetSwapArgs, SwapSelectorArgs,
};
use crate::selector::FontSelectors;

use super::glyph::load_font;
use super::{AuthoringReport, apply_mutation};

/// Adds one swap to a glyph.
///
/// # Errors
///
/// Rejects a missing condition, unreadable condition text, an unknown glyph
/// or axis, and what the font refuses: the glyph itself, a glyph axis, a
/// reversed range or a position past the end.
pub(crate) fn add_swap(args: &AddSwapArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let swap_glyph = font.glyph_id_for(&args.swap_glyph)?;
    let condition = parse_condition(&font, Some(glyph_id), &args.condition)?
        .ok_or_else(|| miette!("give the swap's condition with --when, or --always"))?;
    let position = args.at.map(|at| zero_based(at, "--at")).transpose()?;
    let set = FontIntentSet::from(AddGlyphSwap {
        glyph_id,
        swap: GlyphSwap::new(SwapId::new(), condition, swap_glyph),
        position,
    });

    apply_mutation(&args.path, &args.mutation, &set)
}

/// Removes one swap of a glyph.
///
/// # Errors
///
/// Rejects an unknown glyph or swap.
pub(crate) fn remove_swap(args: &RemoveSwapArgs) -> Result<AuthoringReport> {
    edit_swap(&args.swap, &args.mutation, GlyphSwapEdit::Remove)
}

/// Moves one swap of a glyph to another position.
///
/// # Errors
///
/// Rejects an unknown glyph or swap and a position past the end.
pub(crate) fn move_swap(args: &MoveSwapArgs) -> Result<AuthoringReport> {
    let edit = GlyphSwapEdit::Move(zero_based(args.to, "--to")?);
    edit_swap(&args.swap, &args.mutation, edit)
}

/// Applies `edit` to the swap `selector` names.
fn edit_swap(
    selector: &SwapSelectorArgs,
    mutation: &MutationArgs,
    edit: GlyphSwapEdit,
) -> Result<AuthoringReport> {
    let font = load_font(&selector.path)?;
    let swap_id = swap_for(&font, selector)?;
    let set = FontIntentSet::from(EditGlyphSwap { swap_id, edit });
    apply_mutation(&selector.path, mutation, &set)
}

/// Replaces a swap's condition, the glyph it draws, or both, as one
/// edit.
///
/// # Errors
///
/// Rejects an empty edit, unreadable condition text, an unknown glyph,
/// swap or axis, and what the font refuses.
pub(crate) fn set_swap(args: &SetSwapArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.swap.path)?;
    let glyph_id = font.glyph_id_for(&args.swap.glyph)?;
    let swap_id = swap_for(&font, &args.swap)?;
    let mut edits = Vec::new();
    if let Some(condition) = parse_condition(&font, Some(glyph_id), &args.condition)? {
        edits.push(GlyphSwapEdit::Condition(condition));
    }
    if let Some(selector) = &args.swap_glyph {
        edits.push(GlyphSwapEdit::Glyph(font.glyph_id_for(selector)?));
    }
    if edits.is_empty() {
        bail!("swap set needs --when, --always or --glyph");
    }
    let set = edits
        .into_iter()
        .map(|edit| EditGlyphSwap { swap_id, edit }.into())
        .collect();

    apply_mutation(&args.swap.path, &args.mutation, &set)
}

/// Sets where one component draws, in every drawing of its glyph.
///
/// # Errors
///
/// Rejects a missing condition, unreadable condition text, an unknown
/// glyph, source, component or axis, a glyph with no drawing on the source,
/// and a condition on the axes of the glyph the component draws.
pub(crate) fn set_component_condition(args: &SetComponentConditionArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let condition = parse_condition(&font, Some(glyph_id), &args.condition)?
        .ok_or_else(|| miette!("give the component's condition with --when, or --always"))?;
    let source_id = match &args.source {
        Some(selector) => font.source_id_for(selector)?,
        None => font
            .default_source_id()
            .ok_or_else(|| miette!("the font has no default source"))?,
    };
    let layer_id = font
        .glyph(glyph_id)
        .and_then(|glyph| glyph.layer_for_source(source_id))
        .ok_or_else(|| miette!("glyph {:?} has no drawing on that source", args.glyph))?
        .id();
    // The directory has no geometry, so read the drawing's components.
    let layer = ShiftStore::open_document(&args.path)
        .and_then(|store| store.load_glyph_layer(layer_id))
        .into_diagnostic()
        .wrap_err("failed to read the drawing")?
        .ok_or_else(|| miette!("the drawing {layer_id} is not stored"))?;
    let component_id = component_for(&font, &layer, &args.component)?;
    let set = FontIntentSet::from(SetComponentCondition {
        layer_id,
        component_id,
        condition,
    });

    apply_mutation(&args.path, &args.mutation, &set)
}

/// The condition `args` gives: its `--when` ranges, `--always`, or `None`
/// when neither flag is given.
///
/// # Errors
///
/// Reports condition text the font can't read, naming it.
pub(super) fn parse_condition(
    font: &Font,
    glyph_id: Option<GlyphId>,
    args: &ConditionArgs,
) -> Result<Option<Condition>> {
    if args.always {
        return Ok(Some(Condition::always()));
    }
    if args.when.is_empty() {
        return Ok(None);
    }
    parse_when(font, glyph_id, &args.when).map(Some)
}

/// Reads condition texts such as `wght>=700`, all of which must hold.
///
/// # Errors
///
/// Reports the first text the font can't read.
pub(super) fn parse_when(
    font: &Font,
    glyph_id: Option<GlyphId>,
    texts: &[String],
) -> Result<Condition> {
    let space = font
        .condition_space(glyph_id)
        .into_diagnostic()
        .wrap_err("failed to read the font's axis mappings")?;
    space
        .parse(texts.iter().map(String::as_str))
        .into_diagnostic()
        .wrap_err("invalid condition")
}

/// The swap `args` names: by position from 1, or by the glyph it
/// draws.
fn swap_for(font: &Font, args: &SwapSelectorArgs) -> Result<SwapId> {
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let swaps = font
        .glyph(glyph_id)
        .map(shift_font::Glyph::swaps)
        .unwrap_or_default();
    if let Ok(position) = args.swap.parse::<usize>() {
        return position
            .checked_sub(1)
            .and_then(|index| swaps.get(index))
            .map(GlyphSwap::id)
            .ok_or_else(|| {
                miette!(
                    "glyph {:?} has {} swaps; give a position from 1 to {}",
                    args.glyph,
                    swaps.len(),
                    swaps.len()
                )
            });
    }
    let drawn = font.glyph_id_for(&args.swap)?;
    let mut matching = swaps.iter().filter(|swap| swap.glyph() == drawn);
    match (matching.next(), matching.next()) {
        (Some(swap), None) => Ok(swap.id()),
        (None, _) => bail!(
            "glyph {:?} has no swap that draws {:?}",
            args.glyph,
            args.swap
        ),
        (Some(_), Some(_)) => bail!(
            "several swaps of {:?} draw {:?}; give its position instead",
            args.glyph,
            args.swap
        ),
    }
}

/// The component `selector` names in `layer`: by position from 1, or by the
/// glyph it draws.
fn component_for(
    font: &Font,
    layer: &shift_font::GlyphLayer,
    selector: &str,
) -> Result<ComponentId> {
    let components: Vec<_> = layer.components_iter().collect();
    if let Ok(position) = selector.parse::<usize>() {
        return position
            .checked_sub(1)
            .and_then(|index| components.get(index))
            .map(|component| component.id())
            .ok_or_else(|| {
                miette!(
                    "the drawing has {} components; give a position from 1 to {}",
                    components.len(),
                    components.len()
                )
            });
    }
    let base = font.glyph_id_for(selector)?;
    let mut matching = components
        .iter()
        .filter(|component| component.base_glyph_id() == base);
    match (matching.next(), matching.next()) {
        (Some(component), None) => Ok(component.id()),
        (None, _) => bail!("no component draws {selector:?}"),
        (Some(_), Some(_)) => {
            bail!("several components draw {selector:?}; give its position instead")
        }
    }
}

/// A position counted from 1, as a list index.
fn zero_based(position: usize, flag: &str) -> Result<usize> {
    position
        .checked_sub(1)
        .ok_or_else(|| miette!("{flag} counts from 1"))
}
