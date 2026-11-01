//! The substitutions a feature can make, read from the font's `GSUB`.

use std::collections::BTreeSet;

use read_fonts::collections::IntSet;
use read_fonts::tables::gsub::{
    AlternateSubstFormat1, Gsub, LigatureSubstFormat1, MultipleSubstFormat1,
    ReverseChainSingleSubstFormat1, SingleSubst, SubstitutionSubtables,
};
use read_fonts::types::{GlyphId, Tag};
use read_fonts::{FontRef, ReadError, TableProvider};

use crate::{GlyphSource, ShapeError, Shaper};

/// One substitution a feature can make: `input` in the text becomes `output`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Substitution<G> {
    /// The glyphs replaced; more than one for a ligature.
    pub input: Vec<G>,
    pub output: G,
}

/// One substitution in shaper glyph ids. Ordered by output glyph, then
/// input, which is the order [`Shaper::feature_substitutions`] returns.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Rule {
    output: u32,
    input: Vec<u32>,
}

impl Rule {
    fn single(input: u32, output: u32) -> Self {
        Self {
            output,
            input: vec![input],
        }
    }

    /// The rule in the host's glyphs; `None` when `source` has no glyph for
    /// one of them, such as `.notdef`.
    fn on_host<S: GlyphSource>(self, source: &S) -> Option<Substitution<S::Glyph>> {
        let input = self
            .input
            .into_iter()
            .map(|glyph| source.host_glyph(glyph))
            .collect::<Option<Vec<_>>>()?;
        Some(Substitution {
            input,
            output: source.host_glyph(self.output)?,
        })
    }
}

impl Shaper {
    /// Returns every substitution a feature can make, ordered by output glyph
    /// then input: each rule of each lookup the feature reaches, lookups that
    /// contextual rules call included, whether or not its input is a glyph the
    /// font maps a character to. A rule with several outputs, such as a
    /// multiple substitution or a set of alternates, gives one substitution
    /// per output. Glyphs `source` has no glyph for, such as `.notdef`, drop
    /// the substitutions they appear in.
    ///
    /// Empty for a positioning feature, a tag the font does not define, or a
    /// font without a `GSUB`.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the font, or a `GSUB` it has,
    /// cannot be read.
    pub fn feature_substitutions<S: GlyphSource>(
        &self,
        source: &S,
        tag: Tag,
    ) -> Result<Vec<Substitution<S::Glyph>>, ShapeError> {
        let font = self.font()?;
        let Some(gsub) = gsub(&font)? else {
            return Ok(Vec::new());
        };
        let rules = feature_rules(&gsub, tag).map_err(ShapeError::InvalidFont)?;
        Ok(rules
            .into_iter()
            .filter_map(|rule| rule.on_host(source))
            .collect())
    }
}

/// The font's `GSUB`, or `None` when it has none.
///
/// # Errors
///
/// Returns [`ShapeError::InvalidFont`] when the font has a `GSUB` that cannot
/// be read, so a broken table never reads as a missing one.
fn gsub<'a>(font: &FontRef<'a>) -> Result<Option<Gsub<'a>>, ShapeError> {
    match font.gsub() {
        Ok(gsub) => Ok(Some(gsub)),
        Err(ReadError::TableIsMissing(_)) => Ok(None),
        Err(error) => Err(ShapeError::InvalidFont(error)),
    }
}

/// Every rule of every lookup a feature reaches.
fn feature_rules(gsub: &Gsub<'_>, tag: Tag) -> Result<BTreeSet<Rule>, ReadError> {
    let mut rules = BTreeSet::new();
    let lookup_list = gsub.lookup_list()?;
    for index in feature_lookups(gsub, tag)?.iter() {
        let lookup = lookup_list.lookups().get(usize::from(index))?;
        lookup_rules(&lookup.subtables()?, &mut rules)?;
    }
    Ok(rules)
}

/// The lookups a feature's records name, and every lookup their contextual
/// rules call, at any depth.
fn feature_lookups(gsub: &Gsub<'_>, tag: Tag) -> Result<IntSet<u16>, ReadError> {
    let mut features = IntSet::empty();
    // A feature list holds at most `u16::MAX` records, so every index fits.
    for (index, record) in (0_u16..).zip(gsub.feature_list()?.feature_records()) {
        if record.feature_tag() == tag {
            features.insert(index);
        }
    }
    if features.is_empty() {
        return Ok(features);
    }
    let mut lookups = gsub.collect_lookups(&features)?;
    gsub.closure_lookups(&IntSet::<GlyphId>::all(), &mut lookups)?;
    Ok(lookups)
}

