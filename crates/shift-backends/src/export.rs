use std::path::{Path, PathBuf};

use crate::atomic::write_file_atomic;
use crate::shift2fontir::{ShiftIrSource, ShiftIrSourceError};
use crate::traits::FontView;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportFormat {
    Ttf,
}

impl ExportFormat {
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontExportRequest {
    pub path: PathBuf,
    pub format: ExportFormat,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontExportResult {
    pub path: PathBuf,
    pub format: ExportFormat,
}

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

pub struct FontExporter;

impl FontExporter {
    pub fn new() -> Self {
        Self
    }

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
        font.add_axis(weight);
        font.add_axis(optical);
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
