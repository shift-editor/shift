//! Compiles a font's authored OpenType features into a shaper font.
//!
//! A shaper font is a minimal binary for shaping live text: `GSUB`, `GPOS`,
//! and `GDEF` compiled from the authored feature source, `head`, and, for a
//! variable font, `fvar` with its axis names. `GDEF` glyph classes come from
//! glyph categories unless the feature source declares its own.
//!
//! It has no outlines, `cmap`, or `hmtx`: a shaper supplies character mapping
//! and advances from the live font, so outline and advance edits never require
//! a rebuild. Glyph ids in the binary index [`ShaperFont::glyph_names`].
//! [`LiveShaper`] shapes text with it, mapping characters through the live
//! font and returning only what the features contribute.
//!
//! Only authored feature code is compiled. Kerning, mark attachment, and
//! `STAT`, which export generates from structured data, are absent; insert
//! markers record where generated lookups would have gone.
//!
//! Adapted from Fontra's `build-shaper-font` (Apache-2.0).

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly module the editor compiles with. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod axes;
mod diagnostics;
mod references;
mod shape;
mod state;
mod tables;

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fea_rs::compile::error::GlyphOrderError;
use fea_rs::compile::{self, NopFeatureProvider, Opts};
use fea_rs::parse::{ParseTree, SourceLoadError, parse_root};
use fea_rs::{DiagnosticSet, GlyphMap};
use fontbe::features::FeaVariationInfo;
use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Axis as IrAxis;
use fontdrasil::variations::VariationModelError;
use fontir::ir::StaticMetadata;
use shift_font::{AxisId, GlyphId, OpenTypeCategory, ShaperFontSource};
use shift_shape::AxisNormalization;
use write_fonts::BuilderError;
use write_fonts::tables::gdef::GlyphClassDef;
use write_fonts::types::Tag;

pub use axes::{AxisConversionError, MappingSide, axis_tag, to_ir_axes};
pub use diagnostics::{DiagnosticSeverity, FeatureDiagnostic};
pub use shape::{
    FeatureSetting, LiveShaper, ParagraphRequest, ShapeError, ShapeRequest, ShapeUnit, ShapedGlyph,
    ShapedRun, TextDirection,
};
pub use state::ShaperFontState;

use diagnostics::feature_diagnostics;
use references::FeatureReferences;

/// Path fea-rs reports for the authored feature source.
const FEATURE_SOURCE_PATH: &str = "features.fea";

/// Glyph that every shaper font places at glyph id 0.
const NOTDEF: &str = ".notdef";

const MIN_UNITS_PER_EM: f64 = 16.0;
const MAX_UNITS_PER_EM: f64 = 16_384.0;

/// Converts units per em to the `head` value, or `None` when it is not a
/// whole number from 16 to 16384.
pub fn units_per_em(value: f64) -> Option<u16> {
    let valid = value.fract() == 0.0 && (MIN_UNITS_PER_EM..=MAX_UNITS_PER_EM).contains(&value);
    // In range and whole, so the conversion is exact.
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "checked whole and within 16..=16384 above"
    )]
    valid.then_some(value as u16)
}

/// The `GDEF` glyph class write-fonts writes for `class`.
pub fn glyph_class_def(class: OpenTypeCategory) -> GlyphClassDef {
    match class {
        OpenTypeCategory::Base => GlyphClassDef::Base,
        OpenTypeCategory::Ligature => GlyphClassDef::Ligature,
        OpenTypeCategory::Mark => GlyphClassDef::Mark,
        OpenTypeCategory::Component => GlyphClassDef::Component,
    }
}

/// Everything a shaper font is compiled from.
///
/// Two requests compare equal exactly when they compile to the same shaper
/// font, so a caller can skip rebuilding for an unchanged request.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFontRequest {
    units_per_em: u16,
    glyph_names: Vec<String>,
    /// The Shift glyph for each name in `glyph_names`; `None` for a `.notdef`
    /// the font does not have.
    glyph_ids: Vec<Option<GlyphId>>,
    feature_source: String,
    axes: Vec<IrAxis>,
    /// The Shift axis for each axis in `axes`.
    axis_ids: Vec<AxisId>,
    gdef_classes: BTreeMap<String, GlyphClassDef>,
}

