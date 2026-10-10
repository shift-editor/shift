//! Compiles a font's authored OpenType features into a shaper font.
//!
//! A shaper font is a minimal binary for shaping live text: `GSUB`, `GPOS`,
//! and `GDEF` compiled from the authored feature source, `head`, and, for a
//! variable font, `fvar` with its axis names. `GDEF` glyph classes come from
//! glyph categories unless the feature source declares its own. It has no
//! outlines, `cmap`, or
//! `hmtx`; a shaper supplies character mapping and advances from the live
//! font instead, so outline and advance edits never require a rebuild. Glyph ids in
//! the binary index [`ShaperFont::glyph_names`].
//!
//! Only authored feature code is compiled. Kerning, mark attachment, and
//! `STAT`, which export generates from structured data, are absent; fea-rs
//! insert markers record where generated lookups would have gone.
//!
//! Adapted from Fontra's `build-shaper-font` (Apache-2.0).

use std::collections::{BTreeMap, HashSet};
use std::ops::Range;
use std::path::Path;
use std::sync::Arc;

use fea_rs::compile::{self, NopFeatureProvider, Opts};
use fea_rs::parse::{parse_root, ParseTree, SourceLoadError};
use fea_rs::typed::{AstNode, Feature};
use fea_rs::{DiagnosticSet, GlyphMap};
use fontbe::features::FeaVariationInfo;
use fontdrasil::coords::{NormalizedCoord, NormalizedLocation};
use fontdrasil::types::Axis as IrAxis;
use fontir::ir::StaticMetadata;
use write_fonts::tables::fvar::{AxisInstanceArrays, Fvar, VariationAxisRecord};
use write_fonts::tables::gdef::GlyphClassDef;
use write_fonts::tables::layout::ClassDef;
use write_fonts::tables::name::NameRecord;
use write_fonts::types::NameId;

use crate::glyph_category::gdef_classes;
use crate::shift2fontir::to_ir_axes;
use crate::traits::FontView;

/// Path fea-rs reports for the authored feature source.
const FEATURE_SOURCE_PATH: &str = "features.fea";

/// Glyph that every shaper font places at glyph id 0.
const NOTDEF: &str = ".notdef";

/// Features export generates from structured kerning and anchors, in the
/// order a feature writer would insert them.
const GENERATED_FEATURES: [&str; 4] = ["curs", "kern", "mark", "mkmk"];

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
        let units_per_em = units_per_em(font.metrics().units_per_em)?;
        let axes = to_ir_axes(font.axes(), font.axis_mappings())
            .map_err(|message| ShaperFontError::InvalidAxes { message })?;
        let mut glyph_names = vec![NOTDEF.to_string()];
        glyph_names.extend(
            font.glyphs()
                .into_iter()
                .map(|glyph| glyph.name().to_string())
                .filter(|name| name != NOTDEF),
        );

        Ok(Self {
            units_per_em,
            glyph_names,
            feature_source: font.features().fea_source().unwrap_or_default().to_string(),
            axes,
            gdef_classes: gdef_classes(font.glyphs(), font.lib()),
        })
    }
}

fn units_per_em(value: f64) -> Result<u16, ShaperFontError> {
    let valid = value.fract() == 0.0 && (16.0..=16384.0).contains(&value);
    if !valid {
        return Err(ShaperFontError::InvalidUnitsPerEm { value });
    }

    Ok(value as u16)
}

/// A compiled shaper font.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFont {
    bytes: Vec<u8>,
    glyph_names: Vec<String>,
    insert_markers: Vec<InsertMarker>,
}

impl ShaperFont {
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsertMarker {
    /// OpenType feature tag.
    pub tag: String,
    /// Index of the authored lookup the generated lookups precede, from an
    /// `# Automatic Code` comment. `None` when the source neither marks a
    /// position nor defines the feature itself, so the generated lookups
    /// follow every authored lookup.
    pub lookup_index: Option<usize>,
}

/// How serious a [`FeatureDiagnostic`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

/// One parse, validation, or compilation message about the feature source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureDiagnostic {
    pub severity: DiagnosticSeverity,
    pub message: String,
    /// Source range in UTF-16 code units, the offsets JavaScript strings and
    /// code editors use.
    pub range: Range<usize>,
}

