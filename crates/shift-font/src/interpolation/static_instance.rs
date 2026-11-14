//! Static instances: a variable font evaluated at one location, as a font
//! with one master and no axes, which compiles to a static binary.

use std::collections::BTreeSet;

use crate::{
    Axis, CoreError, CoreResult, DesignLocation, Font, Glyph, GlyphId, GlyphLayer, Kerning,
    KerningPair, LayerId, NamedInstance, Source, SourceId,
};

impl Font {
    /// Returns the static font `instance` names: [`Self::static_at`] its
    /// location mapped into design space, styled with the instance's name.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`Self::mapped_location`] and [`Self::static_at`].
    pub fn static_instance(&self, instance: &NamedInstance) -> CoreResult<Self> {
        let location = self.mapped_location(instance.location())?;
        let mut font = self.static_at(&location)?;
        font.metadata_mut().style_name = Some(instance.name().to_string());
        Ok(font)
    }

    /// Returns this font evaluated at a design `location` as a static font:
    /// the default source as its one master, holding every glyph, the source
    /// metrics and the kerning as a font compiled from this one has them
    /// there, with no axes, axis mappings or named instances.
    ///
    /// Glyphs interpolate as [`Self::glyph_interpolation`] models them; a
    /// glyph without a model keeps its [`Self::fallback_layer`]. Layers on
    /// other sources, such as backgrounds, are dropped. Kerning keeps its
    /// groups: each authored pair takes
    /// [`KerningBlend::pair_value`](crate::KerningBlend::pair_value), and a
    /// glyph pair whose compiled value differs from what those pairs resolve
    /// to in the static font gains a pair of its own.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MissingDefaultSource`] when the font has no
    /// default source, [`CoreError::AxisNotFound`] when a model references a
    /// missing axis, and a glyph-value error when an interpolation model does
    /// not fit its reference layer.
    pub fn static_at(&self, location: &DesignLocation) -> CoreResult<Self> {
        let default_id = self
            .default_source_id()
            .ok_or(CoreError::MissingDefaultSource)?;
        let master = self.static_master(default_id, location)?;
        let layers = self.static_layers(default_id, location)?;
        let kerning = self.static_kerning(default_id, location)?;

        let mut font = self.clone();
        for glyph in self.glyphs() {
            for layer_id in glyph.layer_ids() {
                font.remove_glyph_layer(layer_id)?;
            }
        }
        for (glyph_id, layer) in layers {
            font.insert_glyph_layer(glyph_id, layer)?;
        }
        let other_sources: Vec<_> = self
            .sources()
            .iter()
            .map(Source::id)
            .filter(|source_id| *source_id != default_id)
            .collect();
        for source_id in other_sources {
            font.remove_source(source_id);
        }
        font.set_named_instances(Vec::new())?;
        font.set_axis_mappings(Vec::new())?;
        for axis_id in self.axes().iter().map(Axis::id) {
            font.remove_axis(axis_id)?;
        }
        font.replace_source(master)?;
        *font.kerning_mut() = kerning;
        Ok(font)
    }

    /// The default source with the source metrics resolved at `location`,
    /// at no location.
    fn static_master(&self, default_id: SourceId, location: &DesignLocation) -> CoreResult<Source> {
        let mut master = self.require_source(default_id)?.clone();
        if let Some(interpolation) = self.source_metric_interpolation() {
            let metrics = interpolation.resolve(location, self.axes())?;
            master.set_metric_values(metrics.metric_values().clone());
            master.set_italic_angle(metrics.italic_angle());
            master.set_line_gap(metrics.line_gap());
            master.set_underline_position(metrics.underline_position());
            master.set_underline_thickness(metrics.underline_thickness());
        }
        master.set_location(DesignLocation::new());
        Ok(master)
    }

    /// Each glyph's layer at `location`, bound to `default_id`; glyphs with
    /// no master layer have none.
    fn static_layers(
        &self,
        default_id: SourceId,
        location: &DesignLocation,
    ) -> CoreResult<Vec<(GlyphId, GlyphLayer)>> {
        let mut layers = Vec::new();
        for glyph in self.glyphs() {
            let Some(layer) = self.layer_at(glyph, location)? else {
                continue;
            };
            let layer_id = self
                .default_master_layer(glyph)
                .map_or_else(LayerId::new, |layer| layer.id());
            layers.push((glyph.id(), layer.clone_with_identity(layer_id, default_id)));
        }
        Ok(layers)
    }

