//! Kerning group and pair-value authoring through semantic intents.
//!
//! Selectors name glyphs and groups; Shift mints every new group id. A batch
//! lowers to one intent set, so it saves completely or not at all.

use std::collections::{HashMap, HashSet};

use miette::{Result, WrapErr, bail, miette};
use serde::Deserialize;
use shift_font::{
    Font, FontIntent, FontIntentSet, GlyphId, KerningGroupId, KerningPair, KerningPosition,
    KerningSide, KerningValueEdit, SourceId,
};

use crate::cli::{
    AssignKerningGroupArgs, CreateKerningGroupArgs, DeleteKerningGroupArgs, KerningPositionArg,
    RemoveKerningArgs, RenameKerningGroupArgs, SetKerningArgs, UnassignKerningGroupArgs,
};
use crate::kerning::selector::{GROUP_PREFIX, position_label, resolve_group_id, resolve_side};

use super::font_info::target_source_id;
use super::glyph::{load_font, resolve_glyph_id};
use super::layer_payload::read_json_input;
use super::{AuthoringReport, apply_mutation, require_finite};

/// Sets one pair's value at one master, or applies a JSON batch.
///
/// A pair side is a glyph name or id, or `@NAME` for a group at that side's
/// position. See [`KerningBatchInput`] for the batch format.
///
/// # Errors
///
/// Rejects non-finite values, unresolved selectors, invalid batches, and
/// invalid kerning edits without writing. Reports persistence failures.
pub fn set_kerning(args: SetKerningArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let intents = match &args.input {
        Some(input) => {
            let batch = read_json_input::<KerningBatchInput>(input, "kerning batch")?;
            plan_batch(&font, batch)?
        }
        None => {
            let (Some(first), Some(second), Some(value)) = (&args.first, &args.second, args.value)
            else {
                bail!("expected FIRST SECOND VALUE, or --input");
            };
            require_finite(value, "kerning value")?;
            let edit = KerningValueEdit {
                source_id: target_source_id(&font, args.source.as_deref())?,
                pair: resolve_pair(&font, first, second)?,
                value: Some(value),
            };
            vec![FontIntent::SetKerningValues { edits: vec![edit] }]
        }
    };

    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
}

/// Removes one pair's value at one master.
///
/// # Errors
///
/// Rejects unresolved selectors and a pair with no value at that master.
/// Reports persistence failures.
pub fn remove_kerning(args: RemoveKerningArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let source_id = target_source_id(&font, args.source.as_deref())?;
    let pair = resolve_pair(&font, &args.first, &args.second)?;
    if font.kerning().value(&source_id, &pair).is_none() {
        let source = font.source(&source_id).map_or("", |source| source.name());
        bail!(
            "{} {} has no value at source {source:?}",
            args.first,
            args.second
        );
    }
    let edits = vec![KerningValueEdit {
        source_id,
        pair,
        value: None,
    }];

    apply_mutation(
        &args.path,
        &args.mutation,
        FontIntentSet {
            intents: vec![FontIntent::SetKerningValues { edits }],
        },
    )
}

/// Creates a group and moves any listed glyphs into it, in one step.
///
/// # Errors
///
/// Rejects blank or duplicate names and unresolved glyphs. Reports
/// persistence failures.
pub fn create_kerning_group(args: CreateKerningGroupArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let position = KerningPosition::from(args.position);
    let group_id = KerningGroupId::new();
    let mut intents = vec![FontIntent::CreateKerningGroup {
        group_id: group_id.clone(),
        position,
        name: args.name,
    }];
    intents.extend(member_intents(
        &font,
        position,
        &args.members,
        Some(&group_id),
    )?);

    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
}

/// Renames a group; pairs reference it by id, so its kerning is unchanged.
///
/// # Errors
///
/// Rejects an unresolved group and a blank or duplicate name. Reports
/// persistence failures.
pub fn rename_kerning_group(args: RenameKerningGroupArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let group_id = resolve_group_id(&font, args.position.into(), &args.group)?;
    let set = FontIntentSet {
        intents: vec![FontIntent::RenameKerningGroup {
            group_id,
            name: args.name,
        }],
    };

    apply_mutation(&args.path, &args.mutation, set)
}

/// Deletes a group. Pairs that reference it are kept but no longer apply.
///
/// # Errors
///
/// Rejects an unresolved group. Reports persistence failures.
pub fn delete_kerning_group(args: DeleteKerningGroupArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let group_id = resolve_group_id(&font, args.position.into(), &args.group)?;
    let set = FontIntentSet {
        intents: vec![FontIntent::DeleteKerningGroup { group_id }],
    };

    apply_mutation(&args.path, &args.mutation, set)
}

/// Moves glyphs into a group, out of any other group at its position.
///
/// # Errors
///
/// Rejects an unresolved group or glyph, and a repeated glyph. Reports
/// persistence failures.
pub fn assign_kerning_group(args: AssignKerningGroupArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let position = KerningPosition::from(args.position);
    let group_id = resolve_group_id(&font, position, &args.group)?;
    let intents = member_intents(&font, position, &args.members, Some(&group_id))?;

    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
}

/// Takes glyphs out of their group at one position.
///
/// # Errors
///
/// Rejects an unresolved or repeated glyph. Reports persistence failures.
pub fn unassign_kerning_group(args: UnassignKerningGroupArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let intents = member_intents(&font, args.position.into(), &args.members, None)?;

    apply_mutation(&args.path, &args.mutation, FontIntentSet { intents })
}

