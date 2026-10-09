//! Kerning groups and per-source kerning values.
//!
//! Groups are font-wide and identified by [`KerningGroupId`]: a glyph belongs
//! to at most one group for each pair position, and a group's name is unique
//! among the groups at its position. Pair values are authored per source, and
//! a pair absent from a source has no value there. Pairs reference glyphs by
//! [`GlyphId`] and groups by id, so renaming either keeps its kerning.
//! References to glyphs, groups, or sources that are not in the font are
//! retained but never resolve, so deleting and restoring one keeps its
//! kerning intact.

use crate::{CoreError, CoreResult, GlyphId, KerningGroupId, Require, SourceId};
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

/// A named set of glyphs that kern alike at one pair position.
///
/// The name carries no format prefix; the position selects UFO's
/// `public.kern1.` or `public.kern2.` on export.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KerningGroup {
    pub position: KerningPosition,
    pub name: String,
    /// Members in authored order.
    pub members: Vec<GlyphId>,
}

impl KerningGroup {
    pub fn new(position: KerningPosition, name: impl Into<String>, members: Vec<GlyphId>) -> Self {
        Self {
            position,
            name: name.into(),
            members,
        }
    }
}

/// One side of a kerning pair: a single glyph or a group.
///
/// A group side only resolves when the group's position matches the side it
/// occupies in the pair.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum KerningSide {
    Glyph(GlyphId),
    Group(KerningGroupId),
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

    pub fn groups(first: KerningGroupId, second: KerningGroupId) -> Self {
        Self::new(KerningSide::Group(first), KerningSide::Group(second))
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
    groups: BTreeMap<KerningGroupId, KerningGroup>,
    sources: BTreeMap<SourceId, SourceKerning>,
}

impl Kerning {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the groups at `position`, ordered by id.
    pub fn groups(
        &self,
        position: KerningPosition,
    ) -> impl Iterator<Item = (&KerningGroupId, &KerningGroup)> {
        self.groups
            .iter()
            .filter(move |(_, group)| group.position == position)
    }

    pub fn group(&self, group_id: &KerningGroupId) -> Option<&KerningGroup> {
        self.groups.get(group_id)
    }

    /// Returns the id of the group named `name` at `position`.
    pub fn group_id(&self, position: KerningPosition, name: &str) -> Option<&KerningGroupId> {
        self.groups(position)
            .find(|(_, group)| group.name == name)
            .map(|(group_id, _)| group_id)
    }

    /// Returns the id of the group `glyph_id` belongs to at `position`.
    pub fn group_of(
        &self,
        position: KerningPosition,
        glyph_id: &GlyphId,
    ) -> Option<&KerningGroupId> {
        self.groups(position)
            .find(|(_, group)| group.members.contains(glyph_id))
            .map(|(group_id, _)| group_id)
    }

    /// Inserts `group` as `group_id`, replacing any group with that id.
    ///
    /// Membership is exclusive per position: each member is removed from any
    /// other group at the group's position, and a member repeated in
    /// `group.members` is kept once at its first occurrence. A group with no
    /// members still exists. Returns the members that moved out of another
    /// group.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::DuplicateKerningGroupName`] when another group at
    /// the same position already has `group.name`; the kerning is unchanged.
    pub fn set_group(
        &mut self,
        group_id: KerningGroupId,
        mut group: KerningGroup,
    ) -> CoreResult<Vec<GlyphId>> {
        self.ensure_name_available(&group_id, group.position, &group.name)?;

        let mut unique = Vec::with_capacity(group.members.len());
        for member in group.members {
            if !unique.contains(&member) {
                unique.push(member);
            }
        }
        group.members = unique;

        let mut moved = Vec::new();
        for (other_id, other) in &mut self.groups {
            if *other_id == group_id || other.position != group.position {
                continue;
            }
            other.members.retain(|member| {
                let claimed = group.members.contains(member);
                if claimed {
                    moved.push(member.clone());
                }
                !claimed
            });
        }
        self.groups.insert(group_id, group);
        Ok(moved)
    }

    /// Renames the group `group_id`. Pairs reference the group by id, so its
    /// kerning is unchanged.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::KerningGroupNotFound`] when no group has
    /// `group_id`, and [`CoreError::DuplicateKerningGroupName`] when another
    /// group at the same position already has `name`.
    pub fn rename_group(
        &mut self,
        group_id: &KerningGroupId,
        name: impl Into<String>,
    ) -> CoreResult<()> {
        let name = name.into();
        let position = self.groups.get(group_id).require(group_id)?.position;
        self.ensure_name_available(group_id, position, &name)?;
        self.groups.get_mut(group_id).require(group_id)?.name = name;
        Ok(())
    }

    /// Removes the group `group_id` and returns it.
    ///
    /// Pairs that reference the group are kept and resolve again if the group
    /// is restored with the same id.
    pub fn remove_group(&mut self, group_id: &KerningGroupId) -> Option<KerningGroup> {
        self.groups.remove(group_id)
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
            .map(|group_id| KerningSide::Group(group_id.clone()));
        let second_group = self
            .group_of(KerningPosition::Second, second)
            .map(|group_id| KerningSide::Group(group_id.clone()));

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
        self.groups.is_empty() && self.sources.is_empty()
    }

