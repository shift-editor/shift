use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::shaper_font::{LiveShaper, ShaperFont, ShaperFontRequest};
use shift_backends::GlyphCategories;
use shift_backends::font_loader::FontLoader;
use shift_font::{DesignLocation, ExternalLocation, Font, GlyphId, OpenTypeCategory};

use super::*;

/// A fixture font with its shaper and each glyph's `GDEF` class.
struct Fixture {
    font: Font,
    shaper: LiveShaper,
    classes: HashMap<GlyphId, OpenTypeCategory>,
}

impl Fixture {
    fn open(name: &str) -> Self {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/fonts")
            .join(name);
        let font = FontLoader::new().read_font(path.to_str().unwrap()).unwrap();
        let glyph_classes = GlyphCategories::new().classes(font.glyphs(), font.lib());
        let classes = font
            .glyphs()
            .filter_map(|glyph| Some((glyph.id(), glyph_classes.class(glyph)?)))
            .collect();
        let source = font.shaper_font_source(&glyph_classes);
        let compiled = ShaperFont::compile(&ShaperFontRequest::new(&source).unwrap()).unwrap();
        let shaper =
            LiveShaper::new(Arc::new(compiled.font.unwrap()), font.character_map()).unwrap();
        Self {
            font,
            shaper,
            classes,
        }
    }

    fn lay_out(&self, text: &str, options: TextOptions) -> TextLayout {
        let design = DesignLocation::new();
        let class = |glyph: GlyphId| self.classes.get(&glyph).copied();
        let font = LayoutFont::new(
            &self.font,
            &design,
            ExternalLocation::new(),
            self.font.kerning_blend_at(&design).unwrap(),
            Ok(&self.shaper),
            &class,
            LineMetrics::at(&self.font, &design),
        );
        TextLayout::new(
            &font,
            &LayoutRequest {
                units: units(text),
                options,
            },
        )
        .unwrap()
    }

    fn name(&self, glyph: &PlacedGlyph) -> String {
        glyph.glyph_id.map_or_else(
            || "-".to_string(),
            |id| self.font.glyph(id).unwrap().name().to_string(),
        )
    }

    fn names(&self, layout: &TextLayout) -> Vec<String> {
        layout.glyphs.iter().map(|glyph| self.name(glyph)).collect()
    }

    fn advance(&self, name: &str) -> f64 {
        let glyph = self.font.glyph_by_name(name).unwrap();
        self.font
            .default_source()
            .and_then(|source| glyph.layer_for_source(source.id()))
            .unwrap()
            .width()
    }
}

fn units(text: &str) -> Vec<LayoutUnit> {
    text.chars()
        .map(|character| match character {
            '\n' => LayoutUnit::LineBreak,
            _ => LayoutUnit::Character {
                codepoint: u32::from(character),
            },
        })
        .collect()
}

fn shaped() -> TextOptions {
    TextOptions {
        shaping: true,
        ..TextOptions::default()
    }
}

/// Where each glyph's outline is drawn.
fn origins(layout: &TextLayout) -> Vec<(f64, f64)> {
    layout
        .glyphs
        .iter()
        .map(|glyph| (glyph.left + glyph.x_offset, glyph.baseline + glyph.y_offset))
        .collect()
}

fn stops(layout: &TextLayout) -> Vec<(u32, f64)> {
    layout
        .carets
        .iter()
        .map(|stop| (stop.unit, stop.x))
        .collect()
}

#[test]
fn a_spacing_dieresis_sits_beside_the_letter_though_a_component_lends_it_an_anchor() {
    let fixture = Fixture::open("AnchorDragBench.glyphs");

    let layout = fixture.lay_out("a\u{A8}", shaped());

    assert_eq!(fixture.names(&layout), ["a", "dieresis"]);
    assert_eq!(origins(&layout), [(0.0, 0.0), (480.0, 0.0)]);
}

#[test]
fn a_combining_dieresis_sits_on_the_letter_and_a_second_stacks_on_the_first() {
    let fixture = Fixture::open("AnchorDragBench.glyphs");

    let layout = fixture.lay_out("a\u{308}\u{308}", shaped());

    assert_eq!(
        fixture.names(&layout),
        ["a", "dieresiscomb", "dieresiscomb"]
    );
    // Each mark's _top (150, 500): on a's top (240, 500), then on the first
    // mark's top, 150 higher.
    assert_eq!(origins(&layout), [(0.0, 0.0), (90.0, 0.0), (90.0, 150.0)]);
    assert_eq!(layout.glyphs[1].advance, 0.0);
}

