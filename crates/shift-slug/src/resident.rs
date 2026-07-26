use shift_font::{Font, GlyphId};

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
pub struct AuthoredAtlas {
    atlas: VariableAtlas,
    glyphs: Vec<AuthoredAtlasGlyph>,
    weight_sets: Vec<AuthoredWeightSet>,
    weight_count: u32,
}

impl AuthoredAtlas {
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

/// Compiles every authored font glyph into one resident Slug generation.
///
/// Interpolation bases are deduplicated over the complete font before any glyph
/// is appended. This guarantees that roots and transitive components can use
/// independent bases while sharing one small per-frame weight buffer.
pub fn build_authored_atlas(
    font: &Font,
    band_count: u32,
) -> Result<AuthoredAtlas, AuthoredSlugError> {
    let (weight_sets, weight_count) = collect_weight_sets(font)?;
    let mut builder = AuthoredAtlasBuilder::new(band_count)?;
    let mut glyphs = Vec::new();

    for glyph in font.glyphs() {
        let glyph_id = glyph.id();
        let authored = match font.glyph_projection(&glyph_id)? {
            Some(projection) => builder.add_glyph(font, &projection, &weight_sets, 0)?,
            None => builder.add_empty_glyph(0)?,
        };
        glyphs.push(AuthoredAtlasGlyph { glyph_id, authored });
    }

    Ok(AuthoredAtlas {
        atlas: builder.finish(),
        glyphs,
        weight_sets,
        weight_count,
    })
}

fn collect_weight_sets(font: &Font) -> Result<(Vec<AuthoredWeightSet>, u32), AuthoredSlugError> {
    let mut sets = Vec::new();
    let mut next_weight_index = 1_u32;

    for glyph in font.glyphs() {
        let Some(projection) = font.glyph_projection(&glyph.id())? else {
            continue;
        };
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