/// The outcome of compiling one [`ShaperFontRequest`].
///
/// Feature source with errors is a normal authoring state, not a failure: the
/// compilation then has no font and at least one error diagnostic.
#[derive(Clone, Debug, PartialEq)]
pub struct ShaperFontCompilation {
    pub font: Option<ShaperFont>,
    pub diagnostics: Vec<FeatureDiagnostic>,
    /// Diagnostics rendered with source excerpts, for terminals and logs.
    pub report: String,
}

impl ShaperFontCompilation {
    fn failed(diagnostics: &DiagnosticSet, tree: &ParseTree) -> Self {
        let mut compilation = Self {
            font: None,
            diagnostics: Vec::new(),
            report: String::new(),
        };
        compilation.add_diagnostics(diagnostics, tree);
        compilation
    }

    fn add_diagnostics(&mut self, diagnostics: &DiagnosticSet, tree: &ParseTree) {
        for diagnostic in diagnostics.diagnostics() {
            let source = tree
                .get_source(diagnostic.message.file)
                .map(|source| source.text())
                .unwrap_or_default();
            let span = diagnostic.span();
            self.diagnostics.push(FeatureDiagnostic {
                severity: severity(diagnostic.level),
                message: diagnostic.message.text.clone(),
                range: utf16_offset(source, span.start)..utf16_offset(source, span.end),
            });
        }
        self.report += &diagnostics.display().to_string();
    }
}

fn severity(level: fea_rs::Level) -> DiagnosticSeverity {
    match level {
        fea_rs::Level::Error => DiagnosticSeverity::Error,
        fea_rs::Level::Warning => DiagnosticSeverity::Warning,
        fea_rs::Level::Info => DiagnosticSeverity::Info,
    }
}

fn utf16_offset(source: &str, byte_offset: usize) -> usize {
    source
        .get(..byte_offset)
        .map(|prefix| prefix.chars().map(char::len_utf16).sum())
        .unwrap_or(byte_offset)
}

/// Describes a shaper-font failure that is not a problem in the feature
/// source.
#[derive(Debug, thiserror::Error)]
pub enum ShaperFontError {
    #[error("units per em must be a whole number from 16 to 16384, got {value}")]
    InvalidUnitsPerEm { value: f64 },

    #[error("cannot build shaper font axes: {message}")]
    InvalidAxes { message: String },

    #[error("invalid glyph order: {message}")]
    InvalidGlyphOrder { message: String },

    #[error("cannot assemble shaper font: {message}")]
    Assembly { message: String },
}

