use crate::{CoreResult, DesignLocation, Font, GlyphId, Kerning, SourceId};

use super::InterpolationBasis;

impl Font {
    /// Returns the basis kerning interpolates over: the default source and
    /// every master with authored pairs, in source order.
    ///
    /// These are the locations export compiles kerning at, so a master
    /// without pairs (such as a sparse intermediate master) does not pull
    /// interpolated values toward zero. A pair a basis source does not author
    /// resolves through its groups at that source, then to zero. Returns
    /// `None` for a static font or one whose default source is not a master.
    pub fn kerning_interpolation_basis(&self) -> Option<InterpolationBasis> {
        if !self.is_variable() {
            return None;
        }
        let default_source_id = self.default_source_id()?;
        let source_locations = self
            .masters()
            .filter(|source| {
                source.id() == default_source_id || self.kerning().source(source.id()).is_some()
            })
            .map(|source| (source.id(), source.location().clone()))
            .collect::<Vec<_>>();
        if !source_locations
            .iter()
            .any(|(source_id, _)| *source_id == default_source_id)
        {
            return None;
        }

        InterpolationBasis::from_source_locations(
            &source_locations,
            self.axes(),
            self.design_normalization().ok()?,
        )
    }

    /// Returns the kerning between `first` followed by `second` at a design
    /// `location`, as the compiled font applies it.
    ///
    /// Each source in [`Self::kerning_interpolation_basis`] contributes the
    /// pair that resolves there, or zero, weighted at `location`. A static
    /// font, or one with no basis, returns the default source's value.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::AxisNotFound`] when the basis references an
    /// axis the font no longer has.
    pub fn kerning_at(
        &self,
        location: &DesignLocation,
        first: GlyphId,
        second: GlyphId,
    ) -> CoreResult<f64> {
        Ok(self
            .kerning_blend_at(location)?
            .value(self.kerning(), first, second))
    }

    /// Returns the sources kerning reads at a design `location`, weighted as
    /// [`Self::kerning_at`] weighs them: the basis sources with a weight
    /// there, or the default source alone when the font has no basis.
    ///
    /// # Errors
    ///
    /// As [`Self::kerning_at`].
    pub fn kerning_blend_at(&self, location: &DesignLocation) -> CoreResult<KerningBlend> {
        let Some(basis) = self.kerning_interpolation_basis() else {
            return Ok(KerningBlend::only(self.default_source_id()));
        };
        let weights = basis.weights_at(location, self.axes())?;
        Ok(KerningBlend {
            sources: basis
                .source_ids()
                .iter()
                .zip(weights)
                .filter(|(_, weight)| *weight != 0.0)
                .map(|(source_id, weight)| (*source_id, weight))
                .collect(),
        })
    }

    /// Returns the sources kerning reads while `source_id` is edited: the
    /// source alone when it authors pairs or the font has no basis, so it
    /// shows its own values; otherwise the blend at its location, so a sparse
    /// master shows what the compiled font kerns there.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::SourceNotFound`] for a source the font does
    /// not have, and otherwise as [`Self::kerning_at`].
    pub fn kerning_blend_at_source(&self, source_id: SourceId) -> CoreResult<KerningBlend> {
        let source = self.require_source(source_id)?;
        if self.kerning().source(source_id).is_some()
            || self.kerning_interpolation_basis().is_none()
        {
            return Ok(KerningBlend::only(Some(source_id)));
        }
        self.kerning_blend_at(source.location())
    }
}

/// The sources kerning reads at one place, each with its weight.
///
/// Built once for a place and reused for every pair read there, so a run of
/// pairs evaluates the interpolation basis once.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct KerningBlend {
    sources: Vec<(SourceId, f64)>,
}

impl KerningBlend {
    fn only(source_id: Option<SourceId>) -> Self {
        Self {
            sources: source_id
                .map(|source_id| (source_id, 1.0))
                .into_iter()
                .collect(),
        }
    }

    /// Returns the kerning between `first` followed by `second`: each
    /// source's resolved value, zero where no pair applies, times its weight.
    pub fn value(&self, kerning: &Kerning, first: GlyphId, second: GlyphId) -> f64 {
        self.values(kerning, [(first, second)])
            .pop()
            .unwrap_or_default()
    }