#[test]
fn an_arabic_word_joins_cursively_from_its_last_letter() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("\u{628}\u{628}\u{628}", shaped());

    assert_eq!(
        fixture.names(&layout),
        ["beh-ar.fina", "beh-ar.medi", "beh-ar.init"]
    );
    let heights: Vec<f64> = layout.glyphs.iter().map(|glyph| glyph.y_offset).collect();
    assert_eq!(heights.last(), Some(&400.0));
    assert_eq!(heights.first(), Some(&0.0));
}

#[test]
fn a_mark_on_an_arabic_letter_sits_on_its_top_anchor() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("\u{628}\u{64E}\u{628}", shaped());

    let names = fixture.names(&layout);
    let fatha = names.iter().position(|name| name == "fatha-ar").unwrap();
    assert!(layout.glyphs[fatha].is_mark);
    assert_eq!(layout.glyphs[fatha].advance, 0.0);
}

#[test]
fn an_english_word_in_arabic_reads_left_of_the_arabic_before_it() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("\u{628} fi \u{628}", shaped());

    let line = &layout.lines[0];
    assert_eq!(line.direction, Direction::Rtl);
    let runs: Vec<(u32, u32, u32)> = line
        .runs
        .iter()
        .map(|run| (run.start, run.end, run.level))
        .collect();
    assert_eq!(runs, [(4, 6, 1), (2, 4, 2), (0, 2, 1)]);
}

#[test]
fn carets_stop_at_each_letter_and_split_a_ligature_evenly() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("fi", shaped());

    assert_eq!(fixture.names(&layout), ["f_i"]);
    let ligature = fixture.advance("f_i");
    assert_eq!(
        stops(&layout),
        [(0, 0.0), (1, ligature / 2.0), (2, ligature)]
    );
}

#[test]
fn a_right_to_left_caret_starts_at_the_right_edge() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("\u{628}\u{628}", shaped());

    let width = layout.lines[0].advance;
    let carets = stops(&layout);
    assert_eq!(carets.first(), Some(&(0, width)));
    assert_eq!(carets.last(), Some(&(2, 0.0)));
    assert!(
        layout
            .carets
            .iter()
            .all(|stop| stop.direction == Direction::Rtl)
    );
    // Screen order runs against reading order in right-to-left text.
    let screen: Vec<(u32, u32)> = layout
        .carets
        .iter()
        .map(|stop| (stop.unit, stop.screen))
        .collect();
    assert_eq!(screen, [(0, 2), (1, 1), (2, 0)]);
}

#[test]
fn a_direction_boundary_has_a_second_caret() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("fi\u{628}", shaped());

    let boundary = layout.carets.iter().find(|stop| stop.unit == 2).unwrap();
    assert_eq!(boundary.direction, Direction::Rtl);
    let secondary = boundary.secondary.unwrap();
    assert_eq!(secondary.direction, Direction::Ltr);
    assert_ne!(secondary.x, boundary.x);
    // Every place, stops and second places alike, numbered left to right.
    let mut places: Vec<(u32, f64)> = layout
        .carets
        .iter()
        .flat_map(|stop| {
            std::iter::once((stop.screen, stop.x))
                .chain(stop.secondary.map(|second| (second.screen, second.x)))
        })
        .collect();
    places.sort_by_key(|(screen, _)| *screen);
    let screens: Vec<u32> = places.iter().map(|(screen, _)| *screen).collect();
    assert_eq!(
        screens,
        (0..u32::try_from(places.len()).unwrap()).collect::<Vec<_>>()
    );
    assert!(places.windows(2).all(|pair| pair[0].1 <= pair[1].1));
}

#[test]
fn unshaped_text_lays_out_as_typed() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("fi", TextOptions::default());

    assert_eq!(fixture.names(&layout), ["f", "i"]);
    assert_eq!(layout.glyphs[1].left, fixture.advance("f"));
}