impl ShaperFontRequest {
    /// Collects what a shaper font is compiled from out of `source`: its
    /// glyph order, feature source, units per em, axes with their independent
    /// mappings, and each glyph's `GDEF` class.
    ///
    /// `.notdef` is moved, or added, to the front of the glyph order.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError::InvalidUnitsPerEm`] when units per em is not
    /// a whole number from 16 to 16384, and [`ShaperFontError::InvalidAxes`]
    /// when an axis or its mapping cannot define a coordinate converter.
    pub fn new(source: &ShaperFontSource) -> Result<Self, ShaperFontError> {
        let value = source.units_per_em;
        let units_per_em =
            units_per_em(value).ok_or(ShaperFontError::InvalidUnitsPerEm { value })?;
        let axes = to_ir_axes(&source.axes, &source.axis_mappings)?;
        let notdef = source
            .glyphs
            .iter()
            .find(|glyph| glyph.name.as_str() == NOTDEF);
        let (glyph_names, glyph_ids) =
            std::iter::once((NOTDEF.to_string(), notdef.map(|glyph| glyph.id)))
                .chain(
                    source
                        .glyphs
                        .iter()
                        .filter(|glyph| glyph.name.as_str() != NOTDEF)
                        .map(|glyph| (glyph.name.to_string(), Some(glyph.id))),
                )
                .unzip();

        Ok(Self {
            units_per_em,
            glyph_names,
            glyph_ids,
            feature_source: source.feature_source.clone(),
            axes,
            axis_ids: source.axes.iter().map(shift_font::Axis::id).collect(),
            gdef_classes: source
                .glyphs
                .iter()
                .filter_map(|glyph| {
                    Some((glyph.name.to_string(), glyph_class_def(glyph.gdef_class?)))
                })
                .collect(),
        })
    }

    /// Returns the variation model fea-rs needs to resolve variable values, or
    /// `None` for a static font.
    fn variation_metadata(&self) -> Result<Option<StaticMetadata>, VariationModelError> {
        if self.axes.is_empty() {
            return Ok(None);
        }

        let default_location: NormalizedLocation = self
            .axes
            .iter()
            .map(|axis| (axis.tag, NormalizedCoord::new(0.0)))
            .collect();
        let metadata = StaticMetadata::new(
            self.units_per_em,
            Default::default(),
            self.axes.clone(),
            Vec::new(),
            HashSet::from([default_location]),
            None,
            0.0,
            None,
            false,
        )?;
        Ok(Some(metadata))
    }

    /// Returns this request with no feature source, which always compiles.
    fn without_features(&self) -> Self {
        Self {
            feature_source: String::new(),
            ..self.clone()
        }
    }
}

/// A compiled shaper font.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFont {
    bytes: Vec<u8>,
    glyph_names: Vec<String>,
    glyph_ids: Vec<Option<GlyphId>>,
    axes: Vec<IrAxis>,
    axis_ids: Vec<AxisId>,
    insert_markers: Vec<InsertMarker>,
}

impl ShaperFont {
    /// Compiles the authored features of `request` into a shaper font.
    ///
    /// Feature source is parsed, validated against the glyph order and axes,
    /// and compiled; the first stage that reports an error ends compilation
    /// without a font. `include` statements are reported as errors because
    /// the source is self-contained.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError`] when the glyph order has duplicate names,
    /// or the axes or compiled tables cannot be assembled into a font.
    pub fn compile(request: &ShaperFontRequest) -> Result<ShaperFontCompilation, ShaperFontError> {
        let glyph_map = GlyphMap::new(request.glyph_names.iter().map(String::as_str))?;

        let (tree, parse_diagnostics) = parse_feature_source(&request.feature_source, &glyph_map)?;
        if parse_diagnostics.has_errors() {
            // What a source that does not parse names is unknown, so any
            // glyph change may let it compile.
            return Ok(ShaperFontCompilation::failed(
                &parse_diagnostics,
                &tree,
                FeatureReferences::every_glyph(),
            ));
        }
        let references = FeatureReferences::of(&tree);

        let static_metadata = request.variation_metadata()?;
        let variation_info = static_metadata.as_ref().map(FeaVariationInfo::new);
        let validation = compile::validate(&tree, &glyph_map, variation_info.as_ref());
        if validation.has_errors() {
            return Ok(ShaperFontCompilation::failed(
                &validation,
                &tree,
                references,
            ));
        }

        let compiled = compile::compile(
            &tree,
            &glyph_map,
            variation_info.as_ref(),
            None::<&NopFeatureProvider>,
            Opts::default(),
        );
        let (mut compilation, warnings) = match compiled {
            Ok(compiled) => compiled,
            Err(errors) => {
                return Ok(ShaperFontCompilation::failed(&errors, &tree, references));
            }
        };

        tables::add_glyph_classes(&mut compilation, &glyph_map, &request.gdef_classes);
        compilation
            .head
            .get_or_insert_with(Default::default)
            .units_per_em = request.units_per_em;
        let fvar = match static_metadata {
            Some(_) => Some(tables::add_axis_names(&mut compilation, &request.axes)?),
            None => None,
        };

        let mut builder = compilation.to_font_builder()?;
        if let Some(fvar) = &fvar {
            builder.add_table(fvar)?;
        }

        Ok(ShaperFontCompilation {
            font: Some(Self {
                bytes: builder.build(),
                glyph_names: request.glyph_names.clone(),
                glyph_ids: request.glyph_ids.clone(),
                axes: request.axes.clone(),
                axis_ids: request.axis_ids.clone(),
                insert_markers: tables::insert_markers(&compilation, &tree),
            }),
            diagnostics: feature_diagnostics(&warnings, &tree),
            references,
        })
    }

