use std::path::Path;
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontir::error::Error;
use fontir::orchestration::{Flags, IrWork};
use fontir::source::Source;
use shift_font::{FeatureData, FontMetadata, FontMetrics, Glyph, KerningData, SourceId};

use crate::traits::FontView;

use super::glyph::GlyphWork;
use super::kerning::{KerningGroupWork, KerningInstanceWork};
use super::metadata::{
    ColorGlyphsWork, ColorPaletteWork, FeatureWork, GlobalMetricsWork, StaticMetadataWork,
};

const MIN_UNITS_PER_EM: f64 = 16.0;
const MAX_UNITS_PER_EM: f64 = 16_384.0;

#[derive(Debug, thiserror::Error)]
pub(crate) enum ShiftIrSourceError {
    #[error("variable Shift fonts are not supported by direct TTF export yet ({axis_count} axes)")]
    UnsupportedVariations { axis_count: usize },

    #[error("the Shift font has no default source")]
    MissingDefaultSource,

    #[error("units per em must be a whole number in 16..=16384, got {value}")]
    InvalidUnitsPerEm { value: f64 },
}

#[derive(Clone, Debug)]
pub(crate) struct ShiftIrSource {
    snapshot: Arc<ShiftSnapshot>,
}

#[derive(Debug)]
pub(super) struct ShiftSnapshot {
    pub metadata: FontMetadata,
    pub metrics: FontMetrics,
    pub default_source_id: SourceId,
    pub glyphs: Vec<Glyph>,
    pub kerning: KerningData,
    pub features: FeatureData,
}

impl ShiftIrSource {
    pub(crate) fn from_font_view(font: &impl FontView) -> Result<Self, ShiftIrSourceError> {
        if !font.axes().is_empty() {
            return Err(ShiftIrSourceError::UnsupportedVariations {
                axis_count: font.axes().len(),
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

        Ok(Self {
            snapshot: Arc::new(ShiftSnapshot {
                metadata: font.metadata().clone(),
                metrics: *font.metrics(),
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