/// A font known only by its glyphs' advances and mark classes: `a` at 500,
/// `b` at 600 and a mark `m` of no advance.
fn two_letters_and_a_mark() -> (TypedFont, [GlyphId; 3]) {
    let [a, b, m] = [GlyphId::new(), GlyphId::new(), GlyphId::new()];
    let glyph = |glyph_id, advance, is_mark| TypedGlyph {
        glyph_id,
        advance,
        is_mark,
    };
    let character = |character: char, glyph_id| CharacterGlyph {
        codepoint: u32::from(character),
        glyph_id,
    };
    let font = TypedFont {
        characters: vec![
            character('a', a),
            character('b', b),
            character('\u{301}', m),
        ],
        glyphs: vec![
            glyph(a, 500.0, false),
            glyph(b, 600.0, false),
            glyph(m, 0.0, true),
        ],
        metrics: LineMetrics {
            units_per_em: 1000.0,
            ascender: 800.0,
            descender: -200.0,
            line_gap: 0.0,
            cap_height: None,
        },
    };
    (font, [a, b, m])
}

fn lay_out_typed(font: &TypedFont, text: &str) -> TextLayout {
    TextLayout::new(
        &LayoutFont::typed(font),
        &LayoutRequest {
            units: units(text),
            options: shaped(),
        },
    )
    .unwrap()
}

#[test]
fn a_typed_font_lays_text_out_as_typed_with_lines_and_carets() {
    let (font, [a, b, _]) = two_letters_and_a_mark();

    let layout = lay_out_typed(&font, "ab\nb");

    let placed: Vec<(Option<GlyphId>, u32, f64, f64)> = layout
        .glyphs
        .iter()
        .map(|glyph| (glyph.glyph_id, glyph.line, glyph.left, glyph.baseline))
        .collect();
    assert_eq!(
        placed,
        [
            (Some(a), 0, 0.0, 0.0),
            (Some(b), 0, 500.0, 0.0),
            (Some(b), 1, 0.0, -1000.0),
        ]
    );
    assert_eq!(
        stops(&layout),
        [(0, 0.0), (1, 500.0), (2, 1100.0), (3, 0.0), (4, 600.0)]
    );
    assert!(layout.unshaped.is_some());
}

#[test]
fn a_typed_font_shows_a_mark_of_no_advance_at_the_editor_s_stand_in() {
    let (font, [a, _, m]) = two_letters_and_a_mark();

    let layout = lay_out_typed(&font, "a\u{301}a");

    let placed: Vec<(Option<GlyphId>, f64)> = layout
        .glyphs
        .iter()
        .map(|glyph| (glyph.glyph_id, glyph.left))
        .collect();
    let after_mark = 500.0 + paragraph::NONSPACING_MARK_EDITOR_ADVANCE;
    assert_eq!(
        placed,
        [(Some(a), 0.0), (Some(m), 500.0), (Some(a), after_mark)]
    );
}

#[test]
fn each_unit_knows_the_glyphs_it_shows() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("fi\n\u{646}", shaped());

    let shown: Vec<Vec<u32>> = layout
        .unit_glyphs
        .iter()
        .map(|unit| unit.glyphs.clone())
        .collect();
    // f and i make one ligature; the line break shows nothing; noon
    // decomposes into its body and then its dot, in logical order.
    assert_eq!(shown[0], [0]);
    assert_eq!(shown[1], [0]);
    assert!(shown[2].is_empty());
    let noon: Vec<String> = shown[3]
        .iter()
        .map(|index| fixture.name(&layout.glyphs[*index as usize]))
        .collect();
    assert_eq!(noon, ["noonDotless-ar", "dotabove-ar"]);
}

#[test]
fn lines_break_at_spaces_to_fit_the_width_and_follow_the_alignment() {
    let fixture = Fixture::open("ShapingTest.ufo");
    let f = fixture.advance("f");
    let options = TextOptions {
        width: Some(f * 2.5),
        align: Some(TextAlign::Right),
        ..shaped()
    };

    let layout = fixture.lay_out("ff ff", options);

    let lines: Vec<(u32, u32)> = layout
        .lines
        .iter()
        .map(|line| (line.start, line.end))
        .collect();
    assert_eq!(lines, [(0, 3), (3, 5)]);
    let second = &layout.lines[1];
    assert_eq!(second.left, layout.width - second.advance);
    assert!(second.baseline < layout.lines[0].baseline);
}

#[test]
fn a_paragraph_after_a_line_break_is_its_own_line() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("f\nf", shaped());

    let lines: Vec<(u32, u32, u32)> = layout
        .lines
        .iter()
        .map(|line| (line.paragraph, line.start, line.end))
        .collect();
    assert_eq!(lines, [(0, 0, 2), (1, 2, 3)]);
}

