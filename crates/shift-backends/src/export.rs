use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::traits::FontView;
use crate::ufo::UfoWriter;
use fontc::JobTimer;

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

#[derive(Clone, Debug)]
pub struct FontExportRequest {
    pub path: PathBuf,
    pub format: ExportFormat,
}

#[derive(Clone, Debug)]
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

    #[error("invalid UTF-8 in {label} path: {path}")]
    InvalidPathUtf8 { label: &'static str, path: PathBuf },

    #[error("failed to create temporary export directory")]
    TempDir {
        #[source]
        source: std::io::Error,
    },

    #[error("failed to prepare temporary UFO for export: {message}")]
    PrepareUfo { message: String },

    #[error("failed to compile TrueType font: {message}")]
    CompileTtf { message: String },
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

        let ufo_path = temp_dir.path().join("source.ufo");
        let build_dir = temp_dir.path().join("build");
        let ufo_path_str = path_to_str(&ufo_path, "temporary UFO")?;

        UfoWriter::new()
            .save_view(font, ufo_path_str)
            .map_err(|message| ExportError::PrepareUfo { message })?;

        compile_ttf(ufo_path_str, &build_dir, output_path)
    }
}

impl Default for FontExporter {
    fn default() -> Self {
        Self::new()
    }
}

fn compile_ttf(input_path: &str, build_dir: &Path, output_path: &Path) -> Result<(), ExportError> {
    let mut args = fontc::Args::new(build_dir, input_path.into());
    args.output_file = Some(output_path.to_path_buf());

    let timer = JobTimer::new(Instant::now());
    fontc::run(args, timer).map_err(|source| ExportError::CompileTtf {
        message: source.to_string(),
    })
}

fn ensure_ttf_output_path(path: &Path) -> Result<(), ExportError> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("ttf") => Ok(()),
        _ => Err(ExportError::OutputExtensionMismatch {
            path: path.to_path_buf(),
        }),
    }
}

fn path_to_str<'a>(path: &'a Path, label: &'static str) -> Result<&'a str, ExportError> {
    path.to_str().ok_or_else(|| ExportError::InvalidPathUtf8 {
        label,
        path: path.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::{Contour, Font, Glyph, GlyphLayer, LayerId, PointType};
    use skrifa::{FontRef, MetadataProvider};

    fn simple_font() -> Font {
        let mut font = Font::new();
        let default_source_id = font.default_source_id().unwrap();
        let mut glyph = Glyph::with_unicode("A".to_string(), 0x0041);
        let mut layer = GlyphLayer::with_width(LayerId::new(), default_source_id, 600.0);
        let mut contour = Contour::new();
        contour.add_point(100.0, 0.0, PointType::OnCurve, false);
        contour.add_point(300.0, 700.0, PointType::OnCurve, false);
        contour.add_point(500.0, 0.0, PointType::OnCurve, false);
        contour.close();
        layer.add_contour(contour);
        glyph.set_layer(layer);
        font.insert_glyph(glyph);
        font
    }

    #[test]
    fn exports_ttf_that_can_be_read_back() {
        let temp_dir = tempfile::tempdir().unwrap();
        let output_path = temp_dir.path().join("Dogfood.ttf");
        let font = simple_font();

        let result = FontExporter::new()
            .export(
                &font,
                FontExportRequest {
                    path: output_path.clone(),
                    format: ExportFormat::Ttf,
                },
            )
            .unwrap();

        assert_eq!(result.path, output_path);
        assert_eq!(result.format, ExportFormat::Ttf);

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
        let font = simple_font();

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
}
