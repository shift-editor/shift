//! Glyph alternates as `rvrn` feature variations.
//!
//! A glyph's alternates are ordered and the first whose condition holds is
//! drawn in its place, once: an alternate glyph's own alternates are not
//! applied to it. In the compiled font each alternate is a substitution of
//! `rvrn`, which shapers apply before every other feature, as glyphsLib and
//! fontc's Glyphs frontend lower bracket layers and designspace rules with
//! `processing="first"` lower.
//!
//! fontc can't be given overlapping conditions as they are. fontir
//! overlays them into one record per overlap holding every lookup that
//! applies there, in glyph-name order rather than alternate order, and
//! fea-rs writes the `FeatureVariationRecord`s in no fixed order while a
//! shaper uses the first that holds. The alternates are therefore lowered
//! to regions of their own first ([`Region::partition`]): disjoint, each
//! with one lookup holding one substitution per glyph, the first alternate
//! that holds there. So first-match order holds, a glyph is substituted
//! once, and glyphs whose alternates hold in the same region share its record.

use std::collections::{BTreeMap, HashMap, HashSet};

use fontdrasil::types::{GlyphName, Tag};
use fontir::ir::{Rule, Substitution, VariableFeature};
use shift_font::{Condition, Glyph, GlyphId};

use super::regions::{Lattice, MAX_REGIONS, Region};

/// The feature the substitutions are registered under.
const RVRN: Tag = Tag::new(b"rvrn");

/// Why a glyph's alternates cannot compile.
#[derive(Debug, thiserror::Error)]
pub enum AlternatesError {
    #[error(
        "glyph '{glyph}' has the alternate '{alternate}', which is not exported, so it can't be substituted"
    )]
    AlternateNotExported { glyph: String, alternate: String },

    #[error(
        "the font's alternates divide its axes into more than {MAX_REGIONS} regions, too many to compile"
    )]
    TooManyRegions,
}

/// One alternate where it can hold.
struct Alternate<'a> {
    region: Region,
    glyph: GlyphName,
    condition: &'a Condition,
}

/// One glyph's alternates where they can hold, in order.
struct Alternates<'a> {
    glyph: GlyphName,
    alternates: Vec<Alternate<'a>>,
}

impl Alternates<'_> {
    /// The glyph drawn in `region`, which every alternate's region contains
    /// or misses whole: the first alternate that holds there.
    fn drawn_in(&self, region: &Region) -> Option<&GlyphName> {
        self.alternates
            .iter()
            .find(|alternate| alternate.region.contains(region))
            .map(|alternate| &alternate.glyph)
    }

    /// Whether no two of the alternates hold anywhere at once, so the
    /// order they are tried in never decides between them.
    fn are_disjoint(&self) -> bool {
        self.alternates
            .iter()
            .enumerate()
            .all(|(index, alternate)| {
                self.alternates
                    .iter()
                    .skip(index + 1)
                    .all(|later| alternate.region.intersection(&later.region).is_none())
            })
    }
}

/// Each glyph's alternates that hold somewhere, leaving out glyphs
/// `skipped` from export and alternates whose glyph the font lacks.
///
/// # Errors
///
/// Returns [`AlternatesError::AlternateNotExported`] when an exported
/// glyph's alternate is not exported.
fn collect_alternates<'a>(
    glyphs: &'a [Glyph],
    lattice: &Lattice,
    skipped: &HashSet<String>,
) -> Result<Vec<Alternates<'a>>, AlternatesError> {
    let names: HashMap<GlyphId, &str> = glyphs
        .iter()
        .map(|glyph| (glyph.id(), glyph.name()))
        .collect();
    let mut every_glyph = Vec::new();
    for glyph in glyphs {
        if skipped.contains(glyph.name()) || glyph.alternates().is_empty() {
            continue;
        }
        let mut alternates = Vec::new();
        for alternate in glyph.alternates() {
            let (Some(region), Some(name)) = (
                lattice.region(alternate.condition()),
                names.get(&alternate.glyph()),
            ) else {
                continue;
            };
            if skipped.contains(*name) {
                return Err(AlternatesError::AlternateNotExported {
                    glyph: glyph.name().to_string(),
                    alternate: name.to_string(),
                });
            }
            alternates.push(Alternate {
                region,
                glyph: GlyphName::from(*name),
                condition: alternate.condition(),
            });
        }
        if !alternates.is_empty() {
            every_glyph.push(Alternates {
                glyph: glyph.name().into(),
                alternates,
            });
        }
    }
    Ok(every_glyph)
}

/// The `rvrn` feature variations that swap in `glyphs`' alternates, or
/// `None` when no alternate holds anywhere. A glyph `skipped` from export
/// is never substituted.
///
/// # Errors
///
/// Returns [`AlternatesError`] when an exported glyph's alternate is not
/// exported, or the alternates cut the axes into too many regions.
pub(super) fn feature_variations(
    glyphs: &[Glyph],
    lattice: &Lattice,
    skipped: &HashSet<String>,
) -> Result<Option<VariableFeature>, AlternatesError> {
    let every_glyph = collect_alternates(glyphs, lattice, skipped)?;
    if every_glyph.is_empty() {
        return Ok(None);
    }
    Ok(Some(VariableFeature {
        features: vec![RVRN],
        rules: region_rules(&every_glyph, lattice)?,
    }))
}

/// The rules a designspace carries for `glyphs`' alternates, read as
/// `processing="first"` (`rvrn`) rules, so a compiler that reads them
/// substitutes as the font compiled from `glyphs` does.
///
/// A glyph whose alternates never hold at once gets one rule per
/// alternate, in order, with the alternate's own ranges in design units.
/// A glyph with alternates that overlap gets the disjoint region rules
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
) -> Result<Vec<Rule>, AlternatesError> {
    let (disjoint, overlapping): (Vec<_>, Vec<_>) = collect_alternates(glyphs, lattice, skipped)?
        .into_iter()
        .partition(Alternates::are_disjoint);
    let mut rules: Vec<Rule> = disjoint
        .iter()
        .flat_map(|glyph| {
            glyph.alternates.iter().map(|alternate| Rule {
                conditions: vec![lattice.authored_condition_set(alternate.condition)],
                substitutions: vec![Substitution {
                    replace: glyph.glyph.clone(),
                    with: alternate.glyph.clone(),
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
/// `every_glyph`'s alternates draw that set.
///
/// # Errors
///
/// Returns [`AlternatesError::TooManyRegions`] when the alternates cut the
/// axes into too many regions.
fn region_rules(
    every_glyph: &[Alternates],
    lattice: &Lattice,
) -> Result<Vec<Rule>, AlternatesError> {
    let mut boxes: Vec<&Region> = every_glyph
        .iter()
        .flat_map(|glyph| glyph.alternates.iter().map(|alternate| &alternate.region))
        .collect();
    boxes.sort();
    boxes.dedup();
    let regions = lattice
        .everywhere()
        .partition(boxes)
        .ok_or(AlternatesError::TooManyRegions)?;

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
