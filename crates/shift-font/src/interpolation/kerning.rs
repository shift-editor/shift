use crate::{CoreResult, DesignLocation, Font, GlyphId, SourceId};

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
                source.id() == default_source_id || self.kerning().source(&source.id()).is_some()
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
        first: &GlyphId,
        second: &GlyphId,
    ) -> CoreResult<f64> {
        let value_at = |source_id: &SourceId| {
            self.kerning()
                .resolve(source_id, first, second)
                .map_or(0.0, |resolved| resolved.value)
        };
        let Some(basis) = self.kerning_interpolation_basis() else {
            return Ok(self.default_source_id().as_ref().map_or(0.0, value_at));
        };

        let weights = basis.weights_at(location, self.axes())?;
        Ok(basis
            .source_ids()
            .iter()
            .zip(weights)
            .filter(|(_, weight)| *weight != 0.0)
            .map(|(source_id, weight)| weight * value_at(source_id))
            .sum())
    }
}

#[cfg(test)]
mod tests {
    use crate::test_support::sample_variable_font;
    use crate::{DesignLocation, Source};

    fn weight_location(font: &crate::Font, value: f64) -> DesignLocation {
        let mut location = DesignLocation::new();
        location.set(font.axes()[0].id(), value);
        location
    }

    #[test]
    fn kerning_at_blends_the_masters_that_author_kerning() {
        let font = sample_variable_font();
        let a = font.glyph_id_by_name("A").unwrap();

        let at = |value| {
            font.kerning_at(&weight_location(&font, value), &a, &a)
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
        font.kerning_mut().remove_value(&bold_id, &pair);
        font.kerning_mut().set_value(
            bold_id,
            crate::KerningPair::glyphs(crate::GlyphId::from_raw("other"), a.clone()),
            -10.0,
        );

        let mid = font
            .kerning_at(&weight_location(&font, 600.0), &a, &a)
            .unwrap();

        assert_eq!(mid, -25.0);
    }

    #[test]
    fn the_basis_skips_masters_without_kerning() {
        let mut font = sample_variable_font();
        let weight_id = font.axes()[0].id();
        let mut location = DesignLocation::new();
        location.set(weight_id, 600.0);
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
            &default_source_id,
            &crate::KerningPair::groups(
                crate::KerningGroupId::from_raw("first_A"),
                crate::KerningGroupId::from_raw("second_A"),
            ),
        );
        assert!(font
            .kerning_interpolation_basis()
            .unwrap()
            .source_ids()
            .contains(&default_source_id));
    }
}
