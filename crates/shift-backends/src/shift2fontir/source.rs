use std::path::Path;
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontir::error::Error;
use fontir::orchestration::{Flags, IrWork};
use fontir::source::Source;
use shift_font::{
    Axis, FeatureData, FontMetadata, FontMetrics, Glyph, KerningData, MetricDefinition,
    NamedInstance, Source as ShiftSource, SourceId,
};

use crate::traits::FontView;

use super::axes::to_ir_axes;
use super::glyph::GlyphWork;
use super::kerning::{KerningGroupWork, KerningInstanceWork};
use super::metadata::{
    ColorGlyphsWork, ColorPaletteWork, FeatureWork, GlobalMetricsWork, StaticMetadataWork,
};

const MIN_UNITS_PER_EM: f64 = 16.0;
const MAX_UNITS_PER_EM: f64 = 16_384.0;

/// Describes a Shift font that cannot become an in-memory fontir source.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ShiftIrSourceError {
    #[error(
        "cross-axis mappings require OpenType avar version 2, which this compiler does not support yet ({mapping_count} mappings)"
    )]
    UnsupportedCrossAxisMappings { mapping_count: usize },

    #[error("invalid Shift variation model: {message}")]
    InvalidVariations { message: String },

    #[error("the Shift font has no default source")]
    MissingDefaultSource,

    #[error("units per em must be a whole number in 16..=16384, got {value}")]
    InvalidUnitsPerEm { value: f64 },
}

/// Provides fontir work backed by an immutable, shared Shift snapshot.
///
/// Clones share the snapshot through [`Arc`] and never read the originating
/// [`FontView`] again. The source is constructed from memory; fontir's
/// path-based [`Source::new`] constructor is intentionally unsupported.
#[derive(Clone, Debug)]
pub(crate) struct ShiftIrSource {
    snapshot: Arc<ShiftSnapshot>,
}

/// Owns the Shift values shared by all work items in one compilation.
#[derive(Debug)]
pub(super) struct ShiftSnapshot {
    pub metadata: FontMetadata,
    pub metrics: FontMetrics,
    pub metric_definitions: Vec<MetricDefinition>,
    pub axes: Vec<Axis>,
    pub ir_axes: Vec<fontdrasil::types::Axis>,
    pub named_instances: Vec<NamedInstance>,
    pub sources: Vec<ShiftSource>,
    pub default_source_id: SourceId,
    pub glyphs: Vec<Glyph>,
    pub kerning: KerningData,
    pub features: FeatureData,
}

impl ShiftIrSource {
    /// Freezes a font view into the representation consumed by fontir work.
    ///
    /// # Errors
    ///
    /// Returns [`ShiftIrSourceError`] when the font lacks a default source, has
    /// an invalid units-per-em value or variation model, or contains a
    /// cross-axis mapping unsupported by the compiler.
    pub(crate) fn from_font_view(font: &impl FontView) -> Result<Self, ShiftIrSourceError> {
        let cross_axis_mapping_count = font
            .axis_mappings()
            .iter()
            .filter(|mapping| !mapping.is_independent())
            .count();
        if cross_axis_mapping_count > 0 {
            return Err(ShiftIrSourceError::UnsupportedCrossAxisMappings {
                mapping_count: cross_axis_mapping_count,
            });
        }

        let default_source_id = font
            .default_source_id()
            .ok_or(ShiftIrSourceError::MissingDefaultSource)?;
        let units_per_em = font.metrics().units_per_em;
        if !(MIN_UNITS_PER_EM..=MAX_UNITS_PER_EM).contains(&units_per_em)
            || units_per_em.fract() != 0.0
        {
            return Err(ShiftIrSourceError::InvalidUnitsPerEm {
                value: units_per_em,
            });
        }

        let ir_axes = to_ir_axes(font.axes(), font.axis_mappings())
            .map_err(|message| ShiftIrSourceError::InvalidVariations { message })?;

        Ok(Self {
            snapshot: Arc::new(ShiftSnapshot {
                metadata: font.metadata().clone(),
                metrics: *font.metrics(),
                metric_definitions: font.metric_definitions().to_vec(),
                axes: font.axes().to_vec(),
                ir_axes,
                named_instances: font.named_instances().to_vec(),
                sources: font.sources().to_vec(),
                default_source_id,
                glyphs: font.glyphs().into_iter().cloned().collect(),
                kerning: font.kerning().clone(),
                features: font.features().clone(),
            }),
        })
    }
}

impl Source for ShiftIrSource {
    fn new(_root: &Path) -> Result<Self, Error>
    where
        Self: Sized,
    {
        Err(Error::UnsupportedConstruct(
            "ShiftIrSource is created from an in-memory Shift font".to_string(),
        ))
    }

    fn create_static_metadata_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(StaticMetadataWork::new(self.snapshot.clone())))
    }

    fn create_global_metric_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(GlobalMetricsWork::new(self.snapshot.clone())))
    }

    fn create_glyph_ir_work(&self) -> Result<Vec<Box<IrWork>>, Error> {
        Ok(self
            .snapshot
            .glyphs
            .iter()
            .cloned()
            .map(|glyph| Box::new(GlyphWork::new(self.snapshot.clone(), glyph)) as Box<IrWork>)
            .collect())
    }

    fn create_feature_ir_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(FeatureWork::new(self.snapshot.clone())))
    }

    fn create_kerning_group_ir_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(KerningGroupWork::new(self.snapshot.clone())))
    }

    fn create_kerning_instance_ir_work(
        &self,
        at: NormalizedLocation,
    ) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(KerningInstanceWork::new(
            self.snapshot.clone(),
            at,
        )))
    }

    fn create_color_palette_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(ColorPaletteWork))
    }

    fn create_color_glyphs_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(ColorGlyphsWork))
    }

    fn compilation_flags(&self) -> Flags {
        Flags::empty()
    }
}