    /// Returns [`Self::value`] for each of `pairs`, in order, looking each
    /// source up once for the whole run.
    pub fn values(
        &self,
        kerning: &Kerning,
        pairs: impl IntoIterator<Item = (GlyphId, GlyphId)>,
    ) -> Vec<f64> {
        let sources: Vec<_> = self
            .sources
            .iter()
            .filter_map(|(source_id, weight)| Some((kerning.source(*source_id)?, *weight)))
            .collect();
        pairs
            .into_iter()
            .map(|(first, second)| {
                if sources.is_empty() {
                    return 0.0;
                }
                let candidates = kerning.candidates(first, second);
                sources
                    .iter()
                    .filter_map(|(source, weight)| {
                        let value = candidates.iter().find_map(|pair| source.value(pair))?;
                        Some(weight * value)
                    })
                    // From +0: an empty f64 `sum` is -0, which would read as a kern.
                    .fold(0.0, |total, value| total + value)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::test_support::sample_variable_font;
    use crate::{DesignLocation, Source};

    fn weight_location(font: &crate::Font, value: f64) -> DesignLocation {
        DesignLocation::from([(font.axes()[0].id(), value)])
    }

    #[test]
    fn kerning_at_blends_the_masters_that_author_kerning() {
        let font = sample_variable_font();
        let a = font.glyph_id_by_name("A").unwrap();

        let at = |value| {
            font.kerning_at(&weight_location(&font, value), a, a)
                .unwrap()
        };

        assert_eq!(at(400.0), -50.0);
        assert_eq!(at(800.0), -90.0);
        assert_eq!(at(600.0), -70.0);
    }

    #[test]
    fn kerning_at_counts_a_master_without_the_pair_as_zero() {
        let mut font = sample_variable_font();
        let a = font.glyph_id_by_name("A").unwrap();
        let bold_id = font.sources()[2].id();
        let pair = crate::KerningPair::groups(
            crate::KerningGroupId::from_raw("first_A"),
            crate::KerningGroupId::from_raw("second_A"),
        );
        font.kerning_mut().remove_value(bold_id, &pair);
        font.kerning_mut().set_value(
            bold_id,
            crate::KerningPair::glyphs(crate::GlyphId::from_raw("other"), a),
            -10.0,
        );

        let mid = font
            .kerning_at(&weight_location(&font, 600.0), a, a)
            .unwrap();

        assert_eq!(mid, -25.0);
    }

    #[test]
    fn a_source_with_pairs_reads_its_own_values() {
        let font = sample_variable_font();
        let a = font.glyph_id_by_name("A").unwrap();
        let bold_id = font.sources()[2].id();

        let blend = font.kerning_blend_at_source(bold_id).unwrap();

        assert_eq!(blend.value(font.kerning(), a, a), -90.0);
    }

    #[test]
    fn a_source_without_pairs_reads_the_blend_at_its_location() {
        let font = sample_variable_font();
        let a = font.glyph_id_by_name("A").unwrap();
        let medium_id = font
            .sources()
            .iter()
            .find(|source| source.location() == &weight_location(&font, 600.0))
            .map(Source::id)
            .unwrap();

        let blend = font.kerning_blend_at_source(medium_id).unwrap();

        assert_eq!(blend.value(font.kerning(), a, a), -70.0);
    }

    #[test]
    fn the_basis_skips_masters_without_kerning() {
        let mut font = sample_variable_font();
        let weight_id = font.axes()[0].id();
        let location = DesignLocation::from([(weight_id, 600.0)]);
        let medium_id = font
            .sources()
            .iter()
            .find(|source| source.location() == &location)
            .map(Source::id)
            .unwrap();

        let basis = font.kerning_interpolation_basis().unwrap();

        assert_eq!(basis.source_ids().len(), 2);
        assert!(!basis.source_ids().contains(&medium_id));
        let default_source_id = font.default_source_id().unwrap();
        font.kerning_mut().remove_value(
            default_source_id,
            &crate::KerningPair::groups(
                crate::KerningGroupId::from_raw("first_A"),
                crate::KerningGroupId::from_raw("second_A"),
            ),
        );
        assert!(
            font.kerning_interpolation_basis()
                .unwrap()
                .source_ids()
                .contains(&default_source_id)
        );
    }
}
