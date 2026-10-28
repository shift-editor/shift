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

use crate::persistent::{PersistentMultiMap, PersistentOrdMap};
use crate::{CoreError, CoreResult, GlyphId, KerningGroupId, Require, SourceId};
use serde::{Deserialize, Serialize};

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
    values: PersistentOrdMap<KerningPair, f64>,
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

    /// Returns the first of `candidates` this source authors, with its value.
    pub(crate) fn first_authored(&self, candidates: &[KerningPair]) -> Option<ResolvedKerning> {
        candidates.iter().find_map(|pair| {
            self.value(pair).map(|value| ResolvedKerning {
                pair: pair.clone(),
                value,
            })
        })
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

/// Kerning groups by id, and the groups each glyph belongs to.
///
/// Equality and serialization see only the groups; the member index is
/// derived from them. A glyph belongs to one group per position, except while
/// a recorded change replays one group before another.
#[derive(Clone, Debug, Default)]
struct KerningGroups {
    groups: PersistentOrdMap<KerningGroupId, KerningGroup>,
    members: PersistentMultiMap<(KerningPosition, GlyphId), KerningGroupId>,
}

impl KerningGroups {
    fn get(&self, group_id: KerningGroupId) -> Option<&KerningGroup> {
        self.groups.get(&group_id)
    }

    fn iter(&self) -> impl Iterator<Item = (&KerningGroupId, &KerningGroup)> {
        self.groups.iter()
    }

    fn ids(&self) -> impl Iterator<Item = &KerningGroupId> {
        self.groups.keys()
    }

    fn contains(&self, group_id: KerningGroupId) -> bool {
        self.groups.contains_key(&group_id)
    }

    fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    /// The group `glyph_id` belongs to at `position`; the first by id if a
    /// replay left it in several.
    fn group_of(&self, position: KerningPosition, glyph_id: GlyphId) -> Option<&KerningGroupId> {
        self.members.get(&(position, glyph_id)).min()
    }

    /// Inserts `group` as `group_id`, returning the group it replaced.
    fn insert(&mut self, group_id: KerningGroupId, group: KerningGroup) -> Option<KerningGroup> {
        let replaced = self.remove(group_id);
        for member in &group.members {
            self.members.insert((group.position, *member), group_id);
        }
        self.groups.insert(group_id, group);
        replaced
    }

    fn remove(&mut self, group_id: KerningGroupId) -> Option<KerningGroup> {
        let group = self.groups.remove(&group_id)?;
        for member in &group.members {
            self.members.remove(&(group.position, *member), &group_id);
        }
        Some(group)
    }

    /// Takes `glyph_id` out of `group_id`, leaving the group's other members
    /// filed where they are.
    fn remove_member(&mut self, group_id: KerningGroupId, glyph_id: GlyphId) {
        let Some(group) = self.groups.get_mut(&group_id) else {
            return;
        };
        group.members.retain(|member| *member != glyph_id);
        self.members.remove(&(group.position, glyph_id), &group_id);
    }

    fn rename(&mut self, group_id: KerningGroupId, name: String) -> CoreResult<()> {
        self.groups.get_mut(&group_id).require(&group_id)?.name = name;
        Ok(())
    }
}

impl PartialEq for KerningGroups {
    fn eq(&self, other: &Self) -> bool {
        self.groups == other.groups
    }
}

impl FromIterator<(KerningGroupId, KerningGroup)> for KerningGroups {
    fn from_iter<I: IntoIterator<Item = (KerningGroupId, KerningGroup)>>(groups: I) -> Self {
        let mut collected = Self::default();
        for (group_id, group) in groups {
            collected.insert(group_id, group);
        }
        collected
    }
}

impl Serialize for KerningGroups {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.groups.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for KerningGroups {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let groups = PersistentOrdMap::<KerningGroupId, KerningGroup>::deserialize(deserializer)?;
        Ok(groups.into_iter().collect())
    }
}

/// Font-wide kerning groups and the pair values of every source.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Kerning {
    // Persistent maps, so copying a font to edit one value shares the rest.
    groups: KerningGroups,
    sources: PersistentOrdMap<SourceId, SourceKerning>,
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

    pub fn group(&self, group_id: KerningGroupId) -> Option<&KerningGroup> {
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
        glyph_id: GlyphId,
    ) -> Option<&KerningGroupId> {
        self.groups.group_of(position, glyph_id)
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
        self.ensure_name_available(group_id, group.position, &group.name)?;

        let mut unique = Vec::with_capacity(group.members.len());
        for member in group.members {
            if !unique.contains(&member) {
                unique.push(member);
            }
        }
        group.members = unique;

        let mut moved = Vec::new();
        for member in &group.members {
            let Some(other_id) = self.groups.group_of(group.position, *member).copied() else {
                continue;
            };
            if other_id != group_id {
                self.groups.remove_member(other_id, *member);
                moved.push(*member);
            }
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
        group_id: KerningGroupId,
        name: impl Into<String>,
    ) -> CoreResult<()> {
        let name = name.into();
        let position = self.groups.get(group_id).require(&group_id)?.position;
        self.ensure_name_available(group_id, position, &name)?;
        self.groups.rename(group_id, name)
    }

    /// Returns every group at either position, ordered by id.
    pub fn all_groups(&self) -> impl Iterator<Item = (&KerningGroupId, &KerningGroup)> {
        self.groups.iter()
    }

    /// Returns each group that differs between `self` and `after`, by id,
    /// with its value in each (`None` where it does not exist).
    ///
    /// Groups in `self` come first, then groups only `after` has, each in id
    /// order.
    pub fn changed_groups<'a>(
        &'a self,
        after: &'a Self,
    ) -> impl Iterator<
        Item = (
            &'a KerningGroupId,
            Option<&'a KerningGroup>,
            Option<&'a KerningGroup>,
        ),
    > {
        let added = after
            .groups
            .ids()
            .filter(|group_id| !self.groups.contains(**group_id));
        self.groups
            .ids()
            .chain(added)
            .map(|group_id| (group_id, self.group(*group_id), after.group(*group_id)))
            .filter(|(_, before, after)| before != after)
    }

    /// Installs `group` as `group_id` exactly as given, or removes it with
    /// `None`, without moving members out of other groups.
    ///
    /// For replaying a recorded change, whose other changed groups are
    /// installed alongside it.
    pub(crate) fn put_group(&mut self, group_id: KerningGroupId, group: Option<KerningGroup>) {
        match group {
            Some(group) => {
                self.groups.insert(group_id, group);
            }
            None => {
                self.groups.remove(group_id);
            }
        }
    }

    /// Removes the group `group_id` and returns it.
    ///
    /// Pairs that reference the group are kept and resolve again if the group
    /// is restored with the same id.
    pub fn remove_group(&mut self, group_id: KerningGroupId) -> Option<KerningGroup> {
        self.groups.remove(group_id)
    }

    /// Returns the pair values authored for `source_id`.
    pub fn source(&self, source_id: SourceId) -> Option<&SourceKerning> {
        self.sources.get(&source_id)
    }

    /// Returns every source with authored pairs, ordered by source id.
    pub fn sources(&self) -> impl Iterator<Item = (&SourceId, &SourceKerning)> {
        self.sources.iter()
    }

    /// Returns the value of `pair` authored at `source_id`.
    pub fn value(&self, source_id: SourceId, pair: &KerningPair) -> Option<f64> {
        self.source(source_id)?.value(pair)
    }

    /// Sets the value of `pair` at `source_id` and returns the previous value.
    pub fn set_value(&mut self, source_id: SourceId, pair: KerningPair, value: f64) -> Option<f64> {
        self.sources
            .get_or_default(source_id)
            .values
            .insert(pair, value)
    }

    /// Removes the value of `pair` at `source_id` and returns it.
    ///
    /// A source left with no pairs is dropped.
    pub fn remove_value(&mut self, source_id: SourceId, pair: &KerningPair) -> Option<f64> {
        let source = self.sources.get_mut(&source_id)?;
        let removed = source.values.remove(pair);
        if source.is_empty() {
            self.sources.remove(&source_id);
        }
        removed
    }

    /// Resolves the kerning between `first` followed by `second` at
    /// `source_id`.
    ///
    /// The most specific authored pair wins, in the order of
    /// [`Self::candidates`]. Returns `None` when no pair applies, which means
    /// no adjustment at this source.
    pub fn resolve(
        &self,
        source_id: SourceId,
        first: GlyphId,
        second: GlyphId,
    ) -> Option<ResolvedKerning> {
        let source = self.source(source_id)?;
        let candidates = self.candidates(first, second);
        source.first_authored(&candidates)
    }

    /// Returns the pair an edit to the kerning between `first` followed by
    /// `second` at `source_id` changes: the one that applies there, or else
    /// the most general one their groups allow, at zero.
    pub fn editable_pair(
        &self,
        source_id: SourceId,
        first: GlyphId,
        second: GlyphId,
    ) -> ResolvedKerning {
        let mut candidates = self.candidates(first, second);
        if let Some(resolved) = self
            .source(source_id)
            .and_then(|source| source.first_authored(&candidates))
        {
            return resolved;
        }
        let pair = candidates
            .pop()
            .unwrap_or_else(|| KerningPair::glyphs(first, second));
        ResolvedKerning { pair, value: 0.0 }
    }

    /// Returns the pairs authored at `source_id` that name `glyph_id` on a
    /// side, directly or through its group at that side, each with its value,
    /// ordered by pair.
    ///
    /// A group side names the glyph only when it is the glyph's group at the
    /// position it occupies: its `First` group as the pair's first side, its
    /// `Second` group as the second. Empty for a source without pairs.
    pub fn pairs_naming(
        &self,
        source_id: SourceId,
        glyph_id: GlyphId,
    ) -> impl Iterator<Item = ResolvedKerning> + '_ {
        let first_group = self.group_of(KerningPosition::First, glyph_id).copied();
        let second_group = self.group_of(KerningPosition::Second, glyph_id).copied();
        let names_glyph = move |side: &KerningSide, group: Option<KerningGroupId>| match side {
            KerningSide::Glyph(side_glyph) => *side_glyph == glyph_id,
            KerningSide::Group(group_id) => group == Some(*group_id),
        };
        self.source(source_id)
            .into_iter()
            .flat_map(SourceKerning::pairs)
            .filter(move |(pair, _)| {
                names_glyph(&pair.first, first_group) || names_glyph(&pair.second, second_group)
            })
            .map(|(pair, value)| ResolvedKerning {
                pair: pair.clone(),
                value,
            })
    }

    /// Returns the pairs that could supply the kerning between `first`
    /// followed by `second`, most specific first, in UFO order: glyph and
    /// glyph, then glyph and the second's group, then the first's group and
    /// glyph, then group and group. Groups the glyphs are not in are left out.
    pub fn candidates(&self, first: GlyphId, second: GlyphId) -> Vec<KerningPair> {
        let first_glyph = KerningSide::Glyph(first);
        let second_glyph = KerningSide::Glyph(second);
        let first_group = self
            .group_of(KerningPosition::First, first)
            .map(|group_id| KerningSide::Group(*group_id));
        let second_group = self
            .group_of(KerningPosition::Second, second)
            .map(|group_id| KerningSide::Group(*group_id));

        let mut candidates = Vec::with_capacity(4);
        candidates.push(KerningPair::new(first_glyph.clone(), second_glyph.clone()));
        if let Some(group) = &second_group {
            candidates.push(KerningPair::new(first_glyph, group.clone()));
        }
        if let Some(group) = &first_group {
            candidates.push(KerningPair::new(group.clone(), second_glyph));
        }
        if let (Some(first), Some(second)) = (first_group, second_group) {
            candidates.push(KerningPair::new(first, second));
        }
        candidates
    }

    /// Returns `true` when the font has no groups and no pair values.
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty() && self.sources.is_empty()
    }

    fn ensure_name_available(
        &self,
        group_id: KerningGroupId,
        position: KerningPosition,
        name: &str,
    ) -> CoreResult<()> {
        match self.group_id(position, name) {
            Some(existing) if *existing != group_id => Err(CoreError::DuplicateKerningGroupName {
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

    /// Asserts each glyph's group comes out of the member index as a scan of
    /// every group, first by id, would find it.
    fn assert_members_match_scan(kerning: &Kerning, glyphs: &[GlyphId]) {
        for position in [KerningPosition::First, KerningPosition::Second] {
            for glyph_id in glyphs {
                let scanned = kerning
                    .groups(position)
                    .find(|(_, group)| group.members.contains(glyph_id))
                    .map(|(group_id, _)| group_id);
                assert_eq!(kerning.group_of(position, *glyph_id), scanned, "{glyph_id}");
            }
        }
    }

    #[test]
    fn member_index_answers_as_a_scan_of_every_group() {
        let glyphs = ["a", "b", "c", "d"].map(glyph);
        let [a, b, c, d] = glyphs;
        let left = KerningGroupId::from_raw("left");
        let right = KerningGroupId::from_raw("right");
        let mut kerning = Kerning::new();
        let first = |name: &str, members: Vec<GlyphId>| {
            KerningGroup::new(KerningPosition::First, name, members)
        };

        kerning.set_group(left, first("left", vec![a, b])).unwrap();
        let moved = kerning
            .set_group(right, first("right", vec![b, c]))
            .unwrap();
        assert_eq!(moved, [b]);
        assert_members_match_scan(&kerning, &glyphs);

        // A replayed change can leave a glyph in two groups for a moment.
        kerning.put_group(left, Some(first("left", vec![a, c])));
        assert_members_match_scan(&kerning, &glyphs);

        kerning.remove_group(left);
        assert_members_match_scan(&kerning, &glyphs);

        kerning.set_group(left, first("left", vec![d])).unwrap();
        let reloaded: Kerning =
            serde_json::from_str(&serde_json::to_string(&kerning).unwrap()).unwrap();
        assert_eq!(reloaded, kerning);
        assert_members_match_scan(&reloaded, &glyphs);
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
            source_id,
            KerningPair::groups(group_id("A"), group_id("V")),
            -40.0,
        );
        (kerning, source_id)
    }

    #[test]
    fn group_pairs_resolve_for_every_member() {
        let (kerning, source_id) = sample();

        let resolved = kerning
            .resolve(source_id, glyph("Aacute"), glyph("W"))
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
        kerning.set_value(source_id, second_exception, -30.0);
        kerning.set_value(source_id, first_exception, -20.0);
        kerning.set_value(
            source_id,
            KerningPair::glyphs(glyph("A"), glyph("V")),
            -10.0,
        );

        let value = |first: &str, second: &str| {
            kerning
                .resolve(source_id, glyph(first), glyph(second))
                .map(|resolved| resolved.value)
        };
        assert_eq!(value("A", "V"), Some(-10.0));
        assert_eq!(value("A", "W"), Some(-20.0));
        assert_eq!(value("Aacute", "V"), Some(-30.0));
        assert_eq!(value("Aacute", "W"), Some(-40.0));
        assert_eq!(value("V", "A"), None);
    }

    #[test]
    fn pairs_naming_a_glyph_include_its_groups_only_at_their_side() {
        let (mut kerning, source_id) = sample();
        let names_aacute = KerningPair::glyphs(glyph("T"), glyph("Aacute"));
        let names_a = KerningPair::new(
            KerningSide::Glyph(glyph("A")),
            KerningSide::Group(group_id("V")),
        );
        let first_group_at_second_side = KerningPair::new(
            KerningSide::Glyph(glyph("T")),
            KerningSide::Group(group_id("A")),
        );
        kerning.set_value(source_id, names_aacute.clone(), -15.0);
        kerning.set_value(source_id, names_a, -20.0);
        kerning.set_value(source_id, first_group_at_second_side, -5.0);

        let naming = kerning
            .pairs_naming(source_id, glyph("Aacute"))
            .collect::<Vec<_>>();

        assert_eq!(
            naming,
            [
                ResolvedKerning {
                    pair: names_aacute,
                    value: -15.0
                },
                ResolvedKerning {
                    pair: KerningPair::groups(group_id("A"), group_id("V")),
                    value: -40.0
                },
            ]
        );
        let bold = SourceId::from_raw("bold");
        assert_eq!(kerning.pairs_naming(bold, glyph("Aacute")).count(), 0);
    }

    #[test]
    fn an_edit_changes_the_pair_that_applies() {
        let (mut kerning, source_id) = sample();
        let exception = KerningPair::new(
            KerningSide::Glyph(glyph("A")),
            KerningSide::Group(group_id("V")),
        );
        kerning.set_value(source_id, exception.clone(), -20.0);

        let edited = kerning.editable_pair(source_id, glyph("A"), glyph("W"));

        assert_eq!(
            edited,
            ResolvedKerning {
                pair: exception,
                value: -20.0
            }
        );
    }

    #[test]
    fn an_edit_where_no_pair_applies_changes_the_most_general_pair_at_zero() {
        let (kerning, _) = sample();
        let bold = SourceId::from_raw("bold");

        let grouped = kerning.editable_pair(bold, glyph("A"), glyph("V"));
        let ungrouped = kerning.editable_pair(bold, glyph("A"), glyph("T"));

        assert_eq!(
            grouped.pair,
            KerningPair::groups(group_id("A"), group_id("V"))
        );
        assert_eq!(grouped.value, 0.0);
        assert_eq!(
            ungrouped.pair,
            KerningPair::new(
                KerningSide::Group(group_id("A")),
                KerningSide::Glyph(glyph("T"))
            )
        );
    }

    #[test]
    fn values_are_independent_per_source() {
        let (mut kerning, regular) = sample();
        let bold = SourceId::from_raw("bold");
        kerning.set_value(
            bold,
            KerningPair::groups(group_id("A"), group_id("V")),
            -80.0,
        );

        let at = |source_id: &SourceId| {
            kerning
                .resolve(*source_id, glyph("A"), glyph("V"))
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
            kerning.group(group_id("A")).unwrap().members,
            vec![glyph("A")]
        );
        assert_eq!(
            kerning.group_of(KerningPosition::First, glyph("Aacute")),
            Some(&group_id("O"))
        );
        assert_eq!(
            kerning.group_of(KerningPosition::Second, glyph("V")),
            Some(&group_id("V"))
        );
    }

    #[test]
    fn changed_groups_lists_each_added_edited_and_removed_group_once() {
        let (before, _) = sample();
        let mut after = before.clone();
        after.remove_group(group_id("V"));
        after
            .rename_group(group_id("A"), "A_round")
            .expect("name is free");
        after
            .set_group(
                group_id("O"),
                KerningGroup::new(KerningPosition::First, "O", Vec::new()),
            )
            .expect("name is free");

        let changed = before
            .changed_groups(&after)
            .map(|(id, original, replacement)| {
                (
                    *id,
                    original.map(|group| group.name.clone()),
                    replacement.map(|group| group.name.clone()),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            changed,
            vec![
                (group_id("A"), Some("A".into()), Some("A_round".into())),
                (group_id("V"), Some("V".into()), None),
                (group_id("O"), None, Some("O".into())),
            ]
        );
    }

    #[test]
    fn renaming_a_group_keeps_its_pairs() {
        let (mut kerning, source_id) = sample();

        kerning.rename_group(group_id("A"), "A_round").unwrap();

        assert_eq!(kerning.group(group_id("A")).unwrap().name, "A_round");
        assert_eq!(
            kerning.group_id(KerningPosition::First, "A_round"),
            Some(&group_id("A"))
        );
        assert_eq!(
            kerning
                .resolve(source_id, glyph("Aacute"), glyph("W"))
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
        let duplicate_rename = kerning.rename_group(group_id("A"), "A");
        let other_position = kerning.rename_group(group_id("V"), "A");
        let missing = kerning.rename_group(group_id("missing"), "X");

        assert!(matches!(
            duplicate,
            Err(CoreError::DuplicateKerningGroupName {
                position: KerningPosition::First,
                ..
            })
        ));
        assert!(kerning.group(group_id("other")).is_none());
        duplicate_rename.unwrap();
        other_position.unwrap();
        assert!(matches!(missing, Err(CoreError::KerningGroupNotFound(_))));
    }

    #[test]
    fn a_new_group_with_a_removed_groups_name_does_not_inherit_its_pairs() {
        let (mut kerning, source_id) = sample();

        let removed = kerning.remove_group(group_id("A")).unwrap();
        kerning
            .set_group(
                group_id("A2"),
                KerningGroup::new(KerningPosition::First, "A", vec![glyph("A")]),
            )
            .unwrap();
        let after_recreate = kerning.resolve(source_id, glyph("A"), glyph("V"));
        kerning.remove_group(group_id("A2"));
        kerning.set_group(group_id("A"), removed).unwrap();

        assert_eq!(after_recreate, None);
        assert_eq!(
            kerning
                .resolve(source_id, glyph("A"), glyph("V"))
                .map(|resolved| resolved.value),
            Some(-40.0)
        );
    }

    #[test]
    fn removing_the_last_value_drops_the_source() {
        let (mut kerning, source_id) = sample();

        let removed = kerning.remove_value(
            source_id,
            &KerningPair::groups(group_id("A"), group_id("V")),
        );

        assert_eq!(removed, Some(-40.0));
        assert!(kerning.source(source_id).is_none());
    }

    #[test]
    fn json_round_trip_preserves_groups_and_pairs() {
        let (kerning, _) = sample();

        let json = serde_json::to_string(&kerning).unwrap();
        let decoded: Kerning = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, kerning);
    }
}
