//! Exports Shift font views as distributable binaries or editable sources.
//!
//! Every export consumes a [`FontView`] and never changes the document it
//! came from. TrueType compilation consumes an owned snapshot of the view;
//! the completed binary is staged beside its destination and replaces that
//! path only after compilation succeeds, so a partial font is never exposed.
//! Source exports write each UFO atomically, and a designspace's UFOs before
//! the XML that names them.
//!
//! Static instances, one binary per named instance, are exported by
//! `FontExporter::export_static_instances`. Still to come: WOFF2 and WOFF (a
//! TTF re-encoded, which needs an encoder crate that passes `cargo deny`) and
//! a Glyphs writer (`glyphs-reader` only reads).

use std::path::{Path, PathBuf};

use write_fonts::FontBuilder;
use write_fonts::from_obj::ToOwnedTable;
use write_fonts::read::{FontRef, TableProvider};
use write_fonts::tables::name::Name;
use write_fonts::types::NameId;

use crate::binary_encoding::BinaryEncodings;
use crate::errors::FormatBackendError;
use crate::formats::designspace::DesignspaceWriter;
use crate::formats::ufo::UfoWriter;
use crate::shift2fontir::{PropagatedGlyphAnchors, ShiftIrSource, ShiftIrSourceError};
use crate::traits::FontView;
use shift_font::{Axis, AxisRole, Font};

/// Identifies a format [`FontExporter`] can write.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportFormat {
    /// A variable (or static, without axes) TrueType binary.
    Ttf,
    /// A designspace document with one UFO per master file beside it.
    Designspace,
    /// One UFO; only for fonts with a single master.
    Ufo,
    /// One static TrueType binary per named instance, written into a
    /// directory; see [`FontExporter::export_static_instances`].
    StaticTtf,
}

impl ExportFormat {
    /// Every format, in the order commands list them.
    pub const ALL: [Self; 4] = [Self::Ttf, Self::Designspace, Self::Ufo, Self::StaticTtf];

    /// Returns the lowercase format token used by commands and the bridge.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ttf => "ttf",
            Self::Designspace => "designspace",
            Self::Ufo => "ufo",
            Self::StaticTtf => "static-ttf",
        }
    }

    /// Returns the file extension, without the dot, of the files this format
    /// writes: the output path's own for every format but [`Self::StaticTtf`],
    /// whose output path is a directory.
    pub fn extension(self) -> &'static str {
        match self {
            Self::Ttf | Self::StaticTtf => "ttf",
            Self::Designspace => "designspace",
            Self::Ufo => "ufo",
        }
    }

    /// Returns the format's name as people say it, for messages.
    pub fn name(self) -> &'static str {
        match self {
            Self::Ttf => "TrueType",
            Self::Designspace => "designspace",
            Self::Ufo => "UFO",
            Self::StaticTtf => "static TrueType",
        }
    }

    /// Returns the format a path's extension names, ignoring case.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError::UnknownExtension`] when the path has no
    /// extension or one no format uses.
    pub fn from_path(path: &Path) -> Result<Self, ExportError> {
        path.extension()
            .and_then(|extension| extension.to_str())
            .and_then(|extension| Self::try_from(extension).ok())
            .filter(|format| *format != Self::StaticTtf)
            .ok_or_else(|| ExportError::UnknownExtension {
                path: path.to_path_buf(),
            })
    }

    /// The error for a source writer that could not write this format to `path`.
    fn write_error(self, path: &Path, source: FormatBackendError) -> ExportError {
        ExportError::WriteSources {
            format: self,
            path: path.to_path_buf(),
            source,
        }
    }

    fn ensure_output_path(self, path: &Path) -> Result<(), ExportError> {
        if self == Self::StaticTtf {
            return Ok(());
        }
        match path.extension().and_then(|ext| ext.to_str()) {
            Some(ext) if ext.eq_ignore_ascii_case(self.extension()) => Ok(()),
            _ => Err(ExportError::OutputExtensionMismatch {
                path: path.to_path_buf(),
                format: self,
            }),
        }
    }
}

impl TryFrom<&str> for ExportFormat {
    type Error = ExportError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        let token = value.to_ascii_lowercase();
        Self::ALL
            .into_iter()
            .find(|format| format.as_str() == token)
            .ok_or(ExportError::UnsupportedFormat { format: token })
    }
}

