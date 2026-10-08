//! Kerning groups and per-source kerning values.
//!
//! Groups are font-wide: a glyph belongs to at most one group for each pair
//! position. Pair values are authored per source, and a pair absent from a
//! source has no value there. Glyphs are referenced by [`GlyphId`], so a
//! renamed glyph keeps its kerning. References to glyphs or sources that are
//! not in the font are retained but never resolve, so deleting and restoring
//! a glyph or source keeps its kerning intact.

use crate::{GlyphId, SourceId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The position a glyph or group occupies in a kerning pair.
///
/// A glyph's `First` group kerns its right edge against what follows it, and
/// its `Second` group kerns its left edge against what precedes it. UFO calls
/// these `public.kern1` and `public.kern2`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum KerningPosition {
    First,
    Second,
}

/// One side of a kerning pair: a single glyph or a group for that position.
///
/// Group names carry no format prefix; the pair position selects the group
/// collection the name belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum KerningSide {
    Glyph(GlyphId),
    Group(String),
}

/// An ordered kerning pair, independent of any source's value for it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct KerningPair {
    pub first: KerningSide,
    pub second: KerningSide,
}

impl KerningPair {
    pub fn new(first: KerningSide, second: KerningSide) -> Self {
        Self { first, second }
    }

    pub fn glyphs(first: GlyphId, second: GlyphId) -> Self {
        Self::new(KerningSide::Glyph(first), KerningSide::Glyph(second))
    }

    pub fn groups(first: impl Into<String>, second: impl Into<String>) -> Self {
        Self::new(
            KerningSide::Group(first.into()),
            KerningSide::Group(second.into()),
        )
    }
}

/// The kerning that applies between two glyphs at one source.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedKerning {
    /// The authored pair that supplied the value.
    pub pair: KerningPair,
    /// The adjustment in font units added after the first glyph's advance.
    pub value: f64,
}

/// Kerning pair values authored for one source.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(from = "Vec<(KerningPair, f64)>", into = "Vec<(KerningPair, f64)>")]
pub struct SourceKerning {
    values: BTreeMap<KerningPair, f64>,
}

impl SourceKerning {
    pub fn value(&self, pair: &KerningPair) -> Option<f64> {
        self.values.get(pair).copied()
    }

    /// Returns every pair and its value, ordered by pair.
    pub fn pairs(&self) -> impl Iterator<Item = (&KerningPair, f64)> {
        self.values.iter().map(|(pair, value)| (pair, *value))
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }
}

impl From<Vec<(KerningPair, f64)>> for SourceKerning {
    fn from(values: Vec<(KerningPair, f64)>) -> Self {
        Self {
            values: values.into_iter().collect(),
        }
    }
}

impl From<SourceKerning> for Vec<(KerningPair, f64)> {
    fn from(kerning: SourceKerning) -> Self {
        kerning.values.into_iter().collect()
    }
}

/// Font-wide kerning groups and the pair values of every source.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Kerning {
    first_groups: BTreeMap<String, Vec<GlyphId>>,
    second_groups: BTreeMap<String, Vec<GlyphId>>,
    sources: BTreeMap<SourceId, SourceKerning>,
}

impl Kerning {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the groups for `position`, ordered by name, with members in
    /// authored order.
    pub fn groups(&self, position: KerningPosition) -> &BTreeMap<String, Vec<GlyphId>> {
        match position {
            KerningPosition::First => &self.first_groups,
            KerningPosition::Second => &self.second_groups,
        }
    }

    /// Returns the members of the group `name` at `position`.
    pub fn group(&self, position: KerningPosition, name: &str) -> Option<&[GlyphId]> {
        self.groups(position).get(name).map(Vec::as_slice)
    }

    /// Returns the name of the group `glyph_id` belongs to at `position`.
    pub fn group_of(&self, position: KerningPosition, glyph_id: &GlyphId) -> Option<&str> {
        self.groups(position)
            .iter()
            .find(|(_, members)| members.contains(glyph_id))
            .map(|(name, _)| name.as_str())
    }

