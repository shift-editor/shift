//! The editor joins proof text by cursive attachment as the exported font
//! does: shift-font's `attach_cursive`, over the shaper the editor shapes
//! with and the font's own advances and anchors, places every glyph where
//! HarfRust places it in the font fontc exports.

use std::path::PathBuf;
use std::sync::Arc;

use shift_backends::FontExporter;
use shift_backends::font_loader::FontLoader;
use shift_backends::shaper_font::{
    LiveShaper, ParagraphRequest, ShapeUnit, ShaperFont, ShaperFontRequest,
};
use shift_font::cursive::{
    CursiveDirection, CursiveGlyph, CursivePosition, ENTRY_ANCHOR, EXIT_ANCHOR, attach_cursive,
};
use shift_font::kurbo::Point;
use shift_font::{ExternalLocation, Font, GlyphId};
use shift_shape::{FontGlyphs, Shaper, TextDirection, Unit};

/// A glyph's place on the line: where its outline is drawn, in font units.
#[derive(Debug, PartialEq)]
struct Placed {
    x: f64,
    y: f64,
}

fn shaping_test() -> Font {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/ShapingTest.ufo");
    FontLoader::new().read_font(path.to_str().unwrap()).unwrap()
}

/// Shapes `text` with the exported font, cursive lookups and all.
fn exported(font: &Font, text: &str) -> Vec<Placed> {
    let bytes = FontExporter::new().compile_ttf(font).unwrap();
    let shaper = Shaper::new(bytes).unwrap();
    let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
    let paragraph = shaper
        .shape_paragraph(
            &FontGlyphs,
            &shift_shape::ParagraphRequest {
                units: &units,
                location: &[],
                script: None,
                language: None,
                features: &[],
            },
        )
        .unwrap();

    let mut pen = 0.0;
    let mut placed = Vec::new();
    for run in paragraph.runs {
        for glyph in run.glyphs {
            placed.push(Placed {
                x: pen + f64::from(glyph.x_offset),
                y: f64::from(glyph.y_offset),
            });
            pen += f64::from(glyph.x_advance);
        }
    }
    placed
}

/// Shapes `text` as the editor does: the feature code alone, then the
/// font's own advances, then cursive attachment from its anchors.
fn previewed(font: &Font, text: &str) -> Vec<Placed> {
    let compilation = ShaperFont::compile(&ShaperFontRequest::from_font(font).unwrap()).unwrap();
    let shaper = LiveShaper::new(Arc::new(compilation.font.unwrap()), font).unwrap();
    let units: Vec<ShapeUnit> = text.chars().map(ShapeUnit::Character).collect();
    let location = ExternalLocation::new();
    let paragraph = shaper
        .shape_paragraph(&ParagraphRequest {
            units: &units,
            location: &location,
            script: None,
            language: None,
            features: &[],
        })
        .unwrap();

    let source = font.default_source().unwrap().id();
    let mut placed = Vec::new();
    let mut pen = 0.0;
    for run in paragraph.runs {
        let direction = match run.direction {
            TextDirection::LeftToRight => CursiveDirection::LeftToRight,
            TextDirection::RightToLeft => CursiveDirection::RightToLeft,
        };
        // Visual order in, reading order to attach.
        let mut glyphs: Vec<CursiveGlyph> = run
            .glyphs
            .iter()
            .map(|shaped| {
                let id: &GlyphId = shaped.glyph_id.as_ref().unwrap();
                let glyph = font.glyph(id).unwrap();
                let layer = glyph.layer_for_source(&source).unwrap();
                let anchor = |name: &str| {
                    layer
                        .anchors()
                        .iter()
                        .find(|anchor| anchor.name() == Some(name))
                        .map(|anchor| Point::new(anchor.x(), anchor.y()))
                };
                // A mark takes no advance, as the shaper zeroes the GDEF marks export classes.
                let advance = if shaped.is_mark { 0.0 } else { layer.width() };
                CursiveGlyph {
                    entry: anchor(ENTRY_ANCHOR),
                    exit: anchor(EXIT_ANCHOR),
                    is_mark: shaped.is_mark,
                    position: CursivePosition {
                        x_advance: advance + f64::from(shaped.x_advance),
                        x_offset: f64::from(shaped.x_offset),
                        y_offset: f64::from(shaped.y_offset),
                    },
                }
            })
            .collect();
        if direction == CursiveDirection::RightToLeft {
            glyphs.reverse();
        }
        let mut positions = attach_cursive(&glyphs, direction);
        if direction == CursiveDirection::RightToLeft {
            positions.reverse();
        }
        for position in positions {
            placed.push(Placed {
                x: pen + position.x_offset,
                y: position.y_offset,
            });
            pen += position.x_advance;
        }
    }
    placed
}

#[test]
fn a_joined_arabic_word_steps_as_the_exported_font_sets_it() {
    let font = shaping_test();
    let text = "\u{0628}\u{0628}\u{0628}";

    let preview = previewed(&font, text);

    assert_eq!(preview, exported(&font, text));
    // The word's end stays on the baseline and each earlier letter steps up.
    let heights: Vec<f64> = preview.iter().map(|glyph| glyph.y).collect();
    assert_eq!(heights, [0.0, 200.0, 400.0]);
}

#[test]
fn a_mark_inside_a_joined_word_neither_joins_nor_breaks_it_as_exported() {
    let font = shaping_test();
    let text = "\u{0628}\u{0670}\u{0628}";

    assert_eq!(previewed(&font, text), exported(&font, text));
}
