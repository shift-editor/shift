use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::orchestration::{Access, AccessBuilder, Work};
use fontir::error::Error;
use fontir::ir::{KernGroup, KernSide, KerningGroups, KerningInstance};
use fontir::orchestration::{Context, WorkId};
use ordered_float::OrderedFloat;
use shift_font::KerningSide;

use super::source::ShiftSnapshot;

const SIDE1_PREFIX: &str = "public.kern1.";
const SIDE2_PREFIX: &str = "public.kern2.";

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
        let mut groups = BTreeMap::new();

        for (name, members) in self.snapshot.kerning.groups1() {
            let group = KernGroup::Side1(bare_group_name(name).into());
            let members = members
                .iter()
                .filter(|member| glyph_order.contains(member.as_str()))
                .map(|member| member.as_str().into())
                .collect::<BTreeSet<_>>();
            if !members.is_empty() {
                groups.insert(group, members);
            }
        }

        for (name, members) in self.snapshot.kerning.groups2() {
            let group = KernGroup::Side2(bare_group_name(name).into());
            let members = members
                .iter()
                .filter(|member| glyph_order.contains(member.as_str()))
                .map(|member| member.as_str().into())
                .collect::<BTreeSet<_>>();
            if !members.is_empty() {
                groups.insert(group, members);
            }
        }

        let old_to_new_group_names = groups
            .keys()
            .cloned()
            .map(|group| (group.clone(), group))
            .collect();
        let location = context.static_metadata.get().default_location().clone();
        context.kerning_groups.set(KerningGroups {
            groups,
            locations: BTreeSet::from([location]),
            old_to_new_group_names,
        });
        Ok(())
    }
}

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
            .build()
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        if !self.location.is_default() {
            return Err(Error::InvalidEntry(
                "Shift kerning location",
                format!("expected the default location, got {:?}", self.location),
            ));
        }

        let glyph_order = context.glyph_order.get();
        let groups = context.kerning_groups.get();
        let mut kerns = BTreeMap::new();
        for pair in self.snapshot.kerning.pairs() {
            let first = resolve_side(&pair.first, true, &glyph_order, &groups)?;
            let second = resolve_side(&pair.second, false, &glyph_order, &groups)?;
            kerns.insert((first, second), OrderedFloat(pair.value));
        }

        context.kerning_at.set(KerningInstance {
            location: self.location.clone(),
            kerns,
        });
        Ok(())
    }
}

fn resolve_side(
    side: &KerningSide,
    first: bool,
    glyph_order: &fontir::ir::GlyphOrder,
    groups: &KerningGroups,
) -> Result<KernSide, Error> {
    match side {
        KerningSide::Glyph(name) if glyph_order.contains(name.as_str()) => {
            Ok(KernSide::Glyph(name.as_str().into()))
        }
        KerningSide::Glyph(name) => Err(Error::InvalidEntry(
            "Shift kerning pair",
            format!("references missing glyph '{}'", name.as_str()),
        )),
        KerningSide::Group(name) => {
            let group = if first {
                KernGroup::Side1(bare_group_name(name).into())
            } else {
                KernGroup::Side2(bare_group_name(name).into())
            };
            if !groups.groups.contains_key(&group) {
                return Err(Error::InvalidEntry(
                    "Shift kerning pair",
                    format!("references missing group '{name}'"),
                ));
            }
            Ok(KernSide::Group(group))
        }
    }
}

fn bare_group_name(name: &str) -> &str {
    name.strip_prefix(SIDE1_PREFIX)
        .or_else(|| name.strip_prefix(SIDE2_PREFIX))
        .unwrap_or(name)
}
