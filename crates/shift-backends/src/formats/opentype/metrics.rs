use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::tables::glyf::{CompositeGlyphFlags, Glyf, Glyph as GlyfGlyph};
use skrifa::raw::tables::gvar::Gvar;
use skrifa::raw::tables::loca::Loca;
use skrifa::raw::tables::variations::DeltaSetIndex;
use skrifa::raw::types::GlyphId;
use skrifa::raw::{ReadError, TableProvider};
use skrifa::{FontRef, MetadataProvider};

use crate::font_source::atlas::{AtlasRegion, RegionAxis, RegionRegistry, SourceAtlasError};
use crate::font_source::GlyphIndex;

use crate::font_source::malformed;

use super::inputs::tuple_region;

pub(super) struct AdvanceContributions {
    pub(super) base: f32,
    pub(super) deltas: BTreeMap<u32, f32>,
}

pub(super) fn advance_contributions(
    path: &Path,
    font: &FontRef<'_>,
    loca: Loca<'_>,
    glyf: Glyf<'_>,
    gvar: Option<Gvar<'_>>,
    registry: &mut RegionRegistry,
    glyphs: &[GlyphIndex],
) -> Result<Vec<AdvanceContributions>, SourceAtlasError> {
    let glyph_metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
    let mut advances = Vec::with_capacity(glyphs.len());
    match font.hvar() {
        Ok(hvar) => {
            for glyph in glyphs {
                let raw_glyph = GlyphId::new(glyph.to_u32());
                let base = glyph_metrics.advance_width(raw_glyph).ok_or_else(|| {
                    malformed(path, format!("missing advance width for glyph {raw_glyph}"))
                })?;
                advances.push(AdvanceContributions {
                    base,
                    deltas: hvar_contributions(path, &hvar, registry, raw_glyph)?,
                });
            }
        }
        Err(ReadError::TableIsMissing(_)) => {
            for glyph in glyphs {
                let raw_glyph = GlyphId::new(glyph.to_u32());
                let base = glyph_metrics.advance_width(raw_glyph).ok_or_else(|| {
                    malformed(path, format!("missing advance width for glyph {raw_glyph}"))
                })?;
                let contributions = match &gvar {
                    Some(gvar) => gvar_contributions(
                        path,
                        loca.clone(),
                        glyf.clone(),
                        gvar,
                        registry,
                        raw_glyph,
                    )?,
                    None => BTreeMap::new(),
                };
                advances.push(AdvanceContributions {
                    base,
                    deltas: contributions,
                });
            }
        }
        Err(error) => {
            return Err(malformed(path, format!("failed to read HVAR table: {error}")).into())
        }
    }
    Ok(advances)
}

fn hvar_contributions(
    path: &Path,
    hvar: &skrifa::raw::tables::hvar::Hvar<'_>,
    registry: &mut RegionRegistry,
    glyph: GlyphId,
) -> Result<BTreeMap<u32, f32>, SourceAtlasError> {
    let index = match hvar.advance_width_mapping() {
        Some(mapping) => mapping
            .map_err(|error| {
                malformed(
                    path,
                    format!("failed to read HVAR advance mapping: {error}"),
                )
            })?
            .get(glyph.to_u32())
            .map_err(|error| {
                malformed(
                    path,
                    format!("failed to map HVAR advance for glyph {glyph}: {error}"),
                )
            })?,
        None => DeltaSetIndex {
            outer: 0,
            inner: glyph.to_u32() as u16,
        },
    };
    let store = hvar.item_variation_store().map_err(|error| {
        malformed(
            path,
            format!("failed to read HVAR item variation store: {error}"),
        )
    })?;
    let Some(data) = store.item_variation_data().get(index.outer as usize) else {
        return Ok(BTreeMap::new());
    };
    let data = data
        .map_err(|error| malformed(path, format!("failed to read HVAR variation data: {error}")))?;
    let regions = store
        .variation_region_list()
        .map_err(|error| {
            malformed(
                path,
                format!("failed to read HVAR variation regions: {error}"),
            )
        })?
        .variation_regions();
    let mut contributions = BTreeMap::new();
    for (position, delta) in data.delta_set(index.inner).enumerate() {
        if delta == 0 {
            continue;
        }
        let region_index = data
            .region_indexes()
            .get(position)
            .ok_or_else(|| malformed(path, "HVAR region index is missing".into()))?
            .get() as usize;
        let region = regions.get(region_index).map_err(|error| {
            malformed(
                path,
                format!("failed to read HVAR region {region_index}: {error}"),
            )
        })?;
        let region = AtlasRegion::new(
            region
                .region_axes()
                .iter()
                .map(|axis| RegionAxis {
                    start: axis.start_coord().to_bits(),
                    peak: axis.peak_coord().to_bits(),
                    end: axis.end_coord().to_bits(),
                })
                .collect(),
        );
        let weight = registry.weight_index(region)?;
        *contributions.entry(weight).or_default() += delta as f32;
    }
    Ok(contributions)
}

