//! Glyph alternates and component conditions: `glyph alternate add`,
//! `remove`, `move` and `set`, and `component condition set`.
//!
//! Conditions are written as shift-font's condition text reads them (see
//! [`shift_font::condition_text`]), in user units on font axes.

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_font::{
    AddGlyphAlternate, AlternateId, ComponentId, Condition, EditGlyphAlternate, Font,
    FontIntentSet, GlyphAlternate, GlyphAlternateEdit, GlyphId, SetComponentCondition,
};

use shift_store::ShiftStore;

use crate::cli::{
    AddAlternateArgs, AlternateSelectorArgs, ConditionArgs, MoveAlternateArgs, MutationArgs,
    RemoveAlternateArgs, SetAlternateArgs, SetComponentConditionArgs,
};
use crate::selector::FontSelectors;

use super::glyph::load_font;
use super::{AuthoringReport, apply_mutation};

/// Adds one alternate to a glyph.
///
/// # Errors
///
/// Rejects a missing condition, unreadable condition text, an unknown glyph
/// or axis, and what the font refuses: the glyph itself, a glyph axis, a
/// reversed range or a position past the end.
pub(crate) fn add_alternate(args: &AddAlternateArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let alternate_glyph = font.glyph_id_for(&args.alternate_glyph)?;
    let condition = parse_condition(&font, Some(glyph_id), &args.condition)?
        .ok_or_else(|| miette!("give the alternate's condition with --when, or --always"))?;
    let position = args.at.map(|at| zero_based(at, "--at")).transpose()?;
    let set = FontIntentSet::from(AddGlyphAlternate {
        glyph_id,
        alternate: GlyphAlternate::new(AlternateId::new(), condition, alternate_glyph),
        position,
    });

    apply_mutation(&args.path, &args.mutation, &set)
}

/// Removes one alternate of a glyph.
///
/// # Errors
///
/// Rejects an unknown glyph or alternate.
pub(crate) fn remove_alternate(args: &RemoveAlternateArgs) -> Result<AuthoringReport> {
    edit_alternate(&args.alternate, &args.mutation, GlyphAlternateEdit::Remove)
}

/// Moves one alternate of a glyph to another position.
///
/// # Errors
///
/// Rejects an unknown glyph or alternate and a position past the end.
pub(crate) fn move_alternate(args: &MoveAlternateArgs) -> Result<AuthoringReport> {
    let edit = GlyphAlternateEdit::Move(zero_based(args.to, "--to")?);
    edit_alternate(&args.alternate, &args.mutation, edit)
}

/// Applies `edit` to the alternate `selector` names.
fn edit_alternate(
    selector: &AlternateSelectorArgs,
    mutation: &MutationArgs,
    edit: GlyphAlternateEdit,
) -> Result<AuthoringReport> {
    let font = load_font(&selector.path)?;
    let alternate_id = alternate_for(&font, selector)?;
    let set = FontIntentSet::from(EditGlyphAlternate { alternate_id, edit });
    apply_mutation(&selector.path, mutation, &set)
}

/// Replaces an alternate's condition, the glyph it draws, or both, as one
/// edit.
///
/// # Errors
///
/// Rejects an empty edit, unreadable condition text, an unknown glyph,
/// alternate or axis, and what the font refuses.
pub(crate) fn set_alternate(args: &SetAlternateArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.alternate.path)?;
    let glyph_id = font.glyph_id_for(&args.alternate.glyph)?;
    let alternate_id = alternate_for(&font, &args.alternate)?;
    let mut edits = Vec::new();
    if let Some(condition) = parse_condition(&font, Some(glyph_id), &args.condition)? {
        edits.push(GlyphAlternateEdit::Condition(condition));
    }
    if let Some(selector) = &args.alternate_glyph {
        edits.push(GlyphAlternateEdit::Glyph(font.glyph_id_for(selector)?));
    }
    if edits.is_empty() {
        bail!("alternate set needs --when, --always or --glyph");
    }
    let set = edits
        .into_iter()
        .map(|edit| EditGlyphAlternate { alternate_id, edit }.into())
        .collect();

    apply_mutation(&args.alternate.path, &args.mutation, &set)
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

/// The alternate `args` names: by position from 1, or by the glyph it
/// draws.
fn alternate_for(font: &Font, args: &AlternateSelectorArgs) -> Result<AlternateId> {
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let alternates = font
        .glyph(glyph_id)
        .map(shift_font::Glyph::alternates)
        .unwrap_or_default();
    if let Ok(position) = args.alternate.parse::<usize>() {
        return position
            .checked_sub(1)
            .and_then(|index| alternates.get(index))
            .map(GlyphAlternate::id)
            .ok_or_else(|| {
                miette!(
                    "glyph {:?} has {} alternates; give a position from 1 to {}",
                    args.glyph,
                    alternates.len(),
                    alternates.len()
                )
            });
    }
    let drawn = font.glyph_id_for(&args.alternate)?;
    let mut matching = alternates
        .iter()
        .filter(|alternate| alternate.glyph() == drawn);
    match (matching.next(), matching.next()) {
        (Some(alternate), None) => Ok(alternate.id()),
        (None, _) => bail!(
            "glyph {:?} has no alternate that draws {:?}",
            args.glyph,
            args.alternate
        ),
        (Some(_), Some(_)) => bail!(
            "several alternates of {:?} draw {:?}; give its position instead",
            args.glyph,
            args.alternate
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
