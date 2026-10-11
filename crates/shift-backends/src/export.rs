//! Compiles Shift font views into distributable font binaries.
//!
//! Compilation consumes an owned snapshot of the supplied [`FontView`]. The
//! completed binary is staged beside its destination and replaces that path
//! only after compilation succeeds, so a partial font is never exposed.

use std::path::{Path, PathBuf};

use write_fonts::from_obj::ToOwnedTable;
use write_fonts::read::{FontRef, TableProvider};
use write_fonts::tables::name::Name;
use write_fonts::types::NameId;
use write_fonts::FontBuilder;

use crate::atomic::write_file_atomic;
use crate::shift2fontir::{ShiftIrSource, ShiftIrSourceError};
use crate::traits::FontView;

/// Identifies a binary font format supported by [`FontExporter`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportFormat {
    Ttf,
}

impl ExportFormat {
    /// Returns the lowercase format token used by file extensions and commands.
    pub fn as_str(self) -> &'static str {
        match self {
            ExportFormat::Ttf => "ttf",
        }
    }
}

impl TryFrom<&str> for ExportFormat {
    type Error = ExportError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value.to_ascii_lowercase().as_str() {
            "ttf" => Ok(Self::Ttf),
            format => Err(ExportError::UnsupportedFormat {
                format: format.to_string(),
            }),
        }
    }
}

/// Describes one on-disk font export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontExportRequest {
    /// Destination replaced after compilation succeeds.
    pub path: PathBuf,
    pub format: ExportFormat,
}

/// Confirms the destination and format of a completed export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontExportResult {
    pub path: PathBuf,
    pub format: ExportFormat,
}

/// Describes a failure to represent, compile, or write an exported font.
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("unsupported export format: {format}")]
    UnsupportedFormat { format: String },

    #[error("export path must end in .ttf for TrueType export: {path}")]
    OutputExtensionMismatch { path: PathBuf },

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
}

/// Compiles [`FontView`] snapshots without an intermediate authoring format.
pub struct FontExporter;

impl FontExporter {
    pub fn new() -> Self {
        Self
    }

    /// Compiles the current font view and atomically replaces the destination.
    ///
    /// The font is cloned into an owned compiler snapshot before fontc work
    /// begins. Later changes to the originating font therefore cannot alter
    /// the in-flight build. The requested path must have an extension that
    /// matches the format.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError`] when the source cannot be represented in the
    /// supported compiler model, compilation fails, or the completed binary
    /// cannot be staged and made durable at the destination.
    pub fn export(
        &self,
        font: &impl FontView,
        request: FontExportRequest,
    ) -> Result<FontExportResult, ExportError> {
        match request.format {
            ExportFormat::Ttf => self.export_ttf(font, &request.path)?,
        }

        Ok(FontExportResult {
            path: request.path,
            format: request.format,
        })
    }

    /// Compiles a TrueType binary from the supplied font in memory without
    /// writing it anywhere.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError`] when the source cannot be represented in the
    /// supported compiler model or compilation fails.
    pub fn compile_ttf(&self, font: &impl FontView) -> Result<Vec<u8>, ExportError> {
        let source = ShiftIrSource::from_font_view(font).map_err(map_source_error)?;
        compile_ttf(source)
    }

    fn export_ttf(&self, font: &impl FontView, output_path: &Path) -> Result<(), ExportError> {
        ensure_ttf_output_path(output_path)?;

        let bytes = self.compile_ttf(font)?;
        write_file_atomic(output_path, &bytes).map_err(|source| ExportError::WriteOutput {
            path: output_path.to_path_buf(),
            source,
        })
    }
}

impl Default for FontExporter {
    fn default() -> Self {
        Self::new()
    }
}

/// Marker fontc appends to every version string (name ID 5) it compiles.
const FONTC_VERSION_MARKER: &str = ";fontc ";

fn compile_ttf(source: ShiftIrSource) -> Result<Vec<u8>, ExportError> {
    let bytes = fontc::generate_font(Box::new(source), fontc::Options::default())
        .map_err(|error| compile_error(&error))?;
    strip_compiler_version(&bytes)
}

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

fn map_source_error(error: ShiftIrSourceError) -> ExportError {
    match error {
        ShiftIrSourceError::UnsupportedCrossAxisMappings { mapping_count } => {
            ExportError::UnsupportedCrossAxisMappings { mapping_count }
        }
        error => ExportError::InvalidSource {
            message: error.to_string(),
        },
    }
}

fn ensure_ttf_output_path(path: &Path) -> Result<(), ExportError> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("ttf") => Ok(()),
        _ => Err(ExportError::OutputExtensionMismatch {
            path: path.to_path_buf(),
        }),
    }
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
            }
        );

        let bytes = std::fs::read(&output_path).unwrap();
        assert!(!bytes.is_empty());

        let exported = FontRef::new(&bytes).unwrap();
        assert!(exported
            .charmap()
            .mappings()
            .any(|(codepoint, _)| codepoint == 0x0041));
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
            ExportError::OutputExtensionMismatch { path } if path == output_path
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
        let mut input = Location::new();
        input.set(weight.id(), 400.0);
        let mut output = Location::new();
        output.set(optical.id(), 12.0);
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
