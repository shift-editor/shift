use std::collections::HashSet;
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::orchestration::{Access, Work};
use fontir::error::Error;
use fontir::ir::{
    FeaturesSource, GdefCategories, GlobalMetric, GlobalMetricsBuilder, GlyphOrder, NameBuilder,
    StaticMetadata, DEFAULT_VENDOR_ID,
};
use fontir::orchestration::{Context, WorkId};
use write_fonts::types::NameId;

use super::source::ShiftSnapshot;

#[derive(Debug)]
pub(super) struct StaticMetadataWork {
    snapshot: Arc<ShiftSnapshot>,
}

impl StaticMetadataWork {
    pub fn new(snapshot: Arc<ShiftSnapshot>) -> Self {
        Self { snapshot }
    }
}

impl Work<Context, WorkId, Error> for StaticMetadataWork {
    fn id(&self) -> WorkId {
        WorkId::StaticMetadata
    }

    fn also_completes(&self) -> Vec<WorkId> {
        vec![WorkId::PreliminaryGlyphOrder]
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        let metadata = &self.snapshot.metadata;
        let mut names = NameBuilder::default();
        let version_major = metadata.version_major.unwrap_or_default();
        let version_minor = metadata
            .version_minor
            .unwrap_or_default()
            .try_into()
            .unwrap_or_default();

        names.set_version(version_major, version_minor);
        names.add_if_present(NameId::COPYRIGHT_NOTICE, &metadata.copyright);
        names.add_if_present(NameId::TRADEMARK, &metadata.trademark);
        names.add_if_present(NameId::MANUFACTURER, &metadata.manufacturer);
        names.add_if_present(NameId::DESIGNER, &metadata.designer);
        names.add_if_present(NameId::DESCRIPTION, &metadata.description);
        names.add_if_present(NameId::VENDOR_URL, &metadata.manufacturer_url);
        names.add_if_present(NameId::DESIGNER_URL, &metadata.designer_url);
        names.add_if_present(NameId::LICENSE_DESCRIPTION, &metadata.license);
        names.add_if_present(NameId::LICENSE_URL, &metadata.license_url);
        names.add_if_present(NameId::TYPOGRAPHIC_FAMILY_NAME, &metadata.family_name);
        names.add_if_present(NameId::TYPOGRAPHIC_SUBFAMILY_NAME, &metadata.style_name);
        names.apply_default_fallbacks(DEFAULT_VENDOR_ID);

        let default_location = NormalizedLocation::default();
        let global_locations = HashSet::from([default_location]);
        let mut static_metadata = StaticMetadata::new(
            self.snapshot.metrics.units_per_em as u16,
            names.into_inner(),
            Vec::new(),
            Vec::new(),
            global_locations,
            None,
            self.snapshot.metrics.italic_angle.unwrap_or_default(),
            GdefCategories::default(),
            None,
            false,
        )?;
        static_metadata.misc.version_major = version_major;
        static_metadata.misc.version_minor = version_minor;

        let mut glyph_order = GlyphOrder::new();
        for glyph in &self.snapshot.glyphs {
            glyph_order.insert(glyph.name().into());
        }

        context.preliminary_glyph_order.set(glyph_order);
        context.static_metadata.set(static_metadata);
        Ok(())
    }
}

#[derive(Debug)]
pub(super) struct GlobalMetricsWork {
    snapshot: Arc<ShiftSnapshot>,
}

impl GlobalMetricsWork {
    pub fn new(snapshot: Arc<ShiftSnapshot>) -> Self {
        Self { snapshot }
    }
}

impl Work<Context, WorkId, Error> for GlobalMetricsWork {
    fn id(&self) -> WorkId {
        WorkId::GlobalMetrics
    }

    fn read_access(&self) -> Access<WorkId> {
        Access::Variant(WorkId::StaticMetadata)
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        let metadata = context.static_metadata.get();
        let source = &self.snapshot.metrics;
        let location = NormalizedLocation::default();
        let mut metrics = GlobalMetricsBuilder::new();

        metrics.set(GlobalMetric::Ascender, location.clone(), source.ascender);
        metrics.set(GlobalMetric::Descender, location.clone(), source.descender);
        metrics.set_if_some(GlobalMetric::CapHeight, location.clone(), source.cap_height);
        metrics.set_if_some(GlobalMetric::XHeight, location.clone(), source.x_height);
        metrics.set_if_some(GlobalMetric::HheaLineGap, location.clone(), source.line_gap);
        metrics.set_if_some(
            GlobalMetric::Os2TypoLineGap,
            location.clone(),
            source.line_gap,
        );
        metrics.set_if_some(
            GlobalMetric::UnderlinePosition,
            location.clone(),
            source.underline_position,
        );
        metrics.set_if_some(
            GlobalMetric::UnderlineThickness,
            location.clone(),
            source.underline_thickness,
        );
        metrics.populate_defaults(
            &location,
            metadata.units_per_em,
            source.x_height,
            Some(source.ascender),
            Some(source.descender),
            source.italic_angle,
        );

        context.global_metrics.set(metrics.build(&metadata.axes)?);
        Ok(())
    }
}

#[derive(Debug)]
pub(super) struct FeatureWork {
    snapshot: Arc<ShiftSnapshot>,
}

impl FeatureWork {
    pub fn new(snapshot: Arc<ShiftSnapshot>) -> Self {
        Self { snapshot }
    }
}

impl Work<Context, WorkId, Error> for FeatureWork {
    fn id(&self) -> WorkId {
        WorkId::Features
    }

    fn exec(&self, context: &Context) -> Result<(), Error> {
        let features = match self.snapshot.features.fea_source() {
            Some(source) => FeaturesSource::from_string(source.to_string()),
            None => FeaturesSource::empty(),
        };
        context.features.set(features);
        Ok(())
    }
}

#[derive(Debug)]
pub(super) struct ColorPaletteWork;

impl Work<Context, WorkId, Error> for ColorPaletteWork {
    fn id(&self) -> WorkId {
        WorkId::ColorPalettes
    }

    fn exec(&self, _context: &Context) -> Result<(), Error> {
        Ok(())
    }
}

#[derive(Debug)]
pub(super) struct ColorGlyphsWork;

impl Work<Context, WorkId, Error> for ColorGlyphsWork {
    fn id(&self) -> WorkId {
        WorkId::PaintGraph
    }

    fn exec(&self, _context: &Context) -> Result<(), Error> {
        Ok(())
    }
}
