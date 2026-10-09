use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::orchestration::{Access, AccessBuilder, Work};
use fontdrasil::types::{Axes, GlyphName};
use fontir::error::Error;
use fontir::ir::{GlyphOrder, KernGroup, KernSide, KerningGroups, KerningInstance};
use fontir::orchestration::{Context, WorkId};
use ordered_float::OrderedFloat;
use shift_font::{GlyphId, Kerning, KerningPosition, KerningSide, SourceKerning};

use super::axes::normalized_source_location;
use super::source::ShiftSnapshot;

/// Emits kerning groups for glyphs in the compiled order, and the master
/// locations that author kerning.
///
/// Missing glyph members are omitted, and groups left empty after filtering are
/// not emitted. The default location always has kerning, so masters without
/// pairs still resolve against it.
#[derive(Debug)]
pub(super) struct KerningGroupWork {
    snapshot: Arc<ShiftSnapshot>,
}

impl KerningGroupWork {
    pub fn new(snapshot: Arc<ShiftSnapshot>) -> Self {
        Self { snapshot }
    }
}

impl Work<Context, WorkId, Error> for KerningGroupWork {
    fn id(&self) -> WorkId {
        WorkId::KerningGroups
    }

    fn read_access(&self) -> Access<WorkId> {
        AccessBuilder::new()
            .variant(WorkId::GlyphOrder)
            .variant(WorkId::StaticMetadata)
            .build()
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        let glyph_order = context.glyph_order.get();
        let glyph_names = compiled_glyph_names(&self.snapshot, &glyph_order);
        let mut groups = BTreeMap::new();

        for position in [KerningPosition::First, KerningPosition::Second] {
            for (_, group) in self.snapshot.kerning.groups(position) {
                let members = group
                    .members
                    .iter()
                    .filter_map(|member| glyph_names.get(member).cloned())
                    .collect::<BTreeSet<_>>();
                if !members.is_empty() {
                    groups.insert(kern_group(position, &group.name), members);
                }
            }
        }

        let old_to_new_group_names = groups
            .keys()
            .cloned()
            .map(|group| (group.clone(), group))
            .collect();
        let metadata = context.static_metadata.get();
        let mut locations = BTreeSet::from([metadata.default_location().clone()]);
        for (source, _) in master_kerning(&self.snapshot, &metadata.all_source_axes)? {
            locations.insert(source);
        }
        context.kerning_groups.set(KerningGroups {
            groups,
            locations,
            old_to_new_group_names,
        });
        Ok(())
    }
}

/// Emits the kerning pairs authored by the master at one normalized location.
#[derive(Debug)]
pub(super) struct KerningInstanceWork {
    snapshot: Arc<ShiftSnapshot>,
    location: NormalizedLocation,
}

impl KerningInstanceWork {
    pub fn new(snapshot: Arc<ShiftSnapshot>, location: NormalizedLocation) -> Self {
        Self { snapshot, location }
    }
}

impl Work<Context, WorkId, Error> for KerningInstanceWork {
    fn id(&self) -> WorkId {
        WorkId::KernInstance(self.location.clone())
    }

    fn read_access(&self) -> Access<WorkId> {
        AccessBuilder::new()
            .variant(WorkId::GlyphOrder)
            .variant(WorkId::KerningGroups)
            .variant(WorkId::StaticMetadata)
            .build()
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        let glyph_order = context.glyph_order.get();
        let glyph_names = compiled_glyph_names(&self.snapshot, &glyph_order);
        let groups = context.kerning_groups.get();
        let metadata = context.static_metadata.get();
        let pairs = master_kerning(&self.snapshot, &metadata.all_source_axes)?
            .into_iter()
            .find(|(location, _)| *location == self.location)
            .map(|(_, pairs)| pairs);

        let kerning = &self.snapshot.kerning;
        let mut kerns = BTreeMap::new();
        for (pair, value) in pairs.iter().flat_map(|pairs| pairs.pairs()) {
            let (Some(first), Some(second)) = (
                resolve_side(
                    kerning,
                    &pair.first,
                    KerningPosition::First,
                    &glyph_names,
                    &groups,
                ),
                resolve_side(
                    kerning,
                    &pair.second,
                    KerningPosition::Second,
                    &glyph_names,
                    &groups,
                ),
            ) else {
                continue;
            };
            kerns.insert((first, second), OrderedFloat(value));
        }

        context.kerning_at.set(KerningInstance {
            location: self.location.clone(),
            kerns,
        });
        Ok(())
    }
}

/// Returns the normalized location and pairs of every master with kerning.
fn master_kerning<'a>(
    snapshot: &'a ShiftSnapshot,
    axes: &Axes,
) -> Result<Vec<(NormalizedLocation, &'a SourceKerning)>, Error> {
    snapshot
        .sources
        .iter()
        .filter(|source| source.is_master())
        .filter_map(|source| {
            let pairs = snapshot.kerning.source(&source.id())?;
            Some(
                normalized_source_location(source, &snapshot.axes, axes)
                    .map(|location| (location, pairs)),
            )
        })
        .collect()
}

/// Maps each glyph id in the compiled order to its compiled name.
fn compiled_glyph_names(
    snapshot: &ShiftSnapshot,
    glyph_order: &GlyphOrder,
) -> HashMap<GlyphId, GlyphName> {
    snapshot
        .glyphs
        .iter()
        .filter(|glyph| glyph_order.contains(glyph.name()))
        .map(|glyph| (glyph.id(), glyph.name().into()))
        .collect()
}

fn kern_group(position: KerningPosition, name: &str) -> KernGroup {
    match position {
        KerningPosition::First => KernGroup::Side1(name.into()),
        KerningPosition::Second => KernGroup::Side2(name.into()),
    }
}

/// Resolves one kerning side against the compiled glyphs and groups.
///
/// Returns `None` for a side naming a glyph outside the compiled order, a
/// group not in the font or at the other position, or a group that was not
/// emitted, so the pair is skipped as fontc does for Glyphs and UFO sources.
/// Groups disappear when none of their members are compiled.
fn resolve_side(
    kerning: &Kerning,
    side: &KerningSide,
    position: KerningPosition,
    glyph_names: &HashMap<GlyphId, GlyphName>,
    groups: &KerningGroups,
) -> Option<KernSide> {
    match side {
        KerningSide::Glyph(glyph_id) => glyph_names.get(glyph_id).cloned().map(KernSide::Glyph),
        KerningSide::Group(group_id) => {
            let group = kerning
                .group(group_id)
                .filter(|group| group.position == position)?;
            let group = kern_group(position, &group.name);
            groups
                .groups
                .contains_key(&group)
                .then_some(KernSide::Group(group))
        }
    }
}
