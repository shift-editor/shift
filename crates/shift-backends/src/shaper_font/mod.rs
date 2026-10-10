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
//!
//! Only authored feature code is compiled. Kerning, mark attachment, and
//! `STAT`, which export generates from structured data, are absent; insert
//! markers record where generated lookups would have gone.
//!
//! Adapted from Fontra's `build-shaper-font` (Apache-2.0).

mod diagnostics;
mod state;
mod tables;

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fea_rs::compile::error::GlyphOrderError;
use fea_rs::compile::{self, NopFeatureProvider, Opts};
use fea_rs::parse::{parse_root, ParseTree, SourceLoadError};
use fea_rs::{DiagnosticSet, GlyphMap};
use fontbe::features::FeaVariationInfo;
use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Axis as IrAxis;
use fontdrasil::variations::VariationModelError;
use fontir::ir::StaticMetadata;
use write_fonts::tables::gdef::GlyphClassDef;
use write_fonts::types::Tag;
use write_fonts::BuilderError;

pub use diagnostics::{DiagnosticSeverity, FeatureDiagnostic};
pub use state::ShaperFontState;

use crate::glyph_category::gdef_classes;
use crate::shift2fontir::{to_ir_axes, units_per_em};
use crate::traits::FontView;
use diagnostics::feature_diagnostics;

/// Path fea-rs reports for the authored feature source.
const FEATURE_SOURCE_PATH: &str = "features.fea";

/// Glyph that every shaper font places at glyph id 0.
const NOTDEF: &str = ".notdef";

/// Everything a shaper font is compiled from.
///
/// Two requests compare equal exactly when they compile to the same shaper
/// font, so a caller can skip rebuilding for an unchanged request.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFontRequest {
    units_per_em: u16,
    glyph_names: Vec<String>,
    feature_source: String,
    axes: Vec<IrAxis>,
    gdef_classes: BTreeMap<String, GlyphClassDef>,
}

impl ShaperFontRequest {
    /// Collects the shaper-font inputs of a font: its glyph order, authored
    /// feature source, units per em, axes with their independent mappings,
    /// and the `GDEF` class each glyph's category resolves to.
    ///
    /// `.notdef` is moved, or added, to the front of the glyph order.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError::InvalidUnitsPerEm`] when units per em is not
    /// a whole number from 16 to 16384, and [`ShaperFontError::InvalidAxes`]
    /// when an axis or its mapping cannot define a coordinate converter.
    pub fn from_font(font: &impl FontView) -> Result<Self, ShaperFontError> {
        let value = font.metrics().units_per_em;
        let units_per_em =
            units_per_em(value).ok_or(ShaperFontError::InvalidUnitsPerEm { value })?;
        let axes = to_ir_axes(font.axes(), font.axis_mappings())
            .map_err(|message| ShaperFontError::InvalidAxes { message })?;
        let glyph_names = std::iter::once(NOTDEF)
            .chain(
                font.glyphs()
                    .into_iter()
                    .map(|glyph| glyph.name())
                    .filter(|name| *name != NOTDEF),
            )
            .map(str::to_string)
            .collect();

        Ok(Self {
            units_per_em,
            glyph_names,
            feature_source: font.features().fea_source().unwrap_or_default().to_string(),
            axes,
            gdef_classes: gdef_classes(font.glyphs(), font.lib()),
        })
    }
}

/// A compiled shaper font.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFont {
    bytes: Vec<u8>,
    glyph_names: Vec<String>,
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
            return Ok(ShaperFontCompilation::failed(&parse_diagnostics, &tree));
        }

        let static_metadata = variation_metadata(request)?;
        let variation_info = static_metadata.as_ref().map(FeaVariationInfo::new);
        let validation = compile::validate(&tree, &glyph_map, variation_info.as_ref());
        if validation.has_errors() {
            return Ok(ShaperFontCompilation::failed(&validation, &tree));
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
            Err(errors) => return Ok(ShaperFontCompilation::failed(&errors, &tree)),
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
                insert_markers: tables::insert_markers(&compilation, &tree),
            }),
            diagnostics: feature_diagnostics(&warnings, &tree),
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
}

impl ShaperFontCompilation {
    fn failed(diagnostics: &DiagnosticSet, tree: &ParseTree) -> Self {
        Self {
            font: None,
            diagnostics: feature_diagnostics(diagnostics, tree),
        }
    }
}

/// Describes a shaper-font failure that is not a problem in the feature
/// source.
#[derive(Debug, thiserror::Error)]
pub enum ShaperFontError {
    #[error("units per em must be a whole number from 16 to 16384, got {value}")]
    InvalidUnitsPerEm { value: f64 },

    #[error("cannot build shaper font axes: {message}")]
    InvalidAxes { message: String },

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
                return Ok(root.clone());
            }

            Err(SourceLoadError::new(
                path.to_path_buf(),
                "feature source cannot include other files",
            ))
        }),
    )
}

/// Returns the variation model fea-rs needs to resolve variable values, or
/// `None` for a static font.
fn variation_metadata(
    request: &ShaperFontRequest,
) -> Result<Option<StaticMetadata>, VariationModelError> {
    if request.axes.is_empty() {
        return Ok(None);
    }

    let default_location: NormalizedLocation = request
        .axes
        .iter()
        .map(|axis| (axis.tag, NormalizedCoord::new(0.0)))
        .collect();
    let metadata = StaticMetadata::new(
        request.units_per_em,
        Default::default(),
        request.axes.clone(),
        Vec::new(),
        HashSet::from([default_location]),
        None,
        0.0,
        None,
        false,
    )?;
    Ok(Some(metadata))
}

#[cfg(test)]
mod tests;
