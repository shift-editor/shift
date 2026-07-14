use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontdrasil::orchestration::{Access, Work};
use fontdrasil::types::Axes;
use fontir::error::Error;
use fontir::ir::{
    FeaturesSource, GdefCategories, GlobalMetric, GlobalMetricsBuilder, GlyphOrder, NameBuilder,
    StaticMetadata, DEFAULT_VENDOR_ID,
};
use fontir::orchestration::{Context, WorkId};
use write_fonts::types::NameId;

use super::axes::{normalized_source_location, to_ir_named_instances};
use super::source::ShiftSnapshot;
use super::stat::generated_stat_fea;

/// Establishes axes, global master locations, names, and preliminary glyph order.
///
/// Authored named instances lower from external locations; source names never
/// become products implicitly. The default source must be a master at the
/// normalized default location, and masters must occupy distinct locations.
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

        let ir_axes = Axes::from(self.snapshot.ir_axes.clone());
        let global_locations = self.global_locations(&ir_axes)?;
        let named_instances =
            to_ir_named_instances(&self.snapshot.named_instances, &self.snapshot.axes)
                .map_err(|message| Error::InvalidEntry("Shift named instance", message))?;
        let mut static_metadata = StaticMetadata::new(
            self.snapshot.metrics.units_per_em as u16,
            names.into_inner(),
            self.snapshot.ir_axes.clone(),
            named_instances,
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

impl StaticMetadataWork {
    fn global_locations(&self, axes: &Axes) -> Result<HashSet<NormalizedLocation>, Error> {
        if axes.is_empty() {
            return Ok(HashSet::from([NormalizedLocation::default()]));
        }

        let mut locations = HashMap::new();
        let mut found_default_source = false;
        for source in self
            .snapshot
            .sources
            .iter()
            .filter(|source| source.is_master())
        {
            let location = normalized_source_location(source, &self.snapshot.axes, axes)?;
            if source.id() == self.snapshot.default_source_id {
                found_default_source = true;
                if !location.is_default() {
                    return Err(Error::InvalidEntry(
                        "Shift default source",
                        format!(
                            "'{}' must be at the default location, got {location:?}",
                            source.name()
                        ),
                    ));
                }
            }

            if let Some(existing) = locations.insert(location, source.name()) {
                return Err(Error::InvalidEntry(
                    "Shift source location",
                    format!(
                        "master sources '{}' and '{}' have the same normalized location",
                        existing,
                        source.name()
                    ),
                ));
            }
        }

        if !found_default_source {
            return Err(Error::InvalidEntry(
                "Shift default source",
                "the default source is not a master source".to_string(),
            ));
        }

        Ok(locations.into_keys().collect())
    }
}

/// Emits Shift's font-wide metrics at the default location.
///
/// Shift does not yet model per-source metrics, so the resulting metrics remain
/// static even when glyph outlines vary.
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
        let location = metadata.default_location().clone();
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

/// Combines authored feature text with `STAT` syntax generated from axis labels.
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
        let authored = self.snapshot.features.fea_source().unwrap_or_default();
        let generated_stat = generated_stat_fea(&self.snapshot.axes)
            .map_err(|message| Error::InvalidEntry("Shift axis labels", message))?;

        let features = match generated_stat {
            Some(stat) if authored.trim().is_empty() => FeaturesSource::from_string(stat),
            Some(stat) => FeaturesSource::from_string(format!("{authored}\n\n{stat}")),
            None if authored.trim().is_empty() => FeaturesSource::empty(),
            None => FeaturesSource::from_string(authored.to_string()),
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