/// Adds the rules of one lookup's subtables, by the kind of lookup.
fn lookup_rules(
    subtables: &SubstitutionSubtables<'_>,
    rules: &mut BTreeSet<Rule>,
) -> Result<(), ReadError> {
    match subtables {
        SubstitutionSubtables::Single(subtables) => each(subtables.iter(), rules, single_rules),
        SubstitutionSubtables::Multiple(subtables) => each(subtables.iter(), rules, multiple_rules),
        SubstitutionSubtables::Alternate(subtables) => {
            each(subtables.iter(), rules, alternate_rules)
        }
        SubstitutionSubtables::Ligature(subtables) => each(subtables.iter(), rules, ligature_rules),
        SubstitutionSubtables::Reverse(subtables) => each(subtables.iter(), rules, reverse_rules),
        // Contextual rules substitute only through the lookups they call,
        // which `feature_lookups` already reached.
        SubstitutionSubtables::Contextual(_)
        | SubstitutionSubtables::ChainContextual(_)
        | SubstitutionSubtables::EmptyExtension => Ok(()),
    }
}

/// Adds the rules of each subtable of one kind.
fn each<T>(
    subtables: impl Iterator<Item = Result<T, ReadError>>,
    rules: &mut BTreeSet<Rule>,
    add: fn(&T, &mut BTreeSet<Rule>) -> Result<(), ReadError>,
) -> Result<(), ReadError> {
    for subtable in subtables {
        add(&subtable?, rules)?;
    }
    Ok(())
}

/// One glyph for another: by a shared delta (format 1) or a list (format 2).
fn single_rules(subtable: &SingleSubst<'_>, rules: &mut BTreeSet<Rule>) -> Result<(), ReadError> {
    match subtable {
        SingleSubst::Format1(table) => {
            let delta = table.delta_glyph_id();
            for glyph in table.coverage()?.iter() {
                // Glyph ids add the delta modulo 65536.
                let output = glyph.to_u16().wrapping_add_signed(delta);
                rules.insert(Rule::single(glyph.to_u32(), u32::from(output)));
            }
        }
        SingleSubst::Format2(table) => {
            for (glyph, output) in table.coverage()?.iter().zip(table.substitute_glyph_ids()) {
                rules.insert(Rule::single(glyph.to_u32(), output.get().to_u32()));
            }
        }
    }
    Ok(())
}

/// One glyph for a sequence: a rule per glyph of the sequence.
fn multiple_rules(
    subtable: &MultipleSubstFormat1<'_>,
    rules: &mut BTreeSet<Rule>,
) -> Result<(), ReadError> {
    let sequences = subtable.sequences();
    for (glyph, sequence) in subtable.coverage()?.iter().zip(sequences.iter()) {
        for output in sequence?.substitute_glyph_ids() {
            rules.insert(Rule::single(glyph.to_u32(), output.get().to_u32()));
        }
    }
    Ok(())
}

/// One glyph for any of its alternates: a rule per alternate.
fn alternate_rules(
    subtable: &AlternateSubstFormat1<'_>,
    rules: &mut BTreeSet<Rule>,
) -> Result<(), ReadError> {
    let sets = subtable.alternate_sets();
    for (glyph, set) in subtable.coverage()?.iter().zip(sets.iter()) {
        for output in set?.alternate_glyph_ids() {
            rules.insert(Rule::single(glyph.to_u32(), output.get().to_u32()));
        }
    }
    Ok(())
}

/// A sequence for one glyph: the first glyph from the coverage, the rest
/// from each ligature's components.
fn ligature_rules(
    subtable: &LigatureSubstFormat1<'_>,
    rules: &mut BTreeSet<Rule>,
) -> Result<(), ReadError> {
    let sets = subtable.ligature_sets();
    for (first, set) in subtable.coverage()?.iter().zip(sets.iter()) {
        for ligature in set?.ligatures().iter() {
            let ligature = ligature?;
            let rest = ligature
                .component_glyph_ids()
                .iter()
                .map(|id| id.get().to_u32());
            rules.insert(Rule {
                output: ligature.ligature_glyph().to_u32(),
                input: std::iter::once(first.to_u32()).chain(rest).collect(),
            });
        }
    }
    Ok(())
}

/// One glyph for another, applied from the end of the text backwards.
fn reverse_rules(
    subtable: &ReverseChainSingleSubstFormat1<'_>,
    rules: &mut BTreeSet<Rule>,
) -> Result<(), ReadError> {
    for (glyph, output) in subtable
        .coverage()?
        .iter()
        .zip(subtable.substitute_glyph_ids())
    {
        rules.insert(Rule::single(glyph.to_u32(), output.get().to_u32()));
    }
    Ok(())
}
