use crate::Font;

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
}

#[cfg(test)]
mod tests {
    use crate::test_support::sample_variable_font;
    use crate::{DesignLocation, Source};

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
