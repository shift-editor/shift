use std::collections::HashMap;
use std::path::Path;

use shift_font::Font;
#[cfg(not(target_arch = "wasm32"))]
use shift_store::ShiftStore;

use crate::errors::{BackendError, BackendResult, FormatBackendError, FormatBackendResult};
use crate::font_source::{FontReadError, OpenedFont};
use crate::format::FontFormat;
use crate::formats::designspace::{DesignspaceFont, DesignspaceReader, DesignspaceWriter};
use crate::formats::glyphs::{GlyphsFont, GlyphsReader};
use crate::formats::opentype::{BytesFontAdaptor, OpenTypeFont};
use crate::formats::ufo::{UfoFont, UfoReader, UfoWriter};
use crate::import::{FontImport, PreparedImport};
use crate::traits::{FontReader, FontWriter};

pub(crate) trait FontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font>;
    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()>;

    fn stream(&self, _path: &str) -> FormatBackendResult<Option<PreparedImport>> {
        Ok(None)
    }
}

struct UfoFontAdaptor;
struct GlyphsFontAdaptor;
struct DesignspaceFontAdaptor;
#[cfg(not(target_arch = "wasm32"))]
struct ShiftDocumentAdaptor;

#[cfg(not(target_arch = "wasm32"))]
impl FontAdaptor for ShiftDocumentAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        Ok(ShiftStore::open_document(path)?.load_font_state()?)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> FormatBackendResult<()> {
        Err(FormatBackendError::WriteUnsupported)
    }
}

impl FontAdaptor for UfoFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        UfoReader::new().load(path)
    }

    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        UfoWriter::new().save(font, path)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<PreparedImport>> {
        let (header, stream, report) = crate::formats::ufo::stream_font(path)?;
        Ok(Some((header, Box::new(stream), report)))
    }
}

impl FontAdaptor for GlyphsFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        GlyphsReader::new().load(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> FormatBackendResult<()> {
        Err(FormatBackendError::WriteUnsupported)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<PreparedImport>> {
        let (header, stream, report) = crate::formats::glyphs::stream_font(path)?;
        Ok(Some((header, Box::new(stream), report)))
    }
}

impl FontAdaptor for DesignspaceFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        DesignspaceReader::new().load(path)
    }

    fn write_font(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        DesignspaceWriter::new().save(font, path)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<PreparedImport>> {
        let (header, stream, report) = crate::formats::designspace::stream_font(path)?;
        Ok(Some((header, Box::new(stream), report)))
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
        format: FontFormat::from_extension(extension).ok_or_else(|| {
            BackendError::UnsupportedFormat {
                extension: extension.to_string(),
            }
        })?,
        path,
        path_buf: parsed.to_path_buf(),
        extension,
    })
}