/// Describes one on-disk font export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontExportRequest {
    /// Destination replaced after the export succeeds. Its extension must
    /// match the format; for [`ExportFormat::StaticTtf`] it is the directory
    /// the binaries are written into.
    pub path: PathBuf,
    pub format: ExportFormat,
}

/// Confirms the destination, format and files of a completed export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontExportResult {
    pub path: PathBuf,
    pub format: ExportFormat,
    /// Every file or UFO directory the export wrote, as
    /// [`FontExporter::plan`] lists them.
    pub files: Vec<PathBuf>,
}

/// Describes a failure to represent, compile, or write an exported font.
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("unsupported export format: {format}")]
    UnsupportedFormat { format: String },

    #[error("cannot tell the export format from {path}: end it in .designspace, .ufo or .ttf")]
    UnknownExtension { path: PathBuf },

    #[error("export path must end in .{} for {} export: {path}", format.extension(), format.name())]
    OutputExtensionMismatch { path: PathBuf, format: ExportFormat },

    #[error("export path is not valid UTF-8: {path}")]
    InvalidPathUtf8 { path: PathBuf },

    #[error(
        "a UFO holds one master, but this font has {master_count}; export a designspace instead"
    )]
    UfoNeedsOneMaster { master_count: usize },

    #[error("cross-axis mappings are not supported by TTF export yet ({mapping_count} mappings)")]
    UnsupportedCrossAxisMappings { mapping_count: usize },

    #[error("cannot compile this Shift font: {message}")]
    InvalidSource { message: String },

    #[error("failed to compile TrueType font: {message}")]
    CompileTtf { message: String },

    #[error("failed to write TrueType font to {path}")]
    WriteOutput {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("this variable font has no named instances to export as static fonts")]
    NoNamedInstances,

    #[error("unsupported binary encoding: {encoding}")]
    UnsupportedEncoding { encoding: String },

    #[error("an export must write at least one encoding")]
    NoEncodings,

    #[error("failed to encode {path} as WOFF2: {source}")]
    EncodeWoff2 {
        path: PathBuf,
        #[source]
        source: ttf2woff2::Error,
    },

    #[error("cannot evaluate instance {instance:?}: {source}")]
    StaticInstance {
        instance: String,
        #[source]
        source: shift_font::CoreError,
    },

    #[error("failed to create export directory {path}: {source}")]
    CreateDirectory {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write {} sources to {path}: {source}", format.name())]
    WriteSources {
        format: ExportFormat,
        path: PathBuf,
        #[source]
        source: FormatBackendError,
    },
}

/// Exports [`FontView`] snapshots as binaries or editable sources.
pub struct FontExporter;

impl FontExporter {
    pub fn new() -> Self {
        Self
    }

    /// Writes `font` in the requested format, replacing each destination
    /// atomically, and leaves `font` and its document unchanged.
    ///
    /// For TrueType, the font is cloned into an owned compiler snapshot before
    /// fontc work begins, so later changes to the originating font cannot alter
    /// the in-flight build. A designspace export writes one UFO per master file
    /// beside the designspace; a UFO export writes the single master; a static
    /// export writes one binary per named instance into the request's
    /// directory. The result lists every file written, as [`Self::plan`] does.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError::OutputExtensionMismatch`] for a path without the
    /// format's extension, [`ExportError::UfoNeedsOneMaster`] for a UFO export
    /// of a font with several masters, [`ExportError::WriteSources`] when a
    /// source format cannot represent the font or its files cannot be written,
    /// the errors of [`Self::export_static_instances`], and the compile and
    /// write errors of TrueType export.
    pub fn export(
        &self,
        font: &Font,
        request: FontExportRequest,
    ) -> Result<FontExportResult, ExportError> {
        self.export_with(font, request, &BinaryEncodings::ttf())
    }

