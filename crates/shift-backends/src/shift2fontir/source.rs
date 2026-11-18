use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Tag;
use fontir::error::Error;
use fontir::ir::StaticMetadata;
use fontir::orchestration::{Flags, IrWork};
use fontir::source::Source;
use shift_font::{
    Axis, DesignLocation, FeatureData, FontMetadata, Glyph, GlyphLayer, Kerning, LayerLocation,
    LocatedLayer, MetricDefinition, NamedInstance, Source as ShiftSource, SourceId, SourceList,
};

use crate::glyph_category::GlyphCategories;
use crate::traits::FontView;
use write_fonts::tables::gdef::GlyphClassDef;

use shift_text::shaper_font::{AxisConversionError, ToGlyphClassDef, UnitsPerEm, to_ir_axes};

use super::axes::{normalized_design_location, normalized_source_location};
use super::glyph::GlyphWork;
use super::glyph_axes::{GlyphAxesError, HiddenAxes, normalized};
use super::kerning::{KerningInstanceWork, KerningLocationsWork};
use super::metadata::{
    ColorGlyphsWork, ColorPaletteWork, FeatureWork, GlobalMetricsWork, StaticMetadataWork,
};

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

    #[error("cannot place the font's components: {0}")]
    Placement(#[from] shift_font::CoreError),

    #[error("cannot compile the glyph axes: {0}")]
    GlyphAxes(#[from] GlyphAxesError),
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
    /// Every glyph's own axes, as the hidden axes they compile to.
    pub hidden_axes: HiddenAxes,
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

/// One of a glyph's drawings as a glyph source: the drawing and where it sits.
#[derive(Debug)]
pub(super) struct DrawingSource<'a> {
    pub located: LocatedLayer<'a>,
    /// Its base source's location with the drawing's own coordinates laid
    /// over it, in design units.
    pub design_location: DesignLocation,
    /// [`Self::design_location`] normalized over the compiled axes.
    pub location: NormalizedLocation,
}

impl DrawingSource<'_> {
    /// The drawing.
    pub(super) fn drawing(&self) -> &GlyphLayer {
        self.located.layer
    }
}

impl ShiftSnapshot {
    /// `glyph`'s drawings among the masters [`Self::glyph_masters`]
    /// returns, as [`Glyph::located_layers_on`] orders them, each at its
    /// own location: one exactly on a master at the master's location, and
    /// one located off the masters (a brace drawing, with or without a base
    /// source, or a drawing on the glyph's own axes) wherever its
    /// coordinates put it. The location names every one of the glyph's own
    /// axes by its [hidden tag](HiddenAxes). A master the glyph has no
    /// drawing on is skipped.
    ///
    /// # Errors
    ///
    /// Returns the conversion error when a location cannot be normalized.
    pub(super) fn drawing_sources<'a>(
        &self,
        glyph: &'a Glyph,
        masters: &'a [(&'a ShiftSource, NormalizedLocation)],
        metadata: &StaticMetadata,
    ) -> Result<Vec<DrawingSource<'a>>, Error> {
        glyph
            .located_layers_on(masters.iter().map(|(source, _)| *source))
            .filter_map(|located| {
                let design_location = self.layer_design_location(&located.location)?;
                let location = normalized_design_location(
                    &design_location,
                    &self.axes,
                    &metadata.all_source_axes,
                )
                .map(|mut location| {
                    for (tag, coord) in self.glyph_axis_coordinates(glyph, &design_location) {
                        location.insert(tag, coord);
                    }
                    DrawingSource {
                        located,
                        design_location,
                        location,
                    }
                });
                Some(location)
            })
            .collect()
    }

    /// `design_location` on `glyph`'s own axes, normalized and tagged as
    /// [`HiddenAxes`] compiles them; an axis it doesn't set is at its default.
    fn glyph_axis_coordinates<'a>(
        &'a self,
        glyph: &'a Glyph,
        design_location: &'a DesignLocation,
    ) -> impl Iterator<Item = (Tag, NormalizedCoord)> + 'a {
        glyph.axes().iter().filter_map(move |axis| {
            let ir_axis = self.hidden_axes.axis(axis.id())?;
            let value = design_location
                .get(&axis.id())
                .unwrap_or_else(|| axis.as_axis().default());
            Some((ir_axis.tag, normalized(ir_axis, value)))
        })
    }

    /// `location`'s base source location with its own coordinates laid
    /// over it: [`LayerLocation::design_location`] over the snapshot's
    /// sources. `None` when the base is a source the snapshot lacks.
    fn layer_design_location(&self, location: &LayerLocation) -> Option<DesignLocation> {
        let mut design = match location.base_source_id() {
            Some(base) => self.sources.source(base)?.location().clone(),
            None => DesignLocation::new(),
        };
        design.extend(
            location
                .coordinates()
                .iter()
                .map(|(axis_id, value)| (*axis_id, *value)),
        );
        Some(design)
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
        let units_per_em = UnitsPerEm::try_from(value)
            .map_err(|_| ShiftIrSourceError::InvalidUnitsPerEm { value })?
            .get();

        let ir_axes = to_ir_axes(font.axes(), font.axis_mappings())?;
        let font_tags: Vec<&str> = font.axes().iter().map(Axis::tag).collect();
        let hidden_axes = HiddenAxes::new(font.glyphs(), &font_tags)?;

        Ok(Self {
            snapshot: Arc::new(ShiftSnapshot {
                metadata: font.metadata().clone(),
                units_per_em,
                metric_definitions: font.metric_definitions().to_vec(),
                axes: font.axes().to_vec(),
                ir_axes,
                hidden_axes,
                named_instances: font.named_instances().to_vec(),
                sources: font.sources().to_vec(),
                default_source_id,
                // Export compiles each anchored component where its anchors place it.
                glyphs: font.glyphs_with_derived_placements()?,
                kerning: font.kerning().clone(),
                features: font.features().clone(),
                gdef_classes: GlyphCategories::new()
                    .classes(font.glyphs(), font.lib())
                    .gdef_classes(font.glyphs())
                    .into_iter()
                    .map(|(name, class)| (name, class.to_glyph_class_def()))
                    .collect(),
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

    /// Propagates component anchors into composites and erases open corners,
    /// as fontc does for Glyphs sources. fontc's frontends erase in their own
    /// path building, so `GlyphWork` erases; the flag records that it did.
    fn compilation_flags(&self) -> Flags {
        Flags::PROPAGATE_ANCHORS | Flags::ERASE_OPEN_CORNERS
    }
}
