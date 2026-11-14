//! The oracle the fuzz targets share: whatever Shift reads, it exports, and
//! exporting what it read back from that export writes the same files.

#![expect(
    clippy::expect_used,
    clippy::panic,
    reason = "a fuzz oracle reports a failure by panicking"
)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use shift_backends::font_loader::FontLoader;
use shift_backends::{ExportError, ExportFormat, FontExportRequest, FontExporter, FontView};

/// Reads the font at `input`; when that succeeds and Shift can export it as
/// `format`, checks that the export reads back and exports to byte-identical
/// files.
///
/// # Panics
///
/// Panics when an export cannot be read back or re-exported, or when the
/// second export differs from the first: each is a reader/writer bug.
pub fn assert_export_is_a_fixed_point(input: &Path, format: ExportFormat) {
    let Some(input) = input.to_str() else {
        return;
    };
    let Ok(font) = FontLoader::new().read_font(input) else {
        return;
    };

    let first = tempfile::tempdir().expect("temporary directory");
    let first_path = output_path(first.path(), format);
    if export(&font, &first_path, format).is_err() {
        return;
    }

    let read_back = FontLoader::new()
        .read_font(first_path.to_str().expect("UTF-8 temp path"))
        .unwrap_or_else(|error| panic!("an export did not read back: {error}"));
    let second = tempfile::tempdir().expect("temporary directory");
    let second_path = output_path(second.path(), format);
    export(&read_back, &second_path, format)
        .unwrap_or_else(|error| panic!("a read-back export did not export: {error}"));

    assert_eq!(
        tree(first.path()),
        tree(second.path()),
        "exporting the read-back font wrote different files"
    );
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

/// Every file under `root`, by relative path.
fn tree(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn collect(root: &Path, path: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        if path.is_file() {
            let relative = path.strip_prefix(root).expect("path under root");
            files.insert(
                relative.to_path_buf(),
                std::fs::read(path).expect("readable"),
            );
            return;
        }
        for entry in std::fs::read_dir(path).expect("readable directory") {
            collect(root, &entry.expect("directory entry").path(), files);
        }
    }

    let mut files = BTreeMap::new();
    collect(root, root, &mut files);
    files
}

/// Writes a one-glyph UFO at `path`, as a master for fuzzed designspaces and
/// a frame for fuzzed glyphs.
///
/// # Panics
///
/// Panics when the UFO cannot be written.
pub fn write_master_ufo(path: &Path, style: &str) {
    let mut ufo = norad::Font::new();
    ufo.font_info.family_name = Some("Fuzz".to_string());
    ufo.font_info.style_name = Some(style.to_string());
    ufo.font_info.units_per_em = Some(1000_u32.into());
    let mut glyph = norad::Glyph::new("A");
    glyph.width = 500.0;
    glyph.codepoints.insert('A');
    ufo.layers.default_layer_mut().insert_glyph(glyph);
    ufo.save(path).expect("fuzz master UFO saves");
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
        .expect("seed reads")
    }

    #[test]
    fn designspace_seed_is_a_fixed_point() {
        let directory = tempfile::tempdir().unwrap();
        write_master_ufo(&directory.path().join("Light.ufo"), "Light");
        write_master_ufo(&directory.path().join("Bold.ufo"), "Bold");
        let path = directory.path().join("Fuzz.designspace");
        std::fs::write(&path, seed("designspace/Fuzz.designspace")).unwrap();
        if let Err(error) = FontLoader::new().read_font(path.to_str().unwrap()) {
            panic!("the seed does not read: {error}");
        }

        assert_export_is_a_fixed_point(&path, ExportFormat::Designspace);
    }

    #[test]
    fn glif_seed_is_a_fixed_point() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Fuzz.ufo");
        write_master_ufo(&path, "Regular");
        std::fs::write(path.join("glyphs").join("A_.glif"), seed("glif/A.glif")).unwrap();
        if let Err(error) = FontLoader::new().read_font(path.to_str().unwrap()) {
            panic!("the seed does not read: {error}");
        }

        assert_export_is_a_fixed_point(&path, ExportFormat::Ufo);
    }
}