    /// [`Self::export`], writing each TrueType binary in every one of
    /// `encodings` beside its `.ttf` name, from one compile. Source formats
    /// ignore `encodings`.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`Self::export`], and
    /// [`ExportError::EncodeWoff2`] when a binary cannot be WOFF2 encoded.
    pub fn export_with(
        &self,
        font: &Font,
        request: FontExportRequest,
        encodings: &BinaryEncodings,
    ) -> Result<FontExportResult, ExportError> {
        let files = self.plan_with(font, &request, encodings)?;
        match request.format {
            ExportFormat::Ttf => {
                self.export_binary(font, &request.path, encodings)?;
            }
            ExportFormat::Designspace => Self::export_designspace(font, &request.path)?,
            ExportFormat::Ufo => Self::export_ufo(font, &request.path)?,
            ExportFormat::StaticTtf => {
                self.export_static_instances_with(font, &request.path, encodings)?;
            }
        }

        Ok(FontExportResult {
            path: request.path,
            format: request.format,
            files,
        })
    }

    /// The request that exports `font` as `format` into `directory`, under
    /// the name the format conventionally gets: `Family[wght,wdth].ttf` for a
    /// variable binary (its external axis tags), `Family-Style.ttf` for a
    /// font without axes, `Family.designspace`, `Family-Style.ufo`, and the
    /// directory itself for static binaries, which
    /// [`Self::static_instance_files`] names. Family and style keep only the
    /// characters PostScript names allow.
    pub fn request_in(font: &Font, format: ExportFormat, directory: &Path) -> FontExportRequest {
        let family = postscript_safe(font.metadata().family_name.as_deref().unwrap_or("Untitled"));
        let style = postscript_safe(font.metadata().style_name.as_deref().unwrap_or("Regular"));
        let file_name = match format {
            ExportFormat::Ttf if font.is_variable() => {
                let tags: Vec<&str> = font
                    .axes()
                    .iter()
                    .filter(|axis| axis.role() == AxisRole::External)
                    .map(Axis::tag)
                    .collect();
                Some(format!("{family}[{}].ttf", tags.join(",")))
            }
            ExportFormat::Ttf => Some(format!("{family}-{style}.ttf")),
            ExportFormat::Designspace => Some(format!("{family}.designspace")),
            ExportFormat::Ufo => Some(format!("{family}-{style}.ufo")),
            ExportFormat::StaticTtf => None,
        };
        FontExportRequest {
            path: file_name.map_or_else(|| directory.to_path_buf(), |name| directory.join(name)),
            format,
        }
    }

    /// Lists the files [`Self::export`] would write for `request`, without
    /// writing anything: the output path itself, plus a designspace's UFOs
    /// beside it, or a static export's binaries inside its directory.
    ///
    /// # Errors
    ///
    /// Returns the request errors [`Self::export`] returns before it writes:
    /// a mismatched extension, a UFO export of several masters, or a static
    /// export of a variable font without named instances.
    pub fn plan(
        &self,
        font: &Font,
        request: &FontExportRequest,
    ) -> Result<Vec<PathBuf>, ExportError> {
        self.plan_with(font, request, &BinaryEncodings::ttf())
    }

