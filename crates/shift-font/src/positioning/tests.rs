use std::collections::HashMap;

use super::*;

/// Anchors and kerning by glyph, for runs of glyphs numbered by test.
#[derive(Default)]
struct TestFont {
    anchors: HashMap<GlyphId, Arc<[PropagationAnchor]>>,
    kerning: HashMap<(GlyphId, GlyphId), f64>,
}

impl TestFont {
    fn with_anchors(mut self, glyph: GlyphId, anchors: &[(&str, f64, f64)]) -> Self {
        let anchors: Vec<PropagationAnchor> = anchors
            .iter()
            .map(|(name, x, y)| PropagationAnchor {
                name: (*name).to_string(),
                x: *x,
                y: *y,
            })
            .collect();
        self.anchors.insert(glyph, anchors.into());
        self
    }

    fn with_kerning(mut self, first: GlyphId, second: GlyphId, value: f64) -> Self {
        self.kerning.insert((first, second), value);
        self
    }
}

impl PositioningFont for TestFont {
    fn anchors(&mut self, glyph_id: GlyphId) -> Option<Arc<[PropagationAnchor]>> {
        Some(
            self.anchors
                .get(&glyph_id)
                .cloned()
                .unwrap_or_else(|| Arc::from([])),
        )
    }

    fn kerning(&mut self, pairs: &[(GlyphId, GlyphId)]) -> Vec<f64> {
        pairs
            .iter()
            .map(|pair| self.kerning.get(pair).copied().unwrap_or_default())
            .collect()
    }
}

fn glyph(id: GlyphId) -> RunGlyph {
    RunGlyph {
        glyph_id: Some(id),
        is_mark: false,
    }
}

fn mark(id: GlyphId) -> RunGlyph {
    RunGlyph {
        glyph_id: Some(id),
        is_mark: true,
    }
}

fn advancing(x_advance: f64) -> RunPosition {
    RunPosition {
        x_advance,
        ..RunPosition::default()
    }
}

/// Applies `features` in order and returns the positions.
fn positioned(
    glyphs: &[RunGlyph],
    advances: &[f64],
    direction: RunDirection,
    font: &mut TestFont,
    features: &[GeneratedFeature],
) -> Vec<RunPosition> {
    let mut positions: Vec<RunPosition> = advances.iter().copied().map(advancing).collect();
    let mut run = RunPositioning::new(glyphs, &mut positions, direction, font);
    for feature in features {
        run.apply(*feature);
    }
    positions
}

/// Where each glyph is drawn, left to right on screen, from its pen
/// position and offset: the run's glyphs in display order.
fn drawn(positions: &[RunPosition], direction: RunDirection) -> Vec<(f64, f64)> {
    let mut order: Vec<usize> = (0..positions.len()).collect();
    if direction == RunDirection::RightToLeft {
        order.reverse();
    }
    let mut pen = 0.0;
    let mut placed = vec![(0.0, 0.0); positions.len()];
    for index in order {
        let position = positions[index];
        placed[index] = (pen + position.x_offset, position.y_offset);
        pen += position.x_advance;
    }
    placed
}

/// Four glyphs: two bases, a mark and a ligature.
struct Glyphs {
    a: GlyphId,
    v: GlyphId,
    comb: GlyphId,
    ligature: GlyphId,
}

impl Glyphs {
    fn new() -> Self {
        Self {
            a: GlyphId::from_raw("a"),
            v: GlyphId::from_raw("v"),
            comb: GlyphId::from_raw("comb"),
            ligature: GlyphId::from_raw("ligature"),
        }
    }
}

#[test]
fn kerning_moves_the_first_glyph_s_advance_and_passes_over_marks() {
    let g = Glyphs::new();
    let mut font = TestFont::default().with_kerning(g.a, g.v, -40.0);

    let positions = positioned(
        &[glyph(g.a), mark(g.comb), glyph(g.v)],
        &[500.0, 0.0, 500.0],
        RunDirection::LeftToRight,
        &mut font,
        &[GeneratedFeature::Kern],
    );

    assert_eq!(positions[0].x_advance, 460.0);
    assert_eq!(positions[1].x_advance, 0.0);
}

#[test]
fn right_to_left_kerning_also_moves_the_first_glyph() {
    let g = Glyphs::new();
    let mut font = TestFont::default().with_kerning(g.a, g.v, -40.0);

    let positions = positioned(
        &[glyph(g.a), glyph(g.v)],
        &[500.0, 500.0],
        RunDirection::RightToLeft,
        &mut font,
        &[GeneratedFeature::Kern],
    );

    assert_eq!(positions[0].x_advance, 460.0);
    assert_eq!(positions[0].x_offset, -40.0);
}

#[test]
fn a_mark_sits_on_its_base_s_anchor() {
    let g = Glyphs::new();
    // AnchorDragBench's a (top at 240, 500) and dieresiscomb (_top at 150, 500).
    let mut font = TestFont::default()
        .with_anchors(g.a, &[("top", 240.0, 500.0)])
        .with_anchors(g.comb, &[("_top", 150.0, 500.0), ("top", 150.0, 650.0)]);

    let positions = positioned(
        &[glyph(g.a), mark(g.comb), mark(g.comb)],
        &[480.0, 0.0, 0.0],
        RunDirection::LeftToRight,
        &mut font,
        &[GeneratedFeature::Mark, GeneratedFeature::MarkToMark],
    );

    assert_eq!(
        drawn(&positions, RunDirection::LeftToRight),
        [(0.0, 0.0), (90.0, 0.0), (90.0, 150.0)]
    );
}

