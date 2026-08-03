use std::collections::HashSet;
use std::time::{Duration, Instant};

use shift_font::{CoreError, Font, GlyphId, GlyphProjection, GlyphProjectionSet};

use crate::{
    AuthoredAtlasBuilder, AuthoredGlyph, AuthoredSlugError, AuthoredWeightSet, SlugError,
    VariableAtlas,
};

/// One authored root glyph and every resident atlas glyph it may select.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthoredAtlasGlyph {
    pub glyph_id: GlyphId,
    pub authored: AuthoredGlyph,
}

/// One complete location-independent authored Slug generation.
///
/// The atlas owns only rendering data. Glyph identity and exact-source selection
/// remain explicit so a consumer never relies on authored collection order.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthoredAtlasPage {
    atlas: VariableAtlas,
    glyphs: Vec<AuthoredAtlasGlyph>,
    weight_sets: Vec<AuthoredWeightSet>,
    weight_count: u32,
}

impl AuthoredAtlasPage {
    pub fn atlas(&self) -> &VariableAtlas {
        &self.atlas
    }

    pub fn into_atlas(self) -> VariableAtlas {
        self.atlas
    }

    pub fn glyphs(&self) -> &[AuthoredAtlasGlyph] {
        &self.glyphs
    }

    pub fn weight_sets(&self) -> &[AuthoredWeightSet] {
        &self.weight_sets
    }

    /// Total per-frame weight count, including the constant weight at index zero.
    pub fn weight_count(&self) -> u32 {
        self.weight_count
    }
}

/// A complete-font atlas is one page containing every authored root glyph.
pub type AuthoredAtlas = AuthoredAtlasPage;

/// Release-profile phase durations for one authored atlas compilation.
///
/// Component, fallback-bounds, and exact-source durations are subsets of
/// `atlas_addition`; they identify nested work rather than additive phases.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AuthoredAtlasProfile {
    pub projection_preparation: Duration,
    pub weight_set_collection: Duration,
    pub component_preparation: Duration,
    pub fallback_bounds: Duration,
    pub exact_source_preparation: Duration,
    pub atlas_addition: Duration,
}

/// Compiles every authored font glyph into one resident Slug generation.
pub fn build_authored_atlas(
    font: &Font,
    band_count: u32,
) -> Result<AuthoredAtlas, AuthoredSlugError> {
    build_authored_atlas_profiled(font, band_count).map(|(atlas, _)| atlas)
}

/// Compiles every glyph and reports CPU phase durations from the same product path.
pub fn build_authored_atlas_profiled(
    font: &Font,
    band_count: u32,
) -> Result<(AuthoredAtlas, AuthoredAtlasProfile), AuthoredSlugError> {
    let glyph_ids = font.glyphs().map(|glyph| glyph.id()).collect::<Vec<_>>();
    build_authored_atlas_page_profiled(font, &glyph_ids, band_count)
}

/// Compiles an ordered root-glyph batch and its transitive component geometry.
///
/// Root identities are deduplicated in caller order. Interpolation bases are
/// collected only from those roots and their component closures, so a local
/// edit patch does not scan or compile unrelated glyphs.
pub fn build_authored_atlas_page(
    font: &Font,
    glyph_ids: &[GlyphId],
    band_count: u32,
) -> Result<AuthoredAtlasPage, AuthoredSlugError> {
    build_authored_atlas_page_profiled(font, glyph_ids, band_count).map(|(atlas, _)| atlas)
}

/// Compiles an ordered root batch and reports CPU phase durations from the same product path.
pub fn build_authored_atlas_page_profiled(
    font: &Font,
    glyph_ids: &[GlyphId],
    band_count: u32,
) -> Result<(AuthoredAtlasPage, AuthoredAtlasProfile), AuthoredSlugError> {
    let glyph_ids = unique_glyph_ids(font, glyph_ids)?;
    let mut profile = AuthoredAtlasProfile::default();

    let started = Instant::now();
    let projection_set = font.glyph_projection_set(&glyph_ids)?;
    profile.projection_preparation = started.elapsed();

    let started = Instant::now();
    let (weight_sets, weight_count) = collect_weight_sets(&projection_set, &glyph_ids)?;
    profile.weight_set_collection = started.elapsed();

    let mut builder = AuthoredAtlasBuilder::new(band_count)?;
    let mut glyphs = Vec::with_capacity(glyph_ids.len());
    let started = Instant::now();
    for glyph_id in glyph_ids {
        let authored = match projection_set.projection(&glyph_id) {
            Some(projection) => builder.add_glyph_from_projection_set_profiled(
                font,
                &projection_set,
                projection,
                &weight_sets,
                0,
                &mut profile,
            )?,
            None => builder.add_empty_glyph(0)?,
        };
        glyphs.push(AuthoredAtlasGlyph { glyph_id, authored });
    }
    profile.atlas_addition = started.elapsed();

    Ok((
        AuthoredAtlasPage {
            atlas: builder.finish(),
            glyphs,
            weight_sets,
            weight_count,
        },
        profile,
    ))
}

fn unique_glyph_ids(font: &Font, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, AuthoredSlugError> {
    let mut seen = HashSet::new();
    let mut unique = Vec::with_capacity(glyph_ids.len());

    for glyph_id in glyph_ids {
        if font.glyph(glyph_id.clone()).is_none() {
            return Err(CoreError::GlyphNotFound(glyph_id.clone()).into());
        }
        if seen.insert(glyph_id.clone()) {
            unique.push(glyph_id.clone());
        }
    }

    Ok(unique)
}

fn collect_weight_sets(
    projection_set: &GlyphProjectionSet,
    glyph_ids: &[GlyphId],
) -> Result<(Vec<AuthoredWeightSet>, u32), AuthoredSlugError> {
    let mut projections = Vec::new();
    let mut seen = HashSet::new();

    for glyph_id in glyph_ids {
        let Some(root) = projection_set.projection(glyph_id) else {
            continue;
        };
        collect_projection(projection_set, root, &mut seen, &mut projections)?;
    }

    let mut sets = Vec::new();
    let mut next_weight_index = 1_u32;
    for projection in projections {
        let Some(interpolation) = projection.interpolation() else {
            continue;
        };
        if sets
            .iter()
            .any(|set: &AuthoredWeightSet| set.basis() == interpolation.basis())
        {
            continue;
        }

        let count = u32::try_from(interpolation.basis().source_ids().len())
            .map_err(|_| SlugError::LengthOverflow)?;
        let end = next_weight_index
            .checked_add(count)
            .ok_or(SlugError::LengthOverflow)?;
        sets.push(AuthoredWeightSet::new(
            interpolation.basis().clone(),
            (next_weight_index..end).collect(),
        )?);
        next_weight_index = end;
    }

    Ok((sets, next_weight_index))
}

fn collect_projection<'a>(
    projection_set: &'a GlyphProjectionSet,
    root: &'a GlyphProjection,
    seen: &mut HashSet<GlyphId>,
    projections: &mut Vec<&'a GlyphProjection>,
) -> Result<(), AuthoredSlugError> {
    if !seen.insert(root.glyph_id()) {
        return Ok(());
    }

    projections.push(root);
    for glyph_id in root.component_glyph_ids() {
        let projection = projection_set
            .projection(glyph_id)
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
        collect_projection(projection_set, projection, seen, projections)?;
    }

    Ok(())
}
