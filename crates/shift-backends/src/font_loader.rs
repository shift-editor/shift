use std::collections::HashMap;
use std::path::Path;

use shift_font::Font;
use shift_source::ShiftSourcePackage;

use crate::designspace::{DesignspaceReader, DesignspaceWriter};
use crate::errors::{BackendError, BackendResult, FormatBackendError, FormatBackendResult};
use crate::format::FontFormat;
use crate::glyphs::GlyphsReader;
use crate::import::{FontImport, GlyphStream};
use crate::traits::{FontReader, FontWriter};
use crate::ufo::{UfoReader, UfoWriter};

use crate::binary::BytesFontAdaptor;

pub(crate) trait FontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font>;
    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()>;

    fn stream(&self, _path: &str) -> FormatBackendResult<Option<(Font, Box<dyn GlyphStream>)>> {
        Ok(None)
    }
}

struct UfoFontAdaptor;
struct GlyphsFontAdaptor;
struct DesignspaceFontAdaptor;
struct ShiftFontAdaptor;

impl FontAdaptor for ShiftFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        ShiftSourcePackage::load_font(path).map_err(FormatBackendError::from)
    }

    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        ShiftSourcePackage::save_font(path, font)
            .map(|_| ())
            .map_err(FormatBackendError::from)
    }
}

impl FontAdaptor for UfoFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        UfoReader::new().load(path)
    }

    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        UfoWriter::new().save(font, path)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<(Font, Box<dyn GlyphStream>)>> {
        let (header, stream) = crate::ufo::stream_font(path)?;
        Ok(Some((header, Box::new(stream))))
    }
}

impl FontAdaptor for GlyphsFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        GlyphsReader::new().load(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> FormatBackendResult<()> {
        Err(FormatBackendError::WriteUnsupported)
    }
}

impl FontAdaptor for DesignspaceFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        DesignspaceReader::new().load(path)
    }

    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        DesignspaceWriter::new().save(font, path)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<(Font, Box<dyn GlyphStream>)>> {
        let (header, stream) = crate::designspace::stream_font(path)?;
        Ok(Some((header, Box::new(stream))))
    }
}

pub struct FontLoader {
    adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>>,
}

impl Default for FontLoader {
    fn default() -> Self {
        Self::new()
    }
}

fn format_from_extension(ext: &str) -> BackendResult<FontFormat> {
    match ext.to_ascii_lowercase().as_str() {
        "shift" => Ok(FontFormat::Shift),
        "ufo" => Ok(FontFormat::Ufo),
        "glyphs" => Ok(FontFormat::Glyphs),
        "glyphspackage" => Ok(FontFormat::Glyphs),
        "designspace" => Ok(FontFormat::Designspace),
        "ttf" => Ok(FontFormat::Ttf),
        "otf" => Ok(FontFormat::Otf),
        _ => Err(BackendError::UnsupportedFormat {
            extension: ext.to_string(),
        }),
    }
}

fn extension_from_path(path: &Path) -> BackendResult<&str> {
    path.extension()
        .ok_or_else(|| BackendError::MissingExtension {
            path: path.to_path_buf(),
        })?
        .to_str()
        .ok_or_else(|| BackendError::InvalidExtensionUtf8 {
            path: path.to_path_buf(),
        })
}

struct ResolvedPath<'a> {
    format: FontFormat,
    path: &'a str,
    path_buf: std::path::PathBuf,
    extension: &'a str,
}

fn resolve(path: &str) -> BackendResult<ResolvedPath<'_>> {
    let parsed = Path::new(path);
    let extension = extension_from_path(parsed)?;
    Ok(ResolvedPath {
        format: format_from_extension(extension)?,
        path,
        path_buf: parsed.to_path_buf(),
        extension,
    })
}