/// How long a layout of a long text takes, at a master and between masters.
/// Run with `cargo test --release -p shift-text layout_timing -- --ignored
/// --nocapture`.
#[test]
#[ignore = "a release timing, not a check"]
fn layout_timing() {
    let path = shift_font::test_support::fixtures::mutatorsans_designspace();
    let font = FontLoader::new().read_font(path.to_str().unwrap()).unwrap();
    let glyph_classes = GlyphCategories::new().classes(font.glyphs(), font.lib());
    let classes: HashMap<GlyphId, OpenTypeCategory> = font
        .glyphs()
        .filter_map(|glyph| Some((glyph.id(), glyph_classes.class(glyph)?)))
        .collect();
    let source = font.shaper_font_source(&glyph_classes);
    let compiled = ShaperFont::compile(&ShaperFontRequest::new(&source).unwrap()).unwrap();
    let shaper = LiveShaper::new(Arc::new(compiled.font.unwrap()), font.character_map()).unwrap();
    let class = |glyph: GlyphId| classes.get(&glyph).copied();
    for length in [1_000, 10_000] {
        let text: String = "HAVATAR LOVE TOTAL ".chars().cycle().take(length).collect();
        let request = LayoutRequest {
            units: units(&text),
            options: shaped(),
        };
        for (name, design) in [
            ("master", DesignLocation::new()),
            (
                "between",
                font.axes()
                    .iter()
                    .map(|axis| (axis.id(), f64::midpoint(axis.minimum(), axis.maximum())))
                    .collect(),
            ),
        ] {
            let started = std::time::Instant::now();
            let runs = 20;
            for _ in 0..runs {
                let layout_font = LayoutFont::new(
                    &font,
                    &design,
                    ExternalLocation::new(),
                    font.kerning_blend_at(&design).unwrap(),
                    Ok(&shaper),
                    &class,
                    LineMetrics::at(&font, &design),
                );
                std::hint::black_box(TextLayout::new(&layout_font, &request).unwrap());
            }
            let per = started.elapsed().as_secs_f64() * 1000.0 / f64::from(runs);
            println!("{length} characters, {name}: {per:.2} ms per layout");
        }
    }
}

#[test]
fn layouts_share_a_placement_key_only_when_they_place_alike() {
    let fixture = Fixture::open("ShapingTest.ufo");
    let mut keys = PlacementKeys::default();
    let mut first = fixture.lay_out("fi", shaped());
    let mut again = fixture.lay_out("fi", shaped());
    let mut unshaped = fixture.lay_out("fi", TextOptions::default());

    for layout in [&mut first, &mut again, &mut unshaped] {
        keys.assign(layout);
    }

    assert_eq!(first.placement, again.placement);
    assert_ne!(first.placement, unshaped.placement);
}

#[test]
fn a_hash_collision_does_not_share_a_placement_key() {
    let fixture = Fixture::open("ShapingTest.ufo");
    // Every layout hashes alike, as two colliding layouts would.
    let mut keys = PlacementKeys::with_hash(|_| 7);
    let mut shaped_text = fixture.lay_out("fi", shaped());
    let mut typed = fixture.lay_out("fi", TextOptions::default());
    let mut shaped_again = fixture.lay_out("fi", shaped());

    for layout in [&mut shaped_text, &mut typed, &mut shaped_again] {
        keys.assign(layout);
    }

    assert_ne!(shaped_text.placement, typed.placement);
    assert_eq!(shaped_text.placement, shaped_again.placement);
}

#[test]
fn glyph_bounds_are_not_placement() {
    let fixture = Fixture::open("ShapingTest.ufo");
    let mut keys = PlacementKeys::default();
    let mut bounded = fixture.lay_out("fi", shaped());
    let mut unbounded = bounded.clone();
    for glyph in &mut unbounded.glyphs {
        glyph.bounds = None;
    }

    keys.assign(&mut bounded);
    keys.assign(&mut unbounded);

    assert_eq!(bounded.placement, unbounded.placement);
}

#[test]
fn words_skip_spaces_and_punctuation_and_name_their_screen_edges() {
    let fixture = Fixture::open("ShapingTest.ufo");

    let layout = fixture.lay_out("fi, \u{628}\u{628}", shaped());

    let words: Vec<(u32, u32, Direction, u32, u32)> = layout
        .words
        .iter()
        .map(|word| (word.start, word.end, word.direction, word.left, word.right))
        .collect();
    assert_eq!(
        words,
        [(0, 2, Direction::Ltr, 0, 2), (4, 6, Direction::Rtl, 6, 4)]
    );
}