    fn ensure_name_available(
        &self,
        group_id: &KerningGroupId,
        position: KerningPosition,
        name: &str,
    ) -> CoreResult<()> {
        match self.group_id(position, name) {
            Some(existing) if existing != group_id => Err(CoreError::DuplicateKerningGroupName {
                position,
                name: name.to_string(),
            }),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glyph(name: &str) -> GlyphId {
        GlyphId::from_raw(name)
    }

    fn group_id(name: &str) -> KerningGroupId {
        KerningGroupId::from_raw(name)
    }

    fn sample() -> (Kerning, SourceId) {
        let source_id = SourceId::from_raw("regular");
        let mut kerning = Kerning::new();
        kerning
            .set_group(
                group_id("A"),
                KerningGroup::new(
                    KerningPosition::First,
                    "A",
                    vec![glyph("A"), glyph("Aacute")],
                ),
            )
            .unwrap();
        kerning
            .set_group(
                group_id("V"),
                KerningGroup::new(KerningPosition::Second, "V", vec![glyph("V"), glyph("W")]),
            )
            .unwrap();
        kerning.set_value(
            source_id.clone(),
            KerningPair::groups(group_id("A"), group_id("V")),
            -40.0,
        );
        (kerning, source_id)
    }

    #[test]
    fn group_pairs_resolve_for_every_member() {
        let (kerning, source_id) = sample();

        let resolved = kerning
            .resolve(&source_id, &glyph("Aacute"), &glyph("W"))
            .unwrap();
        assert_eq!(resolved.value, -40.0);
        assert_eq!(
            resolved.pair,
            KerningPair::groups(group_id("A"), group_id("V"))
        );
    }

    #[test]
    fn the_most_specific_pair_wins_regardless_of_insertion_order() {
        let (mut kerning, source_id) = sample();
        let first_exception = KerningPair::new(
            KerningSide::Glyph(glyph("A")),
            KerningSide::Group(group_id("V")),
        );
        let second_exception = KerningPair::new(
            KerningSide::Group(group_id("A")),
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
        kerning.set_value(
            bold.clone(),
            KerningPair::groups(group_id("A"), group_id("V")),
            -80.0,
        );

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

        let moved = kerning
            .set_group(
                group_id("O"),
                KerningGroup::new(KerningPosition::First, "O", vec![glyph("Aacute")]),
            )
            .unwrap();

        assert_eq!(moved, vec![glyph("Aacute")]);
        assert_eq!(
            kerning.group(&group_id("A")).unwrap().members,
            vec![glyph("A")]
        );
        assert_eq!(
            kerning.group_of(KerningPosition::First, &glyph("Aacute")),
            Some(&group_id("O"))
        );
        assert_eq!(
            kerning.group_of(KerningPosition::Second, &glyph("V")),
            Some(&group_id("V"))
        );
    }

    #[test]
    fn renaming_a_group_keeps_its_pairs() {
        let (mut kerning, source_id) = sample();

        kerning.rename_group(&group_id("A"), "A_round").unwrap();

        assert_eq!(kerning.group(&group_id("A")).unwrap().name, "A_round");
        assert_eq!(
            kerning.group_id(KerningPosition::First, "A_round"),
            Some(&group_id("A"))
        );
        assert_eq!(
            kerning
                .resolve(&source_id, &glyph("Aacute"), &glyph("W"))
                .map(|resolved| resolved.value),
            Some(-40.0)
        );
    }

    #[test]
    fn group_names_are_unique_per_position() {
        let (mut kerning, _) = sample();

        let duplicate = kerning.set_group(
            group_id("other"),
            KerningGroup::new(KerningPosition::First, "A", vec![glyph("B")]),
        );
        let duplicate_rename = kerning.rename_group(&group_id("A"), "A");
        let other_position = kerning.rename_group(&group_id("V"), "A");
        let missing = kerning.rename_group(&group_id("missing"), "X");

        assert!(matches!(
            duplicate,
            Err(CoreError::DuplicateKerningGroupName {
                position: KerningPosition::First,
                ..
            })
        ));
        assert!(kerning.group(&group_id("other")).is_none());
        assert!(duplicate_rename.is_ok());
        assert!(other_position.is_ok());
        assert!(matches!(missing, Err(CoreError::KerningGroupNotFound(_))));
    }

    #[test]
    fn a_new_group_with_a_removed_groups_name_does_not_inherit_its_pairs() {
        let (mut kerning, source_id) = sample();

        let removed = kerning.remove_group(&group_id("A")).unwrap();
        kerning
            .set_group(
                group_id("A2"),
                KerningGroup::new(KerningPosition::First, "A", vec![glyph("A")]),
            )
            .unwrap();
        let after_recreate = kerning.resolve(&source_id, &glyph("A"), &glyph("V"));
        kerning.remove_group(&group_id("A2"));
        kerning.set_group(group_id("A"), removed).unwrap();

        assert_eq!(after_recreate, None);
        assert_eq!(
            kerning
                .resolve(&source_id, &glyph("A"), &glyph("V"))
                .map(|resolved| resolved.value),
            Some(-40.0)
        );
    }

    #[test]
    fn removing_the_last_value_drops_the_source() {
        let (mut kerning, source_id) = sample();

        let removed = kerning.remove_value(
            &source_id,
            &KerningPair::groups(group_id("A"), group_id("V")),
        );

        assert_eq!(removed, Some(-40.0));
        assert!(kerning.source(&source_id).is_none());
    }

    #[test]
    fn json_round_trip_preserves_groups_and_pairs() {
        let (kerning, _) = sample();

        let json = serde_json::to_string(&kerning).unwrap();
        let decoded: Kerning = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, kerning);
    }
}
