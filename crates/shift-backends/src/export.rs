//! Compiles Shift font views into distributable font binaries.
//!
//! Compilation consumes an owned snapshot of the supplied [`FontView`]. The
//! completed binary is staged beside its destination and replaces that path
//! only after compilation succeeds, so a partial font is never exposed.

use std::path::{Path, PathBuf};

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

    #[error("failed to create temporary export directory")]
    TempDir {
        #[source]
        source: std::io::Error,
    },

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

    fn export_ttf(&self, font: &impl FontView, output_path: &Path) -> Result<(), ExportError> {
        ensure_ttf_output_path(output_path)?;

        let temp_dir = tempfile::Builder::new()
            .prefix("shift-export-")
            .tempdir()
            .map_err(|source| ExportError::TempDir { source })?;

        let build_dir = temp_dir.path().join("build");
        let source = ShiftIrSource::from_font_view(font).map_err(map_source_error)?;
        let bytes = compile_ttf(source, &build_dir)?;
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

fn compile_ttf(source: ShiftIrSource, build_dir: &Path) -> Result<Vec<u8>, ExportError> {
    fontc::generate_font(
        Box::new(source),
        build_dir,
        None,
        fontc::Flags::default(),
        false,
    )
    .map_err(|source| ExportError::CompileTtf {
        message: source.to_string(),
    })
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