/// Compiles the authored features of `request` into a shaper font.
///
/// Feature source is parsed, validated against the glyph order and axes, and
/// compiled; the first stage that reports an error ends compilation without a
/// font. `include` statements are reported as errors because the source is
/// self-contained.
///
/// # Errors
///
/// Returns [`ShaperFontError`] when the glyph order has duplicate names, or
/// the axes or compiled tables cannot be assembled into a font.
pub fn compile_shaper_font(
    request: &ShaperFontRequest,
) -> Result<ShaperFontCompilation, ShaperFontError> {
    let glyph_map =
        GlyphMap::new(request.glyph_names.iter().map(String::as_str)).map_err(|error| {
            ShaperFontError::InvalidGlyphOrder {
                message: error.to_string(),
            }
        })?;

    let (tree, diagnostics) = parse_feature_source(&request.feature_source, &glyph_map)?;
    if diagnostics.has_errors() {
        return Ok(ShaperFontCompilation::failed(&diagnostics, &tree));
    }

    let static_metadata = static_metadata(request)?;
    let variation_info = static_metadata.as_ref().map(FeaVariationInfo::new);
    let validation = compile::validate(&tree, &glyph_map, variation_info.as_ref());
    if validation.has_errors() {
        return Ok(ShaperFontCompilation::failed(&validation, &tree));
    }

    let (mut compilation, warnings) = match compile::compile(
        &tree,
        &glyph_map,
        variation_info.as_ref(),
        None::<&NopFeatureProvider>,
        Opts::default(),
    ) {
        Ok(compiled) => compiled,
        Err(errors) => return Ok(ShaperFontCompilation::failed(&errors, &tree)),
    };

    add_glyph_classes(&mut compilation, &glyph_map, &request.gdef_classes);
    let insert_markers = insert_markers(&compilation, &tree);
    let mut head = compilation.head.take().unwrap_or_default();
    head.units_per_em = request.units_per_em;
    compilation.head = Some(head);
    let fvar = static_metadata
        .is_some()
        .then(|| add_axis_names(&mut compilation, &request.axes))
        .transpose()?;

    let mut builder = compilation
        .to_font_builder()
        .map_err(|error| assembly_error(&error))?;
    if let Some(fvar) = fvar {
        builder
            .add_table(&fvar)
            .map_err(|error| assembly_error(&error))?;
    }

    let mut result = ShaperFontCompilation {
        font: Some(ShaperFont {
            bytes: builder.build(),
            glyph_names: request.glyph_names.clone(),
            insert_markers,
        }),
        diagnostics: Vec::new(),
        report: String::new(),
    };
    result.add_diagnostics(&warnings, &tree);
    Ok(result)
}

/// Classifies glyphs by category unless the feature source declared its own
/// glyph classes, which are more specific, as in export.
fn add_glyph_classes(
    compilation: &mut compile::Compilation,
    glyph_map: &GlyphMap,
    classes: &BTreeMap<String, GlyphClassDef>,
) {
    if compilation.gdef_classes.is_some() {
        return;
    }

    let class_def: ClassDef = classes
        .iter()
        .filter_map(|(name, class)| Some((glyph_map.get(name.as_str())?, *class as u16)))
        .collect();
    if class_def.iter().next().is_none() {
        return;
    }

    let gdef = compilation.gdef.get_or_insert_with(Default::default);
    gdef.glyph_class_def.set(class_def);
}

fn parse_feature_source(
    source: &str,
    glyph_map: &GlyphMap,
) -> Result<(ParseTree, DiagnosticSet), ShaperFontError> {
    let root_source: Arc<str> = source.into();
    parse_root(
        FEATURE_SOURCE_PATH.into(),
        Some(glyph_map),
        Box::new(move |path: &Path| {
            if path == Path::new(FEATURE_SOURCE_PATH) {
                return Ok(root_source.clone());
            }

            Err(SourceLoadError::new(
                path.to_path_buf(),
                "feature source cannot include other files",
            ))
        }),
    )
    .map_err(|error| ShaperFontError::Assembly {
        message: error.to_string(),
    })
}

/// Returns the variation model fea-rs needs to resolve variable values, or
/// `None` for a static font.
fn static_metadata(request: &ShaperFontRequest) -> Result<Option<StaticMetadata>, ShaperFontError> {
    if request.axes.is_empty() {
        return Ok(None);
    }

    let default_location: NormalizedLocation = request
        .axes
        .iter()
        .map(|axis| (axis.tag, NormalizedCoord::new(0.0)))
        .collect();
    StaticMetadata::new(
        request.units_per_em,
        Default::default(),
        request.axes.clone(),
        Vec::new(),
        HashSet::from([default_location]),
        None,
        0.0,
        None,
        false,
    )
    .map(Some)
    .map_err(|error| ShaperFontError::InvalidAxes {
        message: error.to_string(),
    })
}

