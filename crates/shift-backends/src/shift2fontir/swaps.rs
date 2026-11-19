//! Glyph swaps as `rvrn` feature variations.
//!
//! A glyph's swaps are ordered and the first whose condition holds is
//! drawn in its place, once: a swap glyph's own swaps are not
//! applied to it. In the compiled font each swap is a substitution of
//! `rvrn`, which shapers apply before every other feature, as glyphsLib and
//! fontc's Glyphs frontend lower bracket layers and designspace rules with
//! `processing="first"` lower.
//!
//! fontc can't be given overlapping conditions as they are. fontir
//! overlays them into one record per overlap holding every lookup that
//! applies there, in glyph-name order rather than swap order, and
//! fea-rs writes the `FeatureVariationRecord`s in no fixed order while a
//! shaper uses the first that holds. The swaps are therefore lowered
//! to regions of their own first ([`Region::partition`]): disjoint, each
//! with one lookup holding one substitution per glyph, the first swap
//! that holds there. So first-match order holds, a glyph is substituted
//! once, and glyphs whose swaps hold in the same region share its record.

use std::collections::{BTreeMap, HashMap, HashSet};

use fontdrasil::types::{GlyphName, Tag};
use fontir::ir::{Rule, Substitution, VariableFeature};
use shift_font::{Condition, Glyph, GlyphId};

use super::regions::{Lattice, MAX_REGIONS, Region};

/// The feature the substitutions are registered under.
const RVRN: Tag = Tag::new(b"rvrn");

/// Why a glyph's swaps cannot compile.
#[derive(Debug, thiserror::Error)]
pub enum SwapsError {
    #[error(
        "glyph '{glyph}' has the swap '{swap}', which is not exported, so it can't be substituted"
    )]
    SwapNotExported { glyph: String, swap: String },

    #[error(
        "the font's swaps divide its axes into more than {MAX_REGIONS} regions, too many to compile"
    )]
    TooManyRegions,
}

/// One swap where it can hold.
struct Swap<'a> {
    region: Region,
    glyph: GlyphName,
    condition: &'a Condition,
}

/// One glyph's swaps where they can hold, in order.
struct Swaps<'a> {
    glyph: GlyphName,
    swaps: Vec<Swap<'a>>,
}

impl Swaps<'_> {
    /// The glyph drawn in `region`, which every swap's region contains
    /// or misses whole: the first swap that holds there.
    fn drawn_in(&self, region: &Region) -> Option<&GlyphName> {
        self.swaps
            .iter()
            .find(|swap| swap.region.contains(region))
            .map(|swap| &swap.glyph)
    }

    /// Whether no two of the swaps hold anywhere at once, so the
    /// order they are tried in never decides between them.
    fn are_disjoint(&self) -> bool {
        self.swaps.iter().enumerate().all(|(index, swap)| {
            self.swaps
                .iter()
                .skip(index + 1)
                .all(|later| swap.region.intersection(&later.region).is_none())
        })
    }
}

/// Each glyph's swaps that hold somewhere, leaving out glyphs
/// `skipped` from export and swaps whose glyph the font lacks.
///
/// # Errors
///
/// Returns [`SwapsError::SwapNotExported`] when an exported
/// glyph's swap is not exported.
fn collect_swaps<'a>(
    glyphs: &'a [Glyph],
    lattice: &Lattice,
    skipped: &HashSet<String>,
) -> Result<Vec<Swaps<'a>>, SwapsError> {
    let names: HashMap<GlyphId, &str> = glyphs
        .iter()
        .map(|glyph| (glyph.id(), glyph.name()))
        .collect();
    let mut every_glyph = Vec::new();
    for glyph in glyphs {
        if skipped.contains(glyph.name()) || glyph.swaps().is_empty() {
            continue;
        }
        let mut swaps = Vec::new();
        for swap in glyph.swaps() {
            let (Some(region), Some(name)) =
                (lattice.region(swap.condition()), names.get(&swap.glyph()))
            else {
                continue;
            };
            if skipped.contains(*name) {
                return Err(SwapsError::SwapNotExported {
                    glyph: glyph.name().to_string(),
                    swap: name.to_string(),
                });
            }
            swaps.push(Swap {
                region,
                glyph: GlyphName::from(*name),
                condition: swap.condition(),
            });
        }
        if !swaps.is_empty() {
            every_glyph.push(Swaps {
                glyph: glyph.name().into(),
                swaps,
            });
        }
    }
    Ok(every_glyph)
}