fn gvar_contributions(
    path: &Path,
    loca: Loca<'_>,
    glyf: Glyf<'_>,
    gvar: &Gvar<'_>,
    registry: &mut RegionRegistry,
    glyph: GlyphId,
) -> Result<BTreeMap<u32, f32>, SourceAtlasError> {
    let (glyph, point_count) = metrics_glyph(path, loca, glyf, glyph, &mut HashSet::new())?;
    let Some(variation) = gvar.glyph_variation_data(glyph).map_err(|error| {
        malformed(
            path,
            format!("failed to read metric variation data for glyph {glyph}: {error}"),
        )
    })?
    else {
        return Ok(BTreeMap::new());
    };
    let left = point_count;
    let right = point_count
        .checked_add(1)
        .ok_or_else(|| malformed(path, "phantom point index overflow".into()))?;
    let mut contributions = BTreeMap::new();
    for tuple in variation.tuples() {
        let mut left_delta = 0_i32;
        let mut right_delta = 0_i32;
        for delta in tuple.deltas() {
            let position = delta.position as usize;
            if position == left {
                left_delta = delta.x_delta;
            } else if position == right {
                right_delta = delta.x_delta;
            }
        }
        let delta = right_delta - left_delta;
        if delta == 0 {
            continue;
        }
        let weight = registry.weight_index(tuple_region(&tuple))?;
        *contributions.entry(weight).or_default() += delta as f32;
    }
    Ok(contributions)
}

fn metrics_glyph(
    path: &Path,
    loca: Loca<'_>,
    glyf: Glyf<'_>,
    glyph: GlyphId,
    ancestry: &mut HashSet<GlyphId>,
) -> Result<(GlyphId, usize), SourceAtlasError> {
    if !ancestry.insert(glyph) {
        return Err(malformed(
            path,
            format!("cyclic USE_MY_METRICS component at glyph {glyph}"),
        )
        .into());
    }
    let raw = loca
        .get_glyf(glyph, &glyf)
        .map_err(|error| malformed(path, format!("failed to read glyph {glyph}: {error}")))?;
    let result = match raw {
        None => (glyph, 0),
        Some(GlyfGlyph::Simple(simple)) => (glyph, simple.num_points()),
        Some(GlyfGlyph::Composite(composite)) => {
            let components = composite.components().collect::<Vec<_>>();
            let mut metrics = None;
            for component in &components {
                if component
                    .flags
                    .contains(CompositeGlyphFlags::USE_MY_METRICS)
                {
                    metrics = Some(metrics_glyph(
                        path,
                        loca.clone(),
                        glyf.clone(),
                        component.glyph.into(),
                        ancestry,
                    )?);
                }
            }
            metrics.unwrap_or((glyph, components.len()))
        }
    };
    ancestry.remove(&glyph);
    Ok(result)
}