fn insert_markers(compilation: &compile::Compilation, tree: &ParseTree) -> Vec<InsertMarker> {
    let mut marked: Vec<_> = compilation.insert_markers.iter().collect();
    marked.sort_by_key(|(_, point)| point.priority);
    let mut markers: Vec<InsertMarker> = marked
        .into_iter()
        .map(|(tag, point)| InsertMarker {
            tag: tag.to_string(),
            lookup_index: Some(point.lookup_id.to_raw()),
        })
        .collect();

    for tag in GENERATED_FEATURES {
        let marked = markers.iter().any(|marker| marker.tag == tag);
        if !marked && !defines_feature(tree, tag) {
            markers.push(InsertMarker {
                tag: tag.to_string(),
                lookup_index: None,
            });
        }
    }
    markers
}

fn defines_feature(tree: &ParseTree, tag: &str) -> bool {
    tree.typed_root()
        .statements()
        .filter_map(Feature::cast)
        .any(|feature| feature.tag().text() == tag)
}

/// Names each axis in the compiled `name` table and returns the matching
/// `fvar`, so a shaper can resolve variations by axis tag.
fn add_axis_names(
    compilation: &mut compile::Compilation,
    axes: &[IrAxis],
) -> Result<Fvar, ShaperFontError> {
    let mut name = compilation.name.take().unwrap_or_default();
    let mut name_id = name
        .name_record
        .iter()
        .map(|record| record.name_id)
        .max()
        .unwrap_or(NameId::LAST_RESERVED_NAME_ID)
        .max(NameId::LAST_RESERVED_NAME_ID);

    let mut records = Vec::with_capacity(axes.len());
    for axis in axes {
        name_id = name_id
            .checked_add(1)
            .ok_or_else(|| ShaperFontError::Assembly {
                message: "too many name records for axis names".to_string(),
            })?;
        name.name_record.push(NameRecord::new(
            3,
            1,
            0x0409,
            name_id,
            axis.ui_label_name().to_string().into(),
        ));
        records.push(VariationAxisRecord {
            axis_tag: axis.tag,
            min_value: axis.min.into(),
            default_value: axis.default.into(),
            max_value: axis.max.into(),
            axis_name_id: name_id,
            ..Default::default()
        });
    }
    name.name_record.sort();
    compilation.name = Some(name);

    Ok(Fvar::new(AxisInstanceArrays::new(records, Vec::new())))
}

fn assembly_error(error: &impl std::fmt::Display) -> ShaperFontError {
    ShaperFontError::Assembly {
        message: error.to_string(),
    }
}

/// The shaper font for a changing font: the most recent successful
/// compilation, and the diagnostics of the most recent request.
///
/// A request whose feature source has errors keeps the previous font active,
/// so shaping continues with the last valid features while the author repairs
/// the source.
#[derive(Debug, Default)]
pub struct ShaperFontState {
    request: Option<ShaperFontRequest>,
    font: Option<Arc<ShaperFont>>,
    diagnostics: Vec<FeatureDiagnostic>,
    revision: u64,
}

impl ShaperFontState {
    /// Compiles `request` unless it equals the last request, and returns
    /// whether the active font changed.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError`] as [`compile_shaper_font`] does; the active
    /// font and diagnostics are then unchanged and the request is retried on
    /// the next update.
    pub fn update(&mut self, request: ShaperFontRequest) -> Result<bool, ShaperFontError> {
        if self.request.as_ref() == Some(&request) {
            return Ok(false);
        }

        let compilation = compile_shaper_font(&request)?;
        self.request = Some(request);
        self.diagnostics = compilation.diagnostics;
        let Some(font) = compilation.font else {
            return Ok(false);
        };

        self.font = Some(Arc::new(font));
        self.revision += 1;
        Ok(true)
    }

    /// Returns the last successfully compiled font, or `None` when no request
    /// has compiled yet.
    pub fn font(&self) -> Option<&Arc<ShaperFont>> {
        self.font.as_ref()
    }

    /// Returns the diagnostics of the most recent request, including when its
    /// source failed and an earlier font remains active.
    pub fn diagnostics(&self) -> &[FeatureDiagnostic] {
        &self.diagnostics
    }

    /// Counts successful compilations; it changes exactly when
    /// [`Self::font`] does.
    pub fn revision(&self) -> u64 {
        self.revision
    }
}

#[cfg(test)]
mod tests;
