//! WOFF2 binaries hold the same font as the TrueType binary they are encoded
//! from, decoded by an independent decoder.

use std::path::Path;

use shift_backends::{BinaryEncoding, BinaryEncodings, ExportFormat, FontExporter};
use shift_font::test_support::sample_variable_font;
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider};

/// A fixture step that fails with a reason instead of panicking.
type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

/// Every point a glyph's outline draws, in order.
#[derive(Default, Debug, PartialEq)]
struct Points(Vec<(f32, f32)>);

impl OutlinePen for Points {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.0.extend([(cx0, cy0), (x, y)]);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.extend([(cx0, cy0), (cx1, cy1), (x, y)]);
    }
    fn close(&mut self) {}
}

/// What a binary holds, as a reader sees it at its default location.
#[derive(Debug, PartialEq)]
struct FontContents {
    tables: Vec<String>,
    mappings: Vec<(u32, GlyphId)>,
    advances: Vec<Option<f32>>,
    outlines: Vec<Points>,
}

fn contents(bytes: &[u8]) -> Fixture<FontContents> {
    let font = FontRef::new(bytes)?;
    let glyph_count = font.maxp()?.num_glyphs();
    let metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
    let outlines = font.outline_glyphs();
    let mut advances = Vec::new();
    let mut points = Vec::new();
    for index in 0..glyph_count {
        let gid = GlyphId::from(index);
        advances.push(metrics.advance_width(gid));
        let mut pen = Points::default();
        if let Some(glyph) = outlines.get(gid) {
            glyph.draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut pen,
            )?;
        }
        points.push(pen);
    }
    let mut tables: Vec<String> = font
        .table_directory
        .table_records()
        .iter()
        .map(|record| record.tag().to_string())
        .collect();
    tables.sort();
    Ok(FontContents {
        tables,
        mappings: font.charmap().mappings().collect(),
        advances,
        outlines: points,
    })
}

fn decoded_woff2(path: &Path) -> Fixture<Vec<u8>> {
    let bytes = std::fs::read(path)?;
    if !bytes.starts_with(b"wOF2") {
        return Err(format!("{} is not a WOFF2 file", path.display()).into());
    }
    Ok(wuff::decompress_woff2(&bytes).map_err(|error| format!("{error:?}"))?)
}

#[test]
fn a_woff2_export_holds_the_same_font_as_its_ttf() {
    let font = sample_variable_font();
    let temp = tempfile::tempdir().unwrap();
    let request = FontExporter::request_in(&font, ExportFormat::Ttf, temp.path());
    let encodings = BinaryEncodings::new([BinaryEncoding::Ttf, BinaryEncoding::Woff2]).unwrap();

    let result = FontExporter::new()
        .export_with(&font, request, &encodings)
        .unwrap();

    let [ttf, woff2] = result.files.as_slice() else {
        panic!("expected a .ttf and a .woff2, got {:?}", result.files);
    };
    assert_eq!(woff2, &ttf.with_extension("woff2"));
    assert_eq!(
        contents(&decoded_woff2(woff2).unwrap()).unwrap(),
        contents(&std::fs::read(ttf).unwrap()).unwrap()
    );
}

#[test]
fn static_fonts_can_be_exported_as_woff2_alone() {
    let font = sample_variable_font();
    let temp = tempfile::tempdir().unwrap();
    let request = FontExporter::request_in(&font, ExportFormat::StaticTtf, temp.path());
    let encodings = BinaryEncodings::new([BinaryEncoding::Woff2]).unwrap();

    let result = FontExporter::new()
        .export_with(&font, request, &encodings)
        .unwrap();

    assert_eq!(result.files, [temp.path().join("UntitledFont-Bold.woff2")]);
    let decoded = contents(&decoded_woff2(&result.files[0]).unwrap()).unwrap();
    assert!(
        decoded
            .mappings
            .iter()
            .any(|(codepoint, _)| *codepoint == 0x41)
    );
    assert!(!temp.path().join("UntitledFont-Bold.ttf").exists());
}