/// A JSON batch of kerning edits, applied atomically.
///
/// Groups apply first, so pairs may name groups the same batch creates:
///
/// ```json
/// {
///   "groups": [{ "position": "first", "name": "A", "members": ["A", "Aacute"] }],
///   "pairs": [{ "source": "Regular", "first": "@A", "second": "V", "value": -40 }]
/// }
/// ```
///
/// A group that does not exist is created. When `members` is given it
/// becomes the group's whole membership; omitted, membership is unchanged.
/// A pair without `source` edits the default source, and a `value` of `null`
/// removes it there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KerningBatchInput {
    #[serde(default)]
    groups: Vec<GroupInput>,
    #[serde(default)]
    pairs: Vec<PairInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroupInput {
    position: KerningPositionArg,
    name: String,
    #[serde(default)]
    members: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PairInput {
    #[serde(default)]
    source: Option<String>,
    first: String,
    second: String,
    value: Option<f64>,
}

fn plan_batch(font: &Font, batch: KerningBatchInput) -> Result<Vec<FontIntent>> {
    if batch.groups.is_empty() && batch.pairs.is_empty() {
        bail!("kerning batch contains no groups or pairs");
    }

    let mut intents = Vec::new();
    // Groups this batch creates, so later entries resolve them by name.
    let mut planned = HashMap::<(KerningPosition, String), KerningGroupId>::new();
    let mut claimed = HashSet::<(KerningPosition, GlyphId)>::new();
    for (index, group) in batch.groups.into_iter().enumerate() {
        let position = KerningPosition::from(group.position);
        let name = group.name.trim().to_string();
        let context = || format!("group {name:?} (entry {})", index + 1);
        let key = (position, name.clone());
        if planned.contains_key(&key) {
            bail!("{}: group appears more than once", context());
        }

        let existing = font.kerning().group_id(position, &name).cloned();
        let group_id = match existing.clone() {
            Some(group_id) => group_id,
            None => {
                let group_id = KerningGroupId::new();
                intents.push(FontIntent::CreateKerningGroup {
                    group_id: group_id.clone(),
                    position,
                    name: group.name.clone(),
                });
                group_id
            }
        };
        planned.insert(key, group_id.clone());

        let Some(members) = group.members else {
            continue;
        };
        let member_ids = resolve_members(font, &members).wrap_err_with(context)?;
        for glyph_id in &member_ids {
            if !claimed.insert((position, glyph_id.clone())) {
                bail!(
                    "{}: glyph {glyph_id} is listed in two {} groups",
                    context(),
                    position_label(position)
                );
            }
        }
        let current = existing
            .as_ref()
            .and_then(|group_id| font.kerning().group(group_id))
            .map(|group| group.members.clone())
            .unwrap_or_default();
        intents.extend(
            current
                .into_iter()
                .filter(|glyph_id| !member_ids.contains(glyph_id))
                .map(|glyph_id| FontIntent::SetKerningGroupMember {
                    position,
                    glyph_id,
                    group_id: None,
                }),
        );
        intents.extend(
            member_ids
                .into_iter()
                .map(|glyph_id| FontIntent::SetKerningGroupMember {
                    position,
                    glyph_id,
                    group_id: Some(group_id.clone()),
                }),
        );
    }

    let mut edits = Vec::new();
    let mut seen = HashSet::<(SourceId, KerningPair)>::new();
    for (index, input) in batch.pairs.into_iter().enumerate() {
        let context = || {
            format!(
                "pair {} {} (entry {})",
                input.first,
                input.second,
                index + 1
            )
        };
        let source_id = target_source_id(font, input.source.as_deref()).wrap_err_with(context)?;
        let side = |position, selector: &str| -> Result<KerningSide> {
            let planned_group = selector
                .strip_prefix(GROUP_PREFIX)
                .and_then(|name| planned.get(&(position, name.to_string())));
            match planned_group {
                Some(group_id) => Ok(KerningSide::Group(group_id.clone())),
                None => resolve_side(font, position, selector),
            }
        };
        let pair = KerningPair::new(
            side(KerningPosition::First, &input.first).wrap_err_with(context)?,
            side(KerningPosition::Second, &input.second).wrap_err_with(context)?,
        );
        if let Some(value) = input.value {
            require_finite(value, "kerning value").wrap_err_with(context)?;
        }
        if !seen.insert((source_id.clone(), pair.clone())) {
            bail!("{}: pair appears more than once at this source", context());
        }
        edits.push(KerningValueEdit {
            source_id,
            pair,
            value: input.value,
        });
    }
    if !edits.is_empty() {
        intents.push(FontIntent::SetKerningValues { edits });
    }

    Ok(intents)
}

fn resolve_pair(font: &Font, first: &str, second: &str) -> Result<KerningPair> {
    Ok(KerningPair::new(
        resolve_side(font, KerningPosition::First, first)?,
        resolve_side(font, KerningPosition::Second, second)?,
    ))
}

fn resolve_members(font: &Font, selectors: &[String]) -> Result<Vec<GlyphId>> {
    let mut seen = HashSet::new();
    selectors
        .iter()
        .map(|selector| {
            let glyph_id = resolve_glyph_id(font, selector)?;
            if !seen.insert(glyph_id.clone()) {
                return Err(miette!("glyph {selector:?} is repeated"));
            }
            Ok(glyph_id)
        })
        .collect()
}

fn member_intents(
    font: &Font,
    position: KerningPosition,
    selectors: &[String],
    group_id: Option<&KerningGroupId>,
) -> Result<Vec<FontIntent>> {
    Ok(resolve_members(font, selectors)?
        .into_iter()
        .map(|glyph_id| FontIntent::SetKerningGroupMember {
            position,
            glyph_id,
            group_id: group_id.cloned(),
        })
        .collect())
}
