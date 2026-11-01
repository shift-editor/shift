//! The editor lays proof text out as the exported font sets it: shift-text's layout,
//! over the shaper font and the live font's advances, kerning and anchors,
//! places every glyph where HarfRust places it in the font fontc exports,
//! whose generated kern, mark, mkmk and curs lookups do the same work.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use shift_backends::font_loader::FontLoader;
use shift_backends::{FontExporter, GlyphCategories};
use shift_font::test_support::fixtures;
use shift_font::{DesignLocation, ExternalLocation, Font, GlyphId, OpenTypeCategory};
use shift_text::layout::{
    LayoutFont, LayoutRequest, LayoutUnit, LineMetrics, TextLayout, TextOptions,
};
use shift_text::shape::{FontGlyphs, Shaper, Unit, visual_order};
use shift_text::shaper_font::{LiveShaper, ShaperFont, ShaperFontRequest};

/// A glyph where it is drawn, and how far it advances, in font units.
#[derive(Debug, PartialEq)]
struct Placed {
    x: f64,
    y: f64,
    advance: f64,
}

fn open(path: &std::path::Path) -> Font {
    FontLoader::new().read_font(path.to_str().unwrap()).unwrap()
}

fn fixture(name: &str) -> Font {
    open(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/fonts")
            .join(name),
    )
}

/// Shapes `text` with the exported font, generated lookups and all, at its
/// default, one line in display order.
fn exported(font: &Font, text: &str) -> Vec<Placed> {
    let bytes = FontExporter::new().compile_ttf(font).unwrap();
    let shaper = Shaper::new(bytes).unwrap();
    let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
    let paragraph = shaper
        .shape_paragraph(
            &FontGlyphs,
            &shift_text::shape::ParagraphRequest {
                units: &units,
                location: &[],
                direction: None,
                script: None,
                language: None,
                features: &[],
            },
            None,
        )
        .unwrap();
    let levels: Vec<u8> = paragraph.runs.iter().map(|run| run.level).collect();

    let mut pen = 0.0;
    let mut placed = Vec::new();
    for index in visual_order(&levels) {
        for glyph in &paragraph.runs[index].glyphs {
            placed.push(Placed {
                x: pen + f64::from(glyph.x_offset),
                y: f64::from(glyph.y_offset),
                advance: f64::from(glyph.x_advance),
            });
            pen += f64::from(glyph.x_advance);
        }
    }
    placed
}

/// Lays `text` out as the editor does, at the font's default.
fn laid_out(font: &Font, text: &str) -> Vec<Placed> {
    let glyph_classes = GlyphCategories::new().classes(font.glyphs(), font.lib());
    let classes: HashMap<GlyphId, OpenTypeCategory> = font
        .glyphs()
        .filter_map(|glyph| Some((glyph.id(), glyph_classes.class(glyph)?)))
        .collect();
    let source = font.shaper_font_source(&glyph_classes);
    let compiled = ShaperFont::compile(&ShaperFontRequest::new(&source).unwrap()).unwrap();
    let shaper = LiveShaper::new(Arc::new(compiled.font.unwrap()), font.character_map()).unwrap();
    let design = DesignLocation::new();
    let class = |glyph: GlyphId| classes.get(&glyph).copied();
    let layout_font = LayoutFont::new(
        font,
        &design,
        ExternalLocation::new(),
        font.kerning_blend_at(&design).unwrap(),
        Ok(&shaper),
        &class,
        LineMetrics::at(font, &design),
    );
    let layout = TextLayout::new(
        &layout_font,
        &LayoutRequest {
            units: text
                .chars()
                .map(|character| LayoutUnit::Character {
                    codepoint: u32::from(character),
                })
                .collect(),
            options: TextOptions {
                shaping: true,
                ..TextOptions::default()
            },
        },
    )
    .unwrap();
    layout
        .glyphs
        .iter()
        .map(|glyph| Placed {
            x: glyph.left + glyph.x_offset,
            y: glyph.y_offset,
            // Export's advance carries the kerning after it.
            advance: glyph.advance + glyph.kern,
        })
        .collect()
}

fn assert_matches_export(font: &Font, text: &str) {
    assert_eq!(laid_out(font, text), exported(font, text), "{text:?}");
}

#[test]
fn kerned_latin_sets_as_exported() {
    let font = open(&fixtures::mutatorsans_designspace());

    for text in ["AVATAR", "LTAV", "HOVA"] {
        assert_matches_export(&font, text);
    }
    // The pairs kern: A's advance before V is not A's own.
    let placed = laid_out(&font, "AV");
    let a = font.glyph_by_name("A").unwrap();
    let width = font
        .default_source()
        .and_then(|source| a.layer_for_source(source.id()))
        .unwrap()
        .width();
    assert_ne!(placed[0].advance, width);
}

#[test]
fn marks_and_stacked_marks_sit_as_exported() {
    let font = fixture("AnchorDragBench.glyphs");

    for text in ["a\u{308}", "a\u{308}\u{308}", "a\u{A8}"] {
        assert_matches_export(&font, text);
    }
    let stacked = laid_out(&font, "a\u{308}\u{308}");
    assert_eq!(stacked[2].y, 150.0);
}

#[test]
fn a_joined_arabic_word_steps_as_exported() {
    let font = fixture("ShapingTest.ufo");

    assert_matches_export(&font, "\u{628}\u{628}\u{628}");
    let heights: Vec<f64> = laid_out(&font, "\u{628}\u{628}\u{628}")
        .iter()
        .map(|glyph| glyph.y)
        .collect();
    assert_eq!(heights, [0.0, 200.0, 400.0]);
}

#[test]
fn marks_in_arabic_sit_as_exported() {
    let font = fixture("ShapingTest.ufo");

    for text in ["\u{628}\u{64E}\u{628}", "\u{628}\u{651}\u{64E}", "\u{646}"] {
        assert_matches_export(&font, text);
    }
}

#[test]
fn a_mark_nothing_attaches_inside_a_joined_word_neither_joins_nor_breaks_it() {
    let font = fixture("ShapingTest.ufo");
    let text = "\u{628}\u{670}\u{628}";

    // The anchorless superscript alef attaches to nothing, so the editor
    // shows it at its own advance where export sets it at none; the join
    // around it steps as exported.
    let heights =
        |placed: Vec<Placed>| -> Vec<f64> { placed.iter().map(|glyph| glyph.y).collect() };
    assert_eq!(
        heights(laid_out(&font, text)),
        heights(exported(&font, text))
    );
    let alef = &laid_out(&font, text)[1];
    assert_eq!(alef.advance, 300.0);
}

#[test]
fn mixed_direction_text_sets_as_exported() {
    let font = fixture("ShapingTest.ufo");

    assert_matches_export(&font, "fi \u{628}\u{628} fi");
}