impl FontLoader {
    pub fn new() -> Self {
        let mut adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>> = HashMap::new();
        adaptors.insert(FontFormat::Shift, Box::new(ShiftFontAdaptor));
        adaptors.insert(FontFormat::Ufo, Box::new(UfoFontAdaptor));
        adaptors.insert(FontFormat::Glyphs, Box::new(GlyphsFontAdaptor));
        adaptors.insert(FontFormat::Designspace, Box::new(DesignspaceFontAdaptor));
        adaptors.insert(FontFormat::Ttf, Box::new(BytesFontAdaptor));
        adaptors.insert(FontFormat::Otf, Box::new(BytesFontAdaptor));

        Self { adaptors }
    }

    pub fn available_formats(&self) -> Vec<&FontFormat> {
        self.adaptors.keys().collect()
    }

    pub fn stream_font(&self, path: &str) -> BackendResult<FontImport> {
        let resolved = resolve(path)?;
        let adaptor = self
            .adaptors
            .get(&resolved.format)
            .ok_or(BackendError::MissingAdaptor {
                format: resolved.format,
            })?;
        let streamed = adaptor
            .stream(resolved.path)
            .map_err(|source| {
                BackendError::load(resolved.format, resolved.path_buf.clone(), source)
            })?
            .ok_or(BackendError::StreamingUnsupported {
                format: resolved.format,
            })?;
        Ok(FontImport::new(
            streamed.0,
            streamed.1,
            resolved.format,
            resolved.path_buf,
        ))
    }

    pub fn read_font(&self, path: &str) -> BackendResult<Font> {
        let resolved = resolve(path)?;
        let adaptor = self
            .adaptors
            .get(&resolved.format)
            .ok_or(BackendError::MissingAdaptor {
                format: resolved.format,
            })?;
        let streamed = adaptor.stream(resolved.path).map_err(|source| {
            BackendError::load(resolved.format, resolved.path_buf.clone(), source)
        })?;
        if let Some((header, stream)) = streamed {
            return FontImport::new(header, stream, resolved.format, resolved.path_buf)
                .collect_font();
        }

        adaptor
            .read_font(resolved.path)
            .map_err(|source| BackendError::load(resolved.format, resolved.path_buf, source))
    }

    pub fn write_font(&self, font: &Font, path: &str) -> BackendResult<()> {
        let resolved = resolve(path)?;

        match resolved.format {
            FontFormat::Ufo | FontFormat::Designspace | FontFormat::Shift => {}
            _ => {
                return Err(BackendError::UnsupportedWriteFormat {
                    extension: resolved.extension.to_string(),
                })
            }
        }

        let adaptor = self
            .adaptors
            .get(&resolved.format)
            .ok_or(BackendError::MissingAdaptor {
                format: resolved.format,
            })?;
        adaptor
            .write_font(font, resolved.path)
            .map_err(|source| BackendError::save(resolved.format, resolved.path_buf, source))
    }
}

#[cfg(test)]
mod tests {
    use super::format_from_extension;
    use crate::format::FontFormat;

    #[test]
    fn supports_glyphs_extensions() {
        assert!(matches!(
            format_from_extension("glyphs"),
            Ok(FontFormat::Glyphs)
        ));
        assert!(matches!(
            format_from_extension("glyphspackage"),
            Ok(FontFormat::Glyphs)
        ));
    }

    #[test]
    fn supports_designspace_extension() {
        assert!(matches!(
            format_from_extension("designspace"),
            Ok(FontFormat::Designspace)
        ));
    }

    #[test]
    fn supports_shift_extension() {
        assert!(matches!(
            format_from_extension("shift"),
            Ok(FontFormat::Shift)
        ));
    }

    #[test]
    fn extension_matching_is_case_insensitive() {
        assert!(matches!(format_from_extension("UFO"), Ok(FontFormat::Ufo)));
        assert!(matches!(
            format_from_extension("SHIFT"),
            Ok(FontFormat::Shift)
        ));
        assert!(matches!(
            format_from_extension("GLYPHS"),
            Ok(FontFormat::Glyphs)
        ));
        assert!(matches!(format_from_extension("OTF"), Ok(FontFormat::Otf)));
        assert!(matches!(
            format_from_extension("DESIGNSPACE"),
            Ok(FontFormat::Designspace)
        ));
    }
}
