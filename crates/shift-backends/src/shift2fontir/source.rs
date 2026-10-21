use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use fontdrasil::coords::NormalizedLocation;
use fontir::error::Error;
use fontir::ir::StaticMetadata;
use fontir::orchestration::{Flags, IrWork};
use fontir::source::Source;
use shift_font::{
    Axis, FeatureData, FontMetadata, Glyph, Kerning, MetricDefinition, NamedInstance,
    Source as ShiftSource, SourceId,
};

use crate::glyph_category::{GlyphCategories, gdef_classes};
use crate::traits::FontView;
use write_fonts::tables::gdef::GlyphClassDef;

use super::axes::{AxisConversionError, normalized_source_location, to_ir_axes};
use super::glyph::GlyphWork;
use super::kerning::{KerningInstanceWork, KerningLocationsWork};
use super::metadata::{
    ColorGlyphsWork, ColorPaletteWork, FeatureWork, GlobalMetricsWork, StaticMetadataWork,
};

const MIN_UNITS_PER_EM: f64 = 16.0;
const MAX_UNITS_PER_EM: f64 = 16_384.0;

/// Converts units per em to the `head` value, or `None` when it is not a
/// whole number from 16 to 16384.
pub(crate) fn units_per_em(value: f64) -> Option<u16> {
    let valid = value.fract() == 0.0 && (MIN_UNITS_PER_EM..=MAX_UNITS_PER_EM).contains(&value);
    // In range and whole, so the conversion is exact.
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "checked whole and within 16..=16384 above"
    )]
    valid.then_some(value as u16)
}

/// Describes a Shift font that cannot become an in-memory fontir source.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ShiftIrSourceError {
    #[error(
        "cross-axis mappings require OpenType avar version 2, which this compiler does not support yet ({mapping_count} mappings)"
    )]
    UnsupportedCrossAxisMappings { mapping_count: usize },

    #[error("invalid Shift variation model: {0}")]
    InvalidVariations(#[from] AxisConversionError),

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
    /// The `head` units per em, validated from the font's metrics.
    pub units_per_em: u16,
    pub metric_definitions: Vec<MetricDefinition>,
    pub axes: Vec<Axis>,
    pub ir_axes: Vec<fontdrasil::types::Axis>,
    pub named_instances: Vec<NamedInstance>,
    pub sources: Vec<ShiftSource>,
    pub default_source_id: SourceId,
    pub glyphs: Vec<Glyph>,
    pub kerning: Kerning,
    pub features: FeatureData,
    /// GDEF class for each glyph that has one, by name.
    pub gdef_classes: BTreeMap<String, GlyphClassDef>,
    /// Glyphs whose advance compiles to zero, as Glyphs does for nonspacing marks.
    pub nonspacing_marks: HashSet<String>,
    /// Glyphs in the Mark category, whatever their subcategory; anchor
    /// propagation returns such a glyph's own anchors as they are.
    pub mark_category_glyphs: HashSet<String>,
    /// Glyphs the source marks as not exported, by name. They stay available
    /// as components, which the compiler decomposes, but are not emitted.
    pub skipped_glyphs: HashSet<String>,
}

impl ShiftSnapshot {
    /// The master sources a glyph compiles at, with their normalized locations.
    ///
    /// A font without axes compiles its default source only.
    ///
    /// # Errors
    ///
    /// Returns the conversion error when a source location cannot be normalized.
    pub(super) fn glyph_masters(
        &self,
        metadata: &StaticMetadata,
    ) -> Result<Vec<(&ShiftSource, NormalizedLocation)>, Error> {
        self.sources
            .iter()
            .filter(|source| source.is_master())
            .filter(|source| !metadata.axes.is_empty() || source.id() == self.default_source_id)
            .map(|source| {
                normalized_source_location(source, &self.axes, &metadata.all_source_axes)
                    .map(|location| (source, location))
            })
            .collect()
    }
}

impl ShiftIrSource {
    pub(super) fn snapshot(&self) -> &ShiftSnapshot {
        &self.snapshot
    }

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
        let value = font.metrics().units_per_em;
        let Some(units_per_em) = units_per_em(value) else {
            return Err(ShiftIrSourceError::InvalidUnitsPerEm { value });
        };

        let ir_axes = to_ir_axes(font.axes(), font.axis_mappings())?;

        Ok(Self {
            snapshot: Arc::new(ShiftSnapshot {
                metadata: font.metadata().clone(),
                units_per_em,
                metric_definitions: font.metric_definitions().to_vec(),
                axes: font.axes().to_vec(),
                ir_axes,
                named_instances: font.named_instances().to_vec(),
                sources: font.sources().to_vec(),
                default_source_id,
                glyphs: font.glyphs().cloned().collect(),
                kerning: font.kerning().clone(),
                features: font.features().clone(),
                gdef_classes: gdef_classes(font.glyphs(), font.lib()),
                nonspacing_marks: {
                    let categories = GlyphCategories::new();
                    font.glyphs()
                        .filter(|glyph| categories.resolve(glyph).is_nonspacing_mark())
                        .map(|glyph| glyph.name().to_string())
                        .collect()
                },
                mark_category_glyphs: {
                    let categories = GlyphCategories::new();
                    font.glyphs()
                        .filter(|glyph| categories.resolve(glyph).is_mark())
                        .map(|glyph| glyph.name().to_string())
                        .collect()
                },
                skipped_glyphs: font
                    .lib()
                    .skipped_export_glyphs()
                    .into_iter()
                    .map(str::to_string)
                    .collect(),
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
        Ok(Box::new(StaticMetadataWork::new(Arc::clone(
            &self.snapshot,
        ))))
    }

    fn create_global_metric_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(GlobalMetricsWork::new(Arc::clone(&self.snapshot))))
    }

    fn create_glyph_ir_work(&self) -> Result<Vec<Box<IrWork>>, Error> {
        Ok(self
            .snapshot
            .glyphs
            .iter()
            .cloned()
            .map(|glyph| Box::new(GlyphWork::new(Arc::clone(&self.snapshot), glyph)) as Box<IrWork>)
            .collect())
    }

    fn create_feature_ir_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(FeatureWork::new(Arc::clone(&self.snapshot))))
    }

    fn create_kerning_locations_ir_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(KerningLocationsWork::new(Arc::clone(
            &self.snapshot,
        ))))
    }

    fn create_kerning_instance_ir_work(
        &self,
        at: NormalizedLocation,
    ) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(KerningInstanceWork::new(
            Arc::clone(&self.snapshot),
            at,
        )))
    }

    fn create_color_palette_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(ColorPaletteWork))
    }

    fn create_color_glyphs_work(&self) -> Result<Box<IrWork>, Error> {
        Ok(Box::new(ColorGlyphsWork))
    }

    /// Propagates component anchors into composites, as fontc does for Glyphs sources.
    fn compilation_flags(&self) -> Flags {
        Flags::PROPAGATE_ANCHORS
    }
}