    /// Returns the font binary.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Returns the glyph name for each glyph id, with `.notdef` at id 0.
    pub fn glyph_names(&self) -> &[String] {
        &self.glyph_names
    }

    /// Returns the Shift glyph at each shaper glyph id, in glyph order;
    /// `None` for a `.notdef` the font does not have.
    pub fn glyph_ids(&self) -> &[Option<GlyphId>] {
        &self.glyph_ids
    }

    /// Returns how each axis's user coordinates normalize, in `fvar` order,
    /// from the axis's mapping points.
    pub fn axis_normalizations(&self) -> Vec<(AxisId, AxisNormalization)> {
        self.axes
            .iter()
            .zip(&self.axis_ids)
            .map(|(axis, axis_id)| {
                let points = axis
                    .converter
                    .iter()
                    .map(|(user, _, normalized)| (user.to_f64(), normalized.to_f64()))
                    .collect();
                (*axis_id, AxisNormalization::new(points))
            })
            .collect()
    }

    /// Returns where each generated feature belongs among the authored
    /// lookups, ordered by insertion priority.
    pub fn insert_markers(&self) -> &[InsertMarker] {
        &self.insert_markers
    }
}

/// Where lookups for a generated feature (`curs`, `kern`, `mark`, or `mkmk`)
/// belong in the compiled lookup list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InsertMarker {
    pub tag: Tag,
    /// Index of the authored lookup the generated lookups precede, from an
    /// `# Automatic Code` comment. `None` when the source neither marks a
    /// position nor defines the feature itself, so the generated lookups
    /// follow every authored lookup.
    pub lookup_index: Option<usize>,
}

/// The outcome of compiling one [`ShaperFontRequest`].
///
/// Feature source with errors is a normal authoring state, not a failure: the
/// compilation then has no font and at least one error diagnostic. A
/// successful compilation may still carry warnings.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFontCompilation {
    pub font: Option<ShaperFont>,
    pub diagnostics: Vec<FeatureDiagnostic>,
    /// The glyphs the feature source names, which decide whether a later
    /// glyph change needs a recompile.
    references: FeatureReferences,
}

impl ShaperFontCompilation {
    fn failed(
        diagnostics: &DiagnosticSet,
        tree: &ParseTree,
        references: FeatureReferences,
    ) -> Self {
        Self {
            font: None,
            diagnostics: feature_diagnostics(diagnostics, tree),
            references,
        }
    }
}

/// Describes a shaper-font failure that is not a problem in the feature
/// source.
#[derive(Debug, thiserror::Error)]
pub enum ShaperFontError {
    #[error("units per em must be a whole number from 16 to 16384, got {value}")]
    InvalidUnitsPerEm { value: f64 },

    #[error("cannot build shaper font axes: {0}")]
    InvalidAxes(#[from] AxisConversionError),

    #[error("cannot build the variation model for shaper font axes")]
    VariationModel(#[from] VariationModelError),

    #[error("invalid glyph order")]
    GlyphOrder(#[from] GlyphOrderError),

    #[error("cannot load the feature source")]
    SourceLoad(#[from] SourceLoadError),

    #[error("too many name records to name the shaper font axes")]
    NameIdOverflow,

    #[error("cannot assemble the shaper font")]
    Assembly(#[from] BuilderError),
}

/// Parses `source` as the only file of the feature source; any `include` is
/// reported as a diagnostic.
fn parse_feature_source(
    source: &str,
    glyph_map: &GlyphMap,
) -> Result<(ParseTree, DiagnosticSet), SourceLoadError> {
    let root: Arc<str> = source.into();
    parse_root(
        PathBuf::from(FEATURE_SOURCE_PATH),
        Some(glyph_map),
        Box::new(move |path: &Path| {
            if path == Path::new(FEATURE_SOURCE_PATH) {
                return Ok(Arc::clone(&root));
            }

            Err(SourceLoadError::new(
                path.to_path_buf(),
                "feature source cannot include other files",
            ))
        }),
    )
}

#[cfg(test)]
mod shape_tests;
#[cfg(test)]
mod tests;

/// Reads requests and character mappings out of test fonts, classing glyphs by
/// their own categories.
#[cfg(test)]
mod test_fonts {
    use shift_font::{Font, GlyphDataCategory, GlyphId, OpenTypeCategory};

    use super::{ShaperFontError, ShaperFontRequest};

    pub(crate) fn request_for(font: &Font) -> Result<ShaperFontRequest, ShaperFontError> {
        ShaperFontRequest::new(&font.shaper_font_source(|glyph| {
            OpenTypeCategory::of(
                glyph,
                GlyphDataCategory::default(),
                None,
                glyph.has_attaching_anchor(),
            )
        }))
    }

    /// Each character the font's glyphs claim, with the glyph claiming it.
    pub(crate) fn characters_of(font: &Font) -> Vec<(u32, GlyphId)> {
        font.glyphs()
            .flat_map(|glyph| {
                glyph
                    .unicodes()
                    .iter()
                    .map(move |&codepoint| (codepoint, glyph.id()))
            })
            .collect()
    }
}