impl FontLoader {
    pub fn new() -> Self {
        let mut adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>> = HashMap::new();
        #[cfg(not(target_arch = "wasm32"))]
        adaptors.insert(FontFormat::Shift, Box::new(ShiftDocumentAdaptor));
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

    /// Opens a retained random-access source without constructing an authored Font.
    ///
    /// # Errors
    ///
    /// Returns [`FontReadError::UnsupportedFormat`] for a `.shift` path or one without a font
    /// extension, [`FontReadError::Io`] when the file cannot be read, and
    /// [`FontReadError::MalformedSource`] when it cannot be parsed.
    #[allow(
        clippy::unused_self,
        reason = "a loader method beside load; retained sources need no adaptor yet"
    )]
    pub fn open_source(&self, path: &Path) -> Result<OpenedFont, FontReadError> {
        let format = FontFormat::of_path(path).ok_or_else(|| FontReadError::UnsupportedFormat {
            path: path.to_path_buf(),
        })?;

        match format {
            FontFormat::Ttf | FontFormat::Otf => OpenTypeFont::open(path).map(OpenedFont::OpenType),
            FontFormat::Ufo => UfoFont::open(path).map(OpenedFont::Ufo),
            FontFormat::Designspace => DesignspaceFont::open(path).map(OpenedFont::Designspace),
            FontFormat::Glyphs => GlyphsFont::open(path).map(OpenedFont::Glyphs),
            FontFormat::Shift => Err(FontReadError::UnsupportedFormat {
                path: path.to_path_buf(),
            }),
        }
    }

    /// Opens `path` as a bounded glyph stream for import.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::MissingExtension`] or [`BackendError::UnsupportedFormat`] when the
    /// path does not name a supported format, [`BackendError::StreamingUnsupported`] when the
    /// format cannot stream, and [`BackendError::Load`] when the source cannot be read.
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
        let (header, stream, report) = streamed;
        Ok(FontImport::new(
            header,
            stream,
            report,
            resolved.format,
            resolved.path_buf,
        ))
    }

    /// Reads the whole font at `path`.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::MissingExtension`] or [`BackendError::UnsupportedFormat`] when the
    /// path does not name a supported format, and [`BackendError::Load`] when the source cannot be
    /// read.
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
        if let Some((header, stream, report)) = streamed {
            return FontImport::new(header, stream, report, resolved.format, resolved.path_buf)
                .collect_font();
        }

        adaptor
            .read_font(resolved.path)
            .map_err(|source| BackendError::load(resolved.format, resolved.path_buf, source))
    }

    /// Writes `font` to `path` as a UFO or Designspace.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::UnsupportedWriteFormat`] for any other extension, and
    /// [`BackendError::Save`] when the font cannot be written.
    pub fn write_font(&self, font: &Font, path: &str) -> BackendResult<()> {
        let resolved = resolve(path)?;

        match resolved.format {
            FontFormat::Ufo | FontFormat::Designspace | FontFormat::Shift => {}
            _ => {
                return Err(BackendError::UnsupportedWriteFormat {
                    extension: resolved.extension.to_string(),
                });
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
    use shift_font::test_support::fixtures;

    use super::FontLoader;
    use crate::ImportBatchLimit;
    use crate::font_source::OpenedFont;
    use crate::format::FontFormat;

    #[test]
    fn retained_source_dispatch_preserves_import_capabilities() {
        let loader = FontLoader::new();
        let open_type = loader
            .open_source(&fixtures::font("mutatorsans/MutatorSans.ttf"))
            .unwrap();
        let ufo = loader
            .open_source(&fixtures::font("mutatorsans/MutatorSansLightCondensed.ufo"))
            .unwrap();
        let glyphs = loader
            .open_source(&fixtures::font("Homenaje.glyphs"))
            .unwrap();

        assert!(matches!(&open_type, OpenedFont::OpenType(_)));
        assert!(open_type.importer().is_none());
        assert!(matches!(&ufo, OpenedFont::Ufo(_)));
        let mut ufo_import = ufo.importer().unwrap().begin_import().unwrap();
        assert!(ufo_import.glyph_count() > 0);
        assert_eq!(
            ufo_import
                .next_batch(ImportBatchLimit::new(1, 1))
                .unwrap()
                .len(),
            1
        );
        assert!(matches!(&glyphs, OpenedFont::Glyphs(_)));
        let mut glyphs_import = glyphs.importer().unwrap().begin_import().unwrap();
        assert!(glyphs_import.glyph_count() > 0);
        assert_eq!(
            glyphs_import
                .next_batch(ImportBatchLimit::new(1, 1))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn supports_glyphs_extensions() {
        assert!(matches!(
            FontFormat::from_extension("glyphs"),
            Some(FontFormat::Glyphs)
        ));
        assert!(matches!(
            FontFormat::from_extension("glyphspackage"),
            Some(FontFormat::Glyphs)
        ));
    }

    #[test]
    fn supports_designspace_extension() {
        assert!(matches!(
            FontFormat::from_extension("designspace"),
            Some(FontFormat::Designspace)
        ));
    }

    #[test]
    fn supports_shift_extension() {
        assert!(matches!(
            FontFormat::from_extension("shift"),
            Some(FontFormat::Shift)
        ));
    }

    #[test]
    fn extension_matching_is_case_insensitive() {
        assert!(matches!(
            FontFormat::from_extension("UFO"),
            Some(FontFormat::Ufo)
        ));
        assert!(matches!(
            FontFormat::from_extension("SHIFT"),
            Some(FontFormat::Shift)
        ));
        assert!(matches!(
            FontFormat::from_extension("GLYPHS"),
            Some(FontFormat::Glyphs)
        ));
        assert!(matches!(
            FontFormat::from_extension("OTF"),
            Some(FontFormat::Otf)
        ));
        assert!(matches!(
            FontFormat::from_extension("DESIGNSPACE"),
            Some(FontFormat::Designspace)
        ));
    }
}