/// The `rvrn` feature variations that swap in `glyphs`' swaps, or
/// `None` when no swap holds anywhere. A glyph `skipped` from export
/// is never substituted.
///
/// # Errors
///
/// Returns [`SwapsError`] when an exported glyph's swap is not
/// exported, or the swaps cut the axes into too many regions.
pub(super) fn feature_variations(
    glyphs: &[Glyph],
    lattice: &Lattice,
    skipped: &HashSet<String>,
) -> Result<Option<VariableFeature>, SwapsError> {
    let every_glyph = collect_swaps(glyphs, lattice, skipped)?;
    if every_glyph.is_empty() {
        return Ok(None);
    }
    Ok(Some(VariableFeature {
        features: vec![RVRN],
        rules: region_rules(&every_glyph, lattice)?,
    }))
}

/// The rules a designspace carries for `glyphs`' swaps, read as
/// `processing="first"` (`rvrn`) rules, so a compiler that reads them
/// substitutes as the font compiled from `glyphs` does.
///
/// A glyph whose swaps never hold at once gets one rule per
/// swap, in order, with the swap's own ranges in design units.
/// A glyph with swaps that overlap gets the disjoint region rules
/// [`feature_variations`] compiles, in design units that normalize to the
/// regions' lattice values, because fontc 2.0.1 applies overlapping rules
/// in glyph-name order rather than rule order (see the module docs). A
/// glyph `skipped` from export is never substituted.
///
/// # Errors
///
/// As [`feature_variations`].
pub(crate) fn designspace_rules(
    glyphs: &[Glyph],
    lattice: &Lattice,
    skipped: &HashSet<String>,
) -> Result<Vec<Rule>, SwapsError> {
    let (disjoint, overlapping): (Vec<_>, Vec<_>) = collect_swaps(glyphs, lattice, skipped)?
        .into_iter()
        .partition(Swaps::are_disjoint);
    let mut rules: Vec<Rule> = disjoint
        .iter()
        .flat_map(|glyph| {
            glyph.swaps.iter().map(|swap| Rule {
                conditions: vec![lattice.authored_condition_set(swap.condition)],
                substitutions: vec![Substitution {
                    replace: glyph.glyph.clone(),
                    with: swap.glyph.clone(),
                }],
            })
        })
        .collect();
    if !overlapping.is_empty() {
        rules.extend(region_rules(&overlapping, lattice)?);
    }
    Ok(rules)
}

/// One rule per set of substitutions, over the disjoint regions where
/// `every_glyph`'s swaps draw that set.
///
/// # Errors
///
/// Returns [`SwapsError::TooManyRegions`] when the swaps cut the
/// axes into too many regions.
fn region_rules(every_glyph: &[Swaps], lattice: &Lattice) -> Result<Vec<Rule>, SwapsError> {
    let mut boxes: Vec<&Region> = every_glyph
        .iter()
        .flat_map(|glyph| glyph.swaps.iter().map(|swap| &swap.region))
        .collect();
    boxes.sort();
    boxes.dedup();
    let regions = lattice
        .everywhere()
        .partition(boxes)
        .ok_or(SwapsError::TooManyRegions)?;

    let mut by_substitutions: BTreeMap<BTreeMap<&GlyphName, &GlyphName>, Vec<&Region>> =
        BTreeMap::new();
    for region in &regions {
        let substitutions: BTreeMap<_, _> = every_glyph
            .iter()
            .filter_map(|glyph| Some((&glyph.glyph, glyph.drawn_in(region)?)))
            .collect();
        if !substitutions.is_empty() {
            by_substitutions
                .entry(substitutions)
                .or_default()
                .push(region);
        }
    }
    Ok(by_substitutions
        .into_iter()
        .map(|(substitutions, regions)| Rule {
            conditions: regions
                .into_iter()
                .map(|region| lattice.condition_set(region))
                .collect(),
            substitutions: substitutions
                .into_iter()
                .map(|(replace, with)| Substitution {
                    replace: replace.clone(),
                    with: with.clone(),
                })
                .collect(),
        })
        .collect())
}