    fn layer_at(&self, glyph: &Glyph, location: &DesignLocation) -> CoreResult<Option<GlyphLayer>> {
        if let Some(interpolation) = self.glyph_interpolation(glyph.id())? {
            return interpolation.resolve(location, self.axes()).map(Some);
        }
        Ok(self
            .fallback_layer(glyph)
            .map(|layer| layer.as_ref().clone()))
    }

    /// The kerning a font compiled from this one applies at `location`, as
    /// pairs of `default_id` over this font's groups.
    fn static_kerning(
        &self,
        default_id: SourceId,
        location: &DesignLocation,
    ) -> CoreResult<Kerning> {
        let source = self.kerning();
        let blend = self.kerning_blend_at(location)?;
        let mut kerning = Kerning::new();
        for (group_id, group) in source.all_groups() {
            kerning.set_group(*group_id, group.clone())?;
        }

        let pairs: BTreeSet<&KerningPair> = source
            .sources()
            .flat_map(|(_, values)| values.pairs().map(|(pair, _)| pair))
            .collect();
        for pair in &pairs {
            kerning.set_value(default_id, (*pair).clone(), blend.pair_value(source, pair));
        }

        // A glyph pair an exception covers can compile to a value its pairs
        // here do not reproduce, when masters disagree about which pair
        // applies to it; give such glyph pairs their own value.
        for pair in pairs.iter().filter(|pair| pair.has_glyph_side()) {
            for (first, second) in source.covered_glyph_pairs(pair) {
                let compiled = blend.value(source, first, second);
                let resolved = kerning
                    .resolve(default_id, first, second)
                    .map_or(0.0, |resolved| resolved.value);
                if compiled != resolved {
                    kerning.set_value(default_id, KerningPair::glyphs(first, second), compiled);
                }
            }
        }
        Ok(kerning)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{default_kerning_between, sample_variable_font};
    use crate::{
        AxisId, ExternalLocation, KerningGroup, KerningGroupId, KerningPosition, KerningSide,
        PointType,
    };

    fn outline(font: &Font, glyph: &str) -> Vec<(f64, f64)> {
        let glyph = font.glyph_by_name(glyph).unwrap();
        let layer = font.default_master_layer(glyph).unwrap();
        layer.points().map(|point| (point.x(), point.y())).collect()
    }

    fn bold_instance(font: &Font) -> &NamedInstance {
        font.named_instances()
            .iter()
            .find(|instance| instance.name() == "Bold")
            .unwrap()
    }

    #[test]
    fn an_instance_on_a_master_is_that_master_as_a_static_font() {
        let font = sample_variable_font();

        let bold = font.static_instance(bold_instance(&font)).unwrap();

        assert!(bold.axes().is_empty());
        assert!(bold.named_instances().is_empty());
        assert_eq!(bold.sources().len(), 1);
        assert_eq!(bold.metadata().style_name.as_deref(), Some("Bold"));
        assert_eq!(
            outline(&bold, "A"),
            [(100.0, 0.0), (380.0, 700.0), (500.0, 0.0)]
        );
        let glyph = bold.glyph_by_name("A").unwrap();
        assert_eq!(bold.default_master_layer(glyph).unwrap().width(), 800.0);
        let metrics = bold
            .standard_metrics(bold.default_source_id().unwrap())
            .unwrap();
        assert_eq!(metrics.ascender, Some(820.0));
        assert_eq!(metrics.x_height, Some(510.0));
        assert_eq!(default_kerning_between(&bold, "A", "A"), Some(-90.0));
    }

    #[test]
    fn an_instance_between_masters_interpolates_outlines_and_metrics() {
        let font = sample_variable_font();
        let weight = font.axes()[0].id();

        // Design 700 is halfway between the Medium (600) and Bold (800)
        // masters, and three quarters of the way from Regular (400) to Bold
        // for `A`, which Medium does not draw.
        let between = font
            .static_at(&DesignLocation::from([(weight, 700.0)]))
            .unwrap();

        assert_eq!(
            outline(&between, "A"),
            [(100.0, 0.0), (360.0, 700.0), (500.0, 0.0)]
        );
        let metrics = between
            .standard_metrics(between.default_source_id().unwrap())
            .unwrap();
        assert_eq!(metrics.ascender, Some(810.0));
        assert_eq!(between.glyph_by_name("A").unwrap().layers().len(), 1);
    }

    /// Two masters that disagree about which pair kerns `a` before `c`: the
    /// light one kerns `a` against the group, the bold one kerns the group
    /// against `c`.
    fn disagreeing_kerning() -> (Font, AxisId) {
        let mut font = Font::new();
        let weight = Axis::weight();
        let axis_id = weight.id();
        font.add_axis(weight).unwrap();
        let light = font.default_source_id().unwrap();
        font.source_mut(light)
            .unwrap()
            .set_location(DesignLocation::from([(axis_id, 400.0)]));
        let bold = font.add_source(Source::new(
            "Bold".to_string(),
            DesignLocation::from([(axis_id, 700.0)]),
        ));
        let mut ids = Vec::new();
        for name in ["a", "b", "c"] {
            let mut glyph = Glyph::new(name);
            for source in [light, bold] {
                glyph.set_layer(GlyphLayer::with_width(LayerId::new(), source, 500.0));
            }
            ids.push(font.insert_glyph(glyph).unwrap());
        }
        let (a, b, c) = (ids[0], ids[1], ids[2]);
        let left = KerningGroupId::from_raw("left");
        let right = KerningGroupId::from_raw("right");
        let kerning = font.kerning_mut();
        kerning
            .set_group(
                left,
                KerningGroup::new(KerningPosition::First, "a", vec![a]),
            )
            .unwrap();
        kerning
            .set_group(
                right,
                KerningGroup::new(KerningPosition::Second, "b", vec![b, c]),
            )
            .unwrap();
        kerning.set_value(
            light,
            KerningPair::new(KerningSide::Glyph(a), KerningSide::Group(right)),
            -10.0,
        );
        kerning.set_value(
            bold,
            KerningPair::new(KerningSide::Group(left), KerningSide::Glyph(c)),
            -40.0,
        );
        kerning.set_value(bold, KerningPair::groups(left, right), -20.0);
        (font, axis_id)
    }

    #[test]
    fn static_kerning_matches_the_compiled_kerning_for_every_glyph_pair() {
        let (font, axis_id) = disagreeing_kerning();
        let location = DesignLocation::from([(axis_id, 550.0)]);

        let half = font.static_at(&location).unwrap();

        let ids: Vec<_> = font.glyphs().map(Glyph::id).collect();
        for first in &ids {
            for second in &ids {
                let compiled = font.kerning_at(&location, *first, *second).unwrap();
                let static_value = half
                    .kerning()
                    .resolve(half.default_source_id().unwrap(), *first, *second)
                    .map_or(0.0, |resolved| resolved.value);
                assert_eq!(static_value, compiled, "{first} {second}");
            }
        }
        // a/c needed its own pair; the groups still carry the rest.
        assert_eq!(half.kerning().all_groups().count(), 2);
    }

    #[test]
    fn a_static_instance_maps_its_user_location() {
        let font = sample_variable_font();
        let weight = font.axes()[0].id();
        let instance = NamedInstance::new(
            "Semi".to_string(),
            ExternalLocation::from([(weight, 700.0)]),
            None,
        );

        // The weight map sends user 700 to design 600.
        let semi = font.static_instance(&instance).unwrap();

        assert_eq!(
            outline(&semi, "A"),
            [(100.0, 0.0), (340.0, 700.0), (500.0, 0.0)]
        );
        assert!(
            semi.glyph_by_name("A")
                .unwrap()
                .layers()
                .values()
                .all(|layer| layer.contours_iter().all(|contour| contour
                    .points()
                    .iter()
                    .all(|point| point.point_type() == PointType::OnCurve)))
        );
    }
}
