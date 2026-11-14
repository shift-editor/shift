//! The oracle the fuzz targets share: whatever Shift reads, it exports, and
//! exporting what it read back from that export writes the same files.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_backends::{
    BackendError, ExportError, ExportFormat, FontExportRequest, FontExporter, FontView,
};

/// What one fuzz input showed about reading and exporting.
#[derive(Debug)]
pub enum FixedPoint {
    /// Shift does not read the input, so there is nothing to export.
    Unreadable,
    /// Shift reads the input but refuses to export it in the format.
    NotExportable,
    /// The export reads back and exports to the same files.
    Holds,
    /// Reading or writing is wrong for this input.
    Broken(FixedPointFailure),
}

impl FixedPoint {
    /// Whether this input found a reader or writer bug.
    pub fn is_broken(&self) -> bool {
        matches!(self, Self::Broken(_))
    }
}

/// How an export failed to be a fixed point.
#[derive(Debug)]
pub enum FixedPointFailure {
    /// The fuzz harness could not set up or inspect its files.
    Io(std::io::Error),
    /// The harness could not write the UFO the input is placed in.
    Frame(norad::error::FontWriteError),
    /// A temporary path was not UTF-8.
    NonUtf8Path(PathBuf),
    /// Shift wrote files it cannot read back.
    ExportDidNotReadBack(BackendError),
    /// The font read back from an export cannot be exported again.
    ReadBackDidNotExport(ExportError),
    /// Exporting the read-back font wrote different files.
    FilesDiffer { paths: Vec<PathBuf> },
}

/// Checks a fuzzed designspace document whose sources may name `Light.ufo`
/// and `Bold.ufo`, which are written beside it.
pub fn designspace_fixed_point(document: &[u8]) -> FixedPoint {
    outcome(|| {
        let directory = tempfile::tempdir().map_err(FixedPointFailure::Io)?;
        write_master_ufo(&directory.path().join("Light.ufo"), "Light")?;
        write_master_ufo(&directory.path().join("Bold.ufo"), "Bold")?;
        let path = directory.path().join("Fuzz.designspace");
        std::fs::write(&path, document).map_err(FixedPointFailure::Io)?;
        export_fixed_point(&path, ExportFormat::Designspace)
    })
}

/// Checks a fuzzed `.glif` placed as glyph `A` of an otherwise valid UFO.
pub fn glif_fixed_point(glif: &[u8]) -> FixedPoint {
    outcome(|| {
        let directory = tempfile::tempdir().map_err(FixedPointFailure::Io)?;
        let path = directory.path().join("Fuzz.ufo");
        write_master_ufo(&path, "Regular")?;
        std::fs::write(path.join("glyphs").join("A_.glif"), glif).map_err(FixedPointFailure::Io)?;
        export_fixed_point(&path, ExportFormat::Ufo)
    })
}

fn outcome(check: impl FnOnce() -> Result<FixedPoint, FixedPointFailure>) -> FixedPoint {
    check().unwrap_or_else(FixedPoint::Broken)
}

/// Reads the font at `input` and, when Shift reads and exports it as
/// `format`, exports what it read back from that export and compares the
/// two exports file by file.
fn export_fixed_point(input: &Path, format: ExportFormat) -> Result<FixedPoint, FixedPointFailure> {
    let Ok(font) = FontLoader::new().read_font(utf8(input)?) else {
        return Ok(FixedPoint::Unreadable);
    };

    let first = tempfile::tempdir().map_err(FixedPointFailure::Io)?;
    let first_path = output_path(first.path(), format);
    if export(&font, &first_path, format).is_err() {
        return Ok(FixedPoint::NotExportable);
    }

    let read_back = FontLoader::new()
        .read_font(utf8(&first_path)?)
        .map_err(FixedPointFailure::ExportDidNotReadBack)?;
    let second = tempfile::tempdir().map_err(FixedPointFailure::Io)?;
    export(&read_back, &output_path(second.path(), format), format)
        .map_err(FixedPointFailure::ReadBackDidNotExport)?;

    let first_files = tree(first.path())?;
    let second_files = tree(second.path())?;
    let paths: Vec<_> = first_files
        .keys()
        .chain(second_files.keys())
        .filter(|path| first_files.get(*path) != second_files.get(*path))
        .cloned()
        .collect();
    if !paths.is_empty() {
        return Err(FixedPointFailure::FilesDiffer { paths });
    }
    Ok(FixedPoint::Holds)
}

fn utf8(path: &Path) -> Result<&str, FixedPointFailure> {
    path.to_str()
        .ok_or_else(|| FixedPointFailure::NonUtf8Path(path.to_path_buf()))
}

fn output_path(directory: &Path, format: ExportFormat) -> PathBuf {
    directory.join(format!("Fuzz.{}", format.extension()))
}

fn export(font: &impl FontView, path: &Path, format: ExportFormat) -> Result<(), ExportError> {
    FontExporter::new()
        .export(
            font,
            FontExportRequest {
                path: path.to_path_buf(),
                format,
            },
        )
        .map(|_| ())
}

/// Every file under `root`, by its path relative to `root`.
fn tree(root: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>, FixedPointFailure> {
    let mut files = BTreeMap::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let path = root.join(&relative);
        if path.is_dir() {
            for entry in std::fs::read_dir(&path).map_err(FixedPointFailure::Io)? {
                let name = entry.map_err(FixedPointFailure::Io)?.file_name();
                pending.push(relative.join(name));
            }
            continue;
        }
        let bytes = std::fs::read(&path).map_err(FixedPointFailure::Io)?;
        files.insert(relative, bytes);
    }
    Ok(files)
}

/// Writes a one-glyph UFO at `path`, as a master for fuzzed designspaces and
/// a frame for fuzzed glyphs.
fn write_master_ufo(path: &Path, style: &str) -> Result<(), FixedPointFailure> {
    let mut ufo = norad::Font::new();
    ufo.font_info.family_name = Some("Fuzz".to_string());
    ufo.font_info.style_name = Some(style.to_string());
    ufo.font_info.units_per_em = Some(1000_u32.into());
    let mut glyph = norad::Glyph::new("A");
    glyph.width = 500.0;
    glyph.codepoints.insert('A');
    ufo.layers.default_layer_mut().insert_glyph(glyph);
    ufo.save(path).map_err(FixedPointFailure::Frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(path: &str) -> Vec<u8> {
        std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("seeds")
                .join(path),
        )
        .unwrap()
    }

    #[test]
    fn designspace_seed_reads_and_is_a_fixed_point() {
        let outcome = designspace_fixed_point(&seed("designspace/Fuzz.designspace"));

        assert!(matches!(outcome, FixedPoint::Holds), "{outcome:?}");
    }

    #[test]
    fn glif_seed_reads_and_is_a_fixed_point() {
        let outcome = glif_fixed_point(&seed("glif/A.glif"));

        assert!(matches!(outcome, FixedPoint::Holds), "{outcome:?}");
    }

    #[test]
    fn unreadable_input_is_not_a_failure() {
        let outcome = glif_fixed_point(b"not a glyph");

        assert!(matches!(outcome, FixedPoint::Unreadable), "{outcome:?}");
    }
}