#[test]
fn a_glyph_the_font_does_not_class_as_a_mark_keeps_its_place() {
    let g = Glyphs::new();
    let mut font = TestFont::default()
        .with_anchors(g.a, &[("top", 240.0, 500.0)])
        .with_anchors(g.v, &[("_top", 150.0, 500.0)]);

    let positions = positioned(
        &[glyph(g.a), glyph(g.v)],
        &[480.0, 300.0],
        RunDirection::LeftToRight,
        &mut font,
        &[GeneratedFeature::Mark],
    );

    assert_eq!(
        drawn(&positions, RunDirection::LeftToRight),
        [(0.0, 0.0), (480.0, 0.0)]
    );
}

#[test]
fn a_mark_in_right_to_left_text_sits_on_the_base_before_it() {
    let g = Glyphs::new();
    let mut font = TestFont::default()
        .with_anchors(g.a, &[("top", 200.0, 500.0)])
        .with_anchors(g.comb, &[("_top", 50.0, 500.0)]);

    let positions = positioned(
        &[glyph(g.a), mark(g.comb), glyph(g.v)],
        &[400.0, 0.0, 300.0],
        RunDirection::RightToLeft,
        &mut font,
        &[GeneratedFeature::Mark],
    );

    // On screen: g.v at 0, then g.a at 300; the mark's _top on g.a's top at 500.
    assert_eq!(
        drawn(&positions, RunDirection::RightToLeft)[1],
        (300.0 + 200.0 - 50.0, 0.0)
    );
}

#[test]
fn a_mark_after_a_ligature_sits_on_its_last_component() {
    let g = Glyphs::new();
    let mut font = TestFont::default()
        .with_anchors(
            g.ligature,
            &[("top_1", 100.0, 600.0), ("top_2", 400.0, 600.0)],
        )
        .with_anchors(g.comb, &[("_top", 50.0, 500.0)]);

    let positions = positioned(
        &[glyph(g.ligature), mark(g.comb)],
        &[600.0, 0.0],
        RunDirection::LeftToRight,
        &mut font,
        &[GeneratedFeature::Mark],
    );

    assert_eq!(
        drawn(&positions, RunDirection::LeftToRight)[1],
        (350.0, 100.0)
    );
}

#[test]
fn a_right_to_left_word_hangs_from_its_last_letter() {
    let g = Glyphs::new();
    // Reading order: init, medi, fina; each exit is 200 below the next entry.
    let (init, medi, fina) = (g.a, g.v, g.ligature);
    let mut font = TestFont::default()
        .with_anchors(init, &[("exit", 0.0, 0.0)])
        .with_anchors(medi, &[("entry", 400.0, 200.0), ("exit", 0.0, 0.0)])
        .with_anchors(fina, &[("entry", 450.0, 200.0)]);

    let positions = positioned(
        &[glyph(init), glyph(medi), glyph(fina)],
        &[400.0, 400.0, 450.0],
        RunDirection::RightToLeft,
        &mut font,
        &[GeneratedFeature::Cursive],
    );

    let heights: Vec<f64> = positions.iter().map(|position| position.y_offset).collect();
    assert_eq!(heights, [400.0, 200.0, 0.0]);
}

#[test]
fn a_left_to_right_chain_adds_up_from_its_first_letter() {
    let g = Glyphs::new();
    let mut font = TestFont::default()
        .with_anchors(g.a, &[("exit", 500.0, 100.0)])
        .with_anchors(g.v, &[("entry", 0.0, 0.0), ("exit", 500.0, 100.0)])
        .with_anchors(g.ligature, &[("entry", 0.0, 0.0)]);

    let positions = positioned(
        &[glyph(g.a), glyph(g.v), glyph(g.ligature)],
        &[500.0, 500.0, 500.0],
        RunDirection::LeftToRight,
        &mut font,
        &[GeneratedFeature::Cursive],
    );

    let heights: Vec<f64> = positions.iter().map(|position| position.y_offset).collect();
    assert_eq!(heights, [0.0, 100.0, 200.0]);
    assert_eq!(positions[0].x_advance, 500.0);
}

#[test]
fn a_mark_between_two_letters_neither_joins_nor_breaks_them() {
    let g = Glyphs::new();
    let mut font = TestFont::default()
        .with_anchors(g.a, &[("exit", 0.0, 0.0)])
        .with_anchors(g.comb, &[("entry", 0.0, 0.0), ("exit", 0.0, 0.0)])
        .with_anchors(g.v, &[("entry", 450.0, 200.0)]);

    let positions = positioned(
        &[glyph(g.a), mark(g.comb), glyph(g.v)],
        &[400.0, 0.0, 450.0],
        RunDirection::RightToLeft,
        &mut font,
        &[GeneratedFeature::Cursive],
    );

    assert_eq!(positions[1], advancing(0.0));
    assert_eq!(positions[0].y_offset, 200.0);
}

#[test]
fn glyphs_without_matching_anchors_keep_their_positions() {
    let g = Glyphs::new();
    let mut font = TestFont::default().with_anchors(g.v, &[("entry", 0.0, 0.0)]);

    let positions = positioned(
        &[glyph(g.a), glyph(g.v)],
        &[300.0, 300.0],
        RunDirection::LeftToRight,
        &mut font,
        &[GeneratedFeature::Cursive],
    );

    assert_eq!(positions, [advancing(300.0), advancing(300.0)]);
}