    /// [`Self::plan`] for [`Self::export_with`]: each binary in every one of
    /// `encodings`.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`Self::plan`].
    #[expect(
        clippy::unused_self,
        reason = "an exporter method; the exporter is the export entry point callers hold"
    )]
    pub fn plan_with(
        &self,
        font: &Font,
        request: &FontExportRequest,
        encodings: &BinaryEncodings,
    ) -> Result<Vec<PathBuf>, ExportError> {
        let path = &request.path;
        request.format.ensure_output_path(path)?;
        match request.format {
            ExportFormat::Ttf => Ok(encodings.paths(path)),
            ExportFormat::Ufo => {
                ensure_one_master(font)?;
                Ok(vec![path.clone()])
            }
            ExportFormat::Designspace => {
                let ufos = DesignspaceWriter::new()
                    .ufo_filenames(font, path)
                    .map_err(|source| ExportFormat::Designspace.write_error(path, source))?;
                let directory = path.parent().unwrap_or_else(|| Path::new(""));
                Ok(std::iter::once(path.clone())
                    .chain(ufos.iter().map(|ufo| directory.join(ufo)))
                    .collect())
            }
            ExportFormat::StaticTtf => Ok(Self::static_instance_files(font)?
                .into_iter()
                .flat_map(|file| encodings.paths(&path.join(file.file_name)))
                .collect()),
        }
    }

    /// Compiles a TrueType binary from the supplied font in memory without
    /// writing it anywhere.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError`] when the source cannot be represented in the
    /// supported compiler model or compilation fails.
    #[allow(
        clippy::unused_self,
        reason = "an exporter method; the exporter is the export entry point callers hold"
    )]
    pub fn compile_ttf(&self, font: &impl FontView) -> Result<Vec<u8>, ExportError> {
        let source = ShiftIrSource::from_font_view(font)?;
        let bytes = fontc::generate_font(Box::new(source), fontc::Options::default())
            .map_err(|error| compile_error(&error))?;
        strip_compiler_version(&bytes)
    }

    /// Compiles `font` once and writes it in each of `encodings` beside
    /// `ttf_path`, returning the files written.
    pub(crate) fn export_binary(
        &self,
        font: &impl FontView,
        ttf_path: &Path,
        encodings: &BinaryEncodings,
    ) -> Result<Vec<PathBuf>, ExportError> {
        let bytes = self.compile_ttf(font)?;
        encodings.write(&bytes, ttf_path)
    }

    fn export_designspace(font: &impl FontView, path: &Path) -> Result<(), ExportError> {
        DesignspaceWriter::new()
            .save_view(font, utf8_path(path)?)
            .map_err(|source| ExportFormat::Designspace.write_error(path, source))
    }

    fn export_ufo(font: &impl FontView, path: &Path) -> Result<(), ExportError> {
        ensure_one_master(font)?;
        UfoWriter::new()
            .save_view(font, utf8_path(path)?)
            .map_err(|source| ExportFormat::Ufo.write_error(path, source))
    }

    /// Returns every glyph's anchors as export compiles them, with component
    /// anchors propagated into composites.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError`] when the font cannot be compiled.
    #[allow(
        clippy::unused_self,
        reason = "an exporter method; the exporter is the export entry point callers hold"
    )]
    pub fn propagated_anchors(
        &self,
        font: &impl FontView,
    ) -> Result<Vec<PropagatedGlyphAnchors>, ExportError> {
        ShiftIrSource::from_font_view(font)?
            .propagated_anchors()
            .map_err(|error| compile_error(&error))
    }
}

impl Default for FontExporter {
    fn default() -> Self {
        Self::new()
    }
}

/// Marker fontc appends to every version string (name ID 5) it compiles.
const FONTC_VERSION_MARKER: &str = ";fontc ";

/// Removes the `;fontc <version>` suffix fontc stamps onto version strings, so
/// an exported font reports exactly the version its author entered.
///
/// fontc 1.0 always stamps and offers no option to disable it. Its stamp is
/// always the trailing part of the record, so truncating at the marker restores
/// the authored string. The binary is returned unchanged when no record carries
/// the marker.
///
/// # Errors
///
/// Returns [`ExportError::CompileTtf`] when the compiled binary or its `name`
/// table cannot be read back or rebuilt.
fn strip_compiler_version(bytes: &[u8]) -> Result<Vec<u8>, ExportError> {
    let font = FontRef::new(bytes).map_err(|error| compile_error(&error))?;
    let mut name: Name = font
        .name()
        .map_err(|error| compile_error(&error))?
        .to_owned_table();

    let mut stamped = false;
    for record in name
        .name_record
        .iter_mut()
        .filter(|record| record.name_id == NameId::VERSION_STRING)
    {
        if let Some(index) = record.string.find(FONTC_VERSION_MARKER) {
            record.string.truncate(index);
            stamped = true;
        }
    }
    if !stamped {
        return Ok(bytes.to_vec());
    }

    Ok(FontBuilder::new()
        .add_table(&name)
        .map_err(|error| compile_error(&error))?
        .copy_missing_tables(font)
        .build())
}

fn compile_error(error: &impl std::fmt::Display) -> ExportError {
    ExportError::CompileTtf {
        message: error.to_string(),
    }
}

impl From<ShiftIrSourceError> for ExportError {
    fn from(error: ShiftIrSourceError) -> Self {
        match error {
            ShiftIrSourceError::UnsupportedCrossAxisMappings { mapping_count } => {
                Self::UnsupportedCrossAxisMappings { mapping_count }
            }
            error => Self::InvalidSource {
                message: error.to_string(),
            },
        }
    }
}