    /// Replaces the members of group `name` at `position`, creating it when
    /// absent.
    ///
    /// Membership is exclusive per position: each member is removed from any
    /// other group at `position`, and a member repeated in `members` is kept
    /// once at its first occurrence. A group left with no members still
    /// exists. Returns the members that moved out of another group.
    pub fn set_group(
        &mut self,
        position: KerningPosition,
        name: impl Into<String>,
        members: Vec<GlyphId>,
    ) -> Vec<GlyphId> {
        let name = name.into();
        let mut unique = Vec::with_capacity(members.len());
        for member in members {
            if !unique.contains(&member) {
                unique.push(member);
            }
        }

        let groups = self.groups_mut(position);
        let mut moved = Vec::new();
        for (other_name, other_members) in groups.iter_mut() {
            if *other_name == name {
                continue;
            }
            other_members.retain(|member| {
                let claimed = unique.contains(member);
                if claimed {
                    moved.push(member.clone());
                }
                !claimed
            });
        }
        groups.insert(name, unique);
        moved
    }

    /// Removes group `name` at `position` and returns its members.
    ///
    /// Pairs that name the group are kept; they resolve again if a group with
    /// the same name is created.
    pub fn remove_group(&mut self, position: KerningPosition, name: &str) -> Option<Vec<GlyphId>> {
        self.groups_mut(position).remove(name)
    }

    /// Returns the pair values authored for `source_id`.
    pub fn source(&self, source_id: &SourceId) -> Option<&SourceKerning> {
        self.sources.get(source_id)
    }

    /// Returns every source with authored pairs, ordered by source id.
    pub fn sources(&self) -> impl Iterator<Item = (&SourceId, &SourceKerning)> {
        self.sources.iter()
    }

    /// Returns the value of `pair` authored at `source_id`.
    pub fn value(&self, source_id: &SourceId, pair: &KerningPair) -> Option<f64> {
        self.source(source_id)?.value(pair)
    }

    /// Sets the value of `pair` at `source_id` and returns the previous value.
    pub fn set_value(&mut self, source_id: SourceId, pair: KerningPair, value: f64) -> Option<f64> {
        self.sources
            .entry(source_id)
            .or_default()
            .values
            .insert(pair, value)
    }

    /// Removes the value of `pair` at `source_id` and returns it.
    ///
    /// A source left with no pairs is dropped.
    pub fn remove_value(&mut self, source_id: &SourceId, pair: &KerningPair) -> Option<f64> {
        let source = self.sources.get_mut(source_id)?;
        let removed = source.values.remove(pair);
        if source.is_empty() {
            self.sources.remove(source_id);
        }
        removed
    }

    /// Resolves the kerning between `first` followed by `second` at
    /// `source_id`.
    ///
    /// The most specific authored pair wins, in UFO order: glyph and glyph,
    /// then glyph and the second's group, then the first's group and glyph,
    /// then group and group. Returns `None` when no pair applies, which means
    /// no adjustment at this source.
    pub fn resolve(
        &self,
        source_id: &SourceId,
        first: &GlyphId,
        second: &GlyphId,
    ) -> Option<ResolvedKerning> {
        let source = self.source(source_id)?;
        let first_glyph = KerningSide::Glyph(first.clone());
        let second_glyph = KerningSide::Glyph(second.clone());
        let first_group = self
            .group_of(KerningPosition::First, first)
            .map(|name| KerningSide::Group(name.to_string()));
        let second_group = self
            .group_of(KerningPosition::Second, second)
            .map(|name| KerningSide::Group(name.to_string()));

        let candidates = [
            Some((first_glyph.clone(), second_glyph.clone())),
            second_group.clone().map(|group| (first_glyph, group)),
            first_group.clone().map(|group| (group, second_glyph)),
            first_group.zip(second_group),
        ];
        candidates
            .into_iter()
            .flatten()
            .find_map(|(first, second)| {
                let pair = KerningPair::new(first, second);
                source
                    .value(&pair)
                    .map(|value| ResolvedKerning { pair, value })
            })
    }

    /// Returns `true` when the font has no groups and no pair values.
    pub fn is_empty(&self) -> bool {
        self.first_groups.is_empty() && self.second_groups.is_empty() && self.sources.is_empty()
    }