/// `name` with only the printable ASCII PostScript names allow, without
/// spaces or `[](){}<>/%`.
pub(crate) fn postscript_safe(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_ascii_graphic() && !"[](){}<>/%".contains(*character))
        .collect()
}

/// Refuses a font a single UFO cannot hold.
fn ensure_one_master(font: &impl FontView) -> Result<(), ExportError> {
    let master_count = font
        .sources()
        .iter()
        .filter(|source| source.is_master())
        .count();
    if master_count > 1 {
        return Err(ExportError::UfoNeedsOneMaster { master_count });
    }
    Ok(())
}

fn utf8_path(path: &Path) -> Result<&str, ExportError> {
    path.to_str().ok_or_else(|| ExportError::InvalidPathUtf8 {
        path: path.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::test_support::sample_variable_font;
    use shift_font::{Axis, AxisMapping, AxisMappingPoint, AxisRole, Font, Location};
    use skrifa::{FontRef, MetadataProvider};

    #[test]
    fn compiles_ttf_with_authored_cmap() {
        let temp_dir = tempfile::tempdir().unwrap();
        let output_path = temp_dir.path().join("Dogfood.ttf");
        let font = sample_variable_font();

        let result = FontExporter::new()
            .export(
                &font,
                FontExportRequest {
                    path: output_path.clone(),
                    format: ExportFormat::Ttf,
                },
            )
            .unwrap();

        assert_eq!(
            result,
            FontExportResult {
                path: output_path.clone(),
                format: ExportFormat::Ttf,
                files: vec![output_path.clone()],
            }
        );

        let bytes = std::fs::read(&output_path).unwrap();
        assert!(!bytes.is_empty());

        let exported = FontRef::new(&bytes).unwrap();
        assert!(
            exported
                .charmap()
                .mappings()
                .any(|(codepoint, _)| codepoint == 0x0041)
        );
    }

    fn add_glyph_on_every_master(font: &mut Font, name: &str, unicode: u32, anchor: &str) {
        let mut glyph = shift_font::Glyph::with_unicode(name, unicode);
        for source in font.sources().to_vec() {
            let mut layer =
                shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source.id(), 300.0);
            layer.add_anchor(shift_font::Anchor::new(
                Some(anchor.to_string()),
                100.0,
                0.0,
            ));
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).unwrap();
    }

    #[test]
    fn compiles_glyph_categories_into_gdef_and_zero_width_marks() {
        use skrifa::raw::TableProvider;
        use write_fonts::tables::gdef::GlyphClassDef;

        let mut font = sample_variable_font();
        // An underscore anchor alone would make both of these marks.
        add_glyph_on_every_master(&mut font, "jdotless", 0x0237, "_right");
        add_glyph_on_every_master(&mut font, "acutecomb", 0x0301, "_top");

        let bytes = FontExporter::new().compile_ttf(&font).unwrap();
        let compiled = FontRef::new(&bytes).unwrap();
        let gid = |codepoint: u32| compiled.charmap().map(codepoint).unwrap();
        let class_def = compiled.gdef().unwrap().glyph_class_def().unwrap().unwrap();
        let class = |codepoint: u32| class_def.get(gid(codepoint).try_into().unwrap());
        let advance = |codepoint: u32| {
            compiled
                .glyph_metrics(
                    skrifa::instance::Size::unscaled(),
                    skrifa::instance::LocationRef::default(),
                )
                .advance_width(gid(codepoint))
                .unwrap()
        };

        assert_ne!(class(0x0237), GlyphClassDef::Mark as u16);
        assert_eq!(class(0x0301), GlyphClassDef::Mark as u16);
        assert_eq!(advance(0x0237), 300.0);
        assert_eq!(advance(0x0301), 0.0);
    }

    /// Adds a glyph with the same anchors and components on every master.
    fn add_composed_glyph(
        font: &mut Font,
        name: &str,
        unicode: u32,
        anchors: &[(&str, f64, f64)],
        components: &[(&str, f64, f64)],
    ) {
        let mut glyph = shift_font::Glyph::with_unicode(name, unicode);
        for source in font.sources().to_vec() {
            let mut layer =
                shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source.id(), 500.0);
            for &(anchor, x, y) in anchors {
                layer.add_anchor(shift_font::Anchor::new(Some(anchor.to_string()), x, y));
            }
            for &(base, dx, dy) in components {
                let base = font.glyph_by_name(base).unwrap();
                let mut component = shift_font::Component::new(base.id(), base.name());
                component.translate(dx, dy);
                layer.add_component(component);
            }
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).unwrap();
    }

    #[test]
    fn propagates_component_anchors_into_composites() {
        let mut font = sample_variable_font();
        add_composed_glyph(
            &mut font,
            "a",
            0x61,
            &[("top", 250.0, 500.0), ("bottom", 250.0, 0.0)],
            &[],
        );
        add_composed_glyph(
            &mut font,
            "acutecomb",
            0x301,
            &[("_top", 100.0, 500.0), ("top", 100.0, 700.0)],
            &[],
        );
        add_composed_glyph(
            &mut font,
            "aacute",
            0xE1,
            &[],
            &[("a", 0.0, 0.0), ("acutecomb", 150.0, 0.0)],
        );

        let glyphs = FontExporter::new().propagated_anchors(&font).unwrap();
        let aacute = glyphs
            .iter()
            .find(|glyph| glyph.glyph_name == "aacute")
            .unwrap();
        let default = font.default_source_id().unwrap();
        let anchors = &aacute
            .sources
            .iter()
            .find(|source| source.source_id == default)
            .unwrap()
            .anchors;

        let named = |name: &str| {
            anchors
                .iter()
                .find(|anchor| anchor.name == name)
                .map(|anchor| (anchor.x, anchor.y))
        };
        // The acute stacks: the composite's top is the accent's own top, moved with it.
        assert_eq!(named("top"), Some((250.0, 700.0)));
        assert_eq!(named("bottom"), Some((250.0, 0.0)));
        assert_eq!(named("_top"), None);
    }

    /// Propagates one glyph at one master with shift-font's port, recursing into components.
    fn propagate_at(
        font: &Font,
        glyph_id: shift_font::GlyphId,
        source_id: shift_font::SourceId,
        categories: &std::collections::BTreeMap<shift_font::GlyphId, shift_font::RecordCategory>,
    ) -> shift_font::anchor_propagation::PropagatedAnchors {
        use shift_font::anchor_propagation::{
            PropagationAnchor, PropagationComponent, PropagationGlyph, compiled_anchors,
        };
        let glyph = font.glyph(glyph_id).unwrap();
        let layer = glyph.layer_for_source(source_id).unwrap();
        let own: Vec<_> = layer
            .anchors_iter()
            .filter_map(|anchor| {
                Some(PropagationAnchor {
                    name: anchor.name()?.to_string(),
                    x: anchor.x(),
                    y: anchor.y(),
                })
            })
            .collect();
        let bases: Vec<_> = layer
            .components_iter()
            .map(|component| {
                (
                    propagate_at(font, component.base_glyph_id(), source_id, categories),
                    component.matrix(),
                )
            })
            .collect();
        let components: Vec<_> = bases
            .iter()
            .map(|(base, transform)| PropagationComponent {
                anchors: Some(&base.anchors),
                base_glyph_count: base.base_glyph_count,
                transform: *transform,
            })
            .collect();
        let category = categories.get(&glyph_id).copied().unwrap_or_default();
        let attaching = glyph.has_attaching_anchor();
        compiled_anchors(&PropagationGlyph {
            anchors: &own,
            components: &components,
            is_mark: category.mark,
            is_ligature: match category.ligature {
                Some(shift_font::Ligature::Explicit) => true,
                Some(shift_font::Ligature::Subcategory) => attaching,
                None => false,
            },
        })
    }

    #[test]
    fn shift_font_propagation_matches_fontc_for_every_glyph_at_every_master() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/fonts/AnchorPropagation.glyphs");
        let font = crate::font_loader::FontLoader::new()
            .read_font(path.to_str().unwrap())
            .unwrap();
        let categories = crate::record_categories(font.glyphs(), font.lib());
        let sorted = |anchors: Vec<(String, f64, f64)>| {
            let mut anchors = anchors;
            anchors.sort_by(|a, b| a.0.cmp(&b.0));
            anchors
        };

        let mut compared = 0;
        for glyph in FontExporter::new().propagated_anchors(&font).unwrap() {
            let glyph_id = font.glyph_by_name(&glyph.glyph_name).unwrap().id();
            for source in glyph.sources {
                let ours = propagate_at(&font, glyph_id, source.source_id, &categories);
                assert_eq!(
                    sorted(
                        ours.anchors
                            .into_iter()
                            .map(|a| (a.name, a.x, a.y))
                            .collect()
                    ),
                    sorted(
                        source
                            .anchors
                            .into_iter()
                            .map(|a| (a.name, a.x, a.y))
                            .collect()
                    ),
                    "{} at {}",
                    glyph.glyph_name,
                    source.source_id
                );
                compared += 1;
            }
        }
        assert!(compared > 40);
    }

    #[test]
    fn version_string_omits_compiler_stamp() {
        let mut font = sample_variable_font();
        font.metadata_mut().version_major = Some(2);
        font.metadata_mut().version_minor = Some(125);

        let bytes = FontExporter::new().compile_ttf(&font).unwrap();

        let exported = FontRef::new(&bytes).unwrap();
        let versions = exported
            .localized_strings(skrifa::string::StringId::VERSION_STRING)
            .map(|string| string.to_string())
            .collect::<Vec<_>>();
        assert_eq!(versions, vec!["Version 2.125".to_string()]);
    }

    #[test]
    fn postscript_safe_names_drop_spaces_and_reserved_characters() {
        assert_eq!(
            postscript_safe("Solenoid-Coarse Wide"),
            "Solenoid-CoarseWide"
        );
        assert_eq!(postscript_safe("Ünï (Bold)/2"), "nBold2");
    }

    #[test]
    fn exports_in_a_directory_take_their_formats_conventional_names() {
        let font = sample_variable_font();
        let directory = Path::new("out");
        let path = |format| FontExporter::request_in(&font, format, directory).path;

        assert_eq!(
            path(ExportFormat::Ttf),
            directory.join("UntitledFont[wght].ttf")
        );
        assert_eq!(
            path(ExportFormat::Designspace),
            directory.join("UntitledFont.designspace")
        );
        assert_eq!(
            path(ExportFormat::Ufo),
            directory.join("UntitledFont-Regular.ufo")
        );
        assert_eq!(path(ExportFormat::StaticTtf), directory);
        assert_eq!(
            FontExporter::request_in(&Font::new(), ExportFormat::Ttf, directory).path,
            directory.join("UntitledFont-Regular.ttf")
        );
    }

    #[test]
    fn rejects_ttf_export_without_ttf_extension() {
        let temp_dir = tempfile::tempdir().unwrap();
        let output_path = temp_dir.path().join("Dogfood.otf");
        let font = Font::new();

        let error = FontExporter::new()
            .export(
                &font,
                FontExportRequest {
                    path: output_path.clone(),
                    format: ExportFormat::Ttf,
                },
            )
            .unwrap_err();

        assert!(matches!(
            error,
            ExportError::OutputExtensionMismatch { path, format: ExportFormat::Ttf } if path == output_path
        ));
    }

    #[test]
    fn rejects_cross_axis_mapping_before_writing_output() {
        let temp_dir = tempfile::tempdir().unwrap();
        let output_path = temp_dir.path().join("Dogfood.ttf");
        let mut font = Font::new();
        let weight = Axis::weight();
        let mut optical = Axis::new(
            "opsz".to_string(),
            "Optical size".to_string(),
            8.0,
            12.0,
            72.0,
        );
        optical.set_role(AxisRole::Internal);
        let input = Location::from([(weight.id(), 400.0)]);
        let output = Location::from([(optical.id(), 12.0)]);
        let mapping = AxisMapping::new(
            "Optical compensation".to_string(),
            vec![weight.id()],
            vec![optical.id()],
            vec![AxisMappingPoint {
                description: None,
                input,
                output,
            }],
        );
        font.add_axis(weight).expect("weight axis should be valid");
        font.add_axis(optical)
            .expect("optical axis should be valid");
        font.set_axis_mappings(vec![mapping]).unwrap();

        let error = FontExporter::new()
            .export(
                &font,
                FontExportRequest {
                    path: output_path.clone(),
                    format: ExportFormat::Ttf,
                },
            )
            .unwrap_err();

        assert!(matches!(
            error,
            ExportError::UnsupportedCrossAxisMappings { mapping_count: 1 }
        ));
        assert!(!output_path.exists());
    }
}