    fn groups_mut(&mut self, position: KerningPosition) -> &mut BTreeMap<String, Vec<GlyphId>> {
        match position {
            KerningPosition::First => &mut self.first_groups,
            KerningPosition::Second => &mut self.second_groups,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glyph(name: &str) -> GlyphId {
        GlyphId::from_raw(name)
    }

    fn sample() -> (Kerning, SourceId) {
        let source_id = SourceId::from_raw("regular");
        let mut kerning = Kerning::new();
        kerning.set_group(
            KerningPosition::First,
            "A",
            vec![glyph("A"), glyph("Aacute")],
        );
        kerning.set_group(KerningPosition::Second, "V", vec![glyph("V"), glyph("W")]);
        kerning.set_value(source_id.clone(), KerningPair::groups("A", "V"), -40.0);
        (kerning, source_id)
    }

    #[test]
    fn group_pairs_resolve_for_every_member() {
        let (kerning, source_id) = sample();

        let resolved = kerning
            .resolve(&source_id, &glyph("Aacute"), &glyph("W"))
            .unwrap();
        assert_eq!(resolved.value, -40.0);
        assert_eq!(resolved.pair, KerningPair::groups("A", "V"));
    }

    #[test]
    fn the_most_specific_pair_wins_regardless_of_insertion_order() {
        let (mut kerning, source_id) = sample();
        let first_exception = KerningPair::new(
            KerningSide::Glyph(glyph("A")),
            KerningSide::Group("V".into()),
        );
        let second_exception = KerningPair::new(
            KerningSide::Group("A".into()),
            KerningSide::Glyph(glyph("V")),
        );
        kerning.set_value(source_id.clone(), second_exception.clone(), -30.0);
        kerning.set_value(source_id.clone(), first_exception, -20.0);
        kerning.set_value(
            source_id.clone(),
            KerningPair::glyphs(glyph("A"), glyph("V")),
            -10.0,
        );

        let value = |first: &str, second: &str| {
            kerning
                .resolve(&source_id, &glyph(first), &glyph(second))
                .map(|resolved| resolved.value)
        };
        assert_eq!(value("A", "V"), Some(-10.0));
        assert_eq!(value("A", "W"), Some(-20.0));
        assert_eq!(value("Aacute", "V"), Some(-30.0));
        assert_eq!(value("Aacute", "W"), Some(-40.0));
        assert_eq!(value("V", "A"), None);
    }

    #[test]
    fn values_are_independent_per_source() {
        let (mut kerning, regular) = sample();
        let bold = SourceId::from_raw("bold");
        kerning.set_value(bold.clone(), KerningPair::groups("A", "V"), -80.0);

        let at = |source_id: &SourceId| {
            kerning
                .resolve(source_id, &glyph("A"), &glyph("V"))
                .map(|resolved| resolved.value)
        };
        assert_eq!(at(&regular), Some(-40.0));
        assert_eq!(at(&bold), Some(-80.0));
        assert_eq!(at(&SourceId::from_raw("light")), None);
    }

    #[test]
    fn joining_a_group_leaves_the_previous_group_at_that_position() {
        let (mut kerning, _) = sample();

        let moved = kerning.set_group(KerningPosition::First, "O", vec![glyph("Aacute")]);

        assert_eq!(moved, vec![glyph("Aacute")]);
        assert_eq!(
            kerning.group(KerningPosition::First, "A"),
            Some([glyph("A")].as_slice())
        );
        assert_eq!(
            kerning.group_of(KerningPosition::First, &glyph("Aacute")),
            Some("O")
        );
        assert_eq!(
            kerning.group_of(KerningPosition::Second, &glyph("V")),
            Some("V")
        );
    }

    #[test]
    fn removing_the_last_value_drops_the_source() {
        let (mut kerning, source_id) = sample();

        let removed = kerning.remove_value(&source_id, &KerningPair::groups("A", "V"));

        assert_eq!(removed, Some(-40.0));
        assert!(kerning.source(&source_id).is_none());
    }

    #[test]
    fn json_round_trip_preserves_pairs() {
        let (kerning, _) = sample();

        let json = serde_json::to_string(&kerning).unwrap();
        let decoded: Kerning = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, kerning);
    }
}
