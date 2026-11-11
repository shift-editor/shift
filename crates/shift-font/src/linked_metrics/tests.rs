use super::*;
use crate::{
    Axis, Component, DesignLocation, Font, Glyph, GlyphLayer, GlyphName, LayerId, MetricsKey,
    MetricsKeySide, Source, SourceId, contour,
};

const LEFT: MetricsKeySide = MetricsKeySide::Left;
const RIGHT: MetricsKeySide = MetricsKeySide::Right;
const WIDTH: MetricsKeySide = MetricsKeySide::Width;

/// A font of rectangles, so each sidebearing is easy to read off:
/// `n` spans 50..450 of 500, `o` 40..480 of 520, `H` 80..620 of 700, and
/// `A` is a triangle from 0 to 500 peaking at 250, 700. `space` is empty.
fn font() -> (Font, SourceId) {
    let mut font = Font::new();
    let source = font.default_source_id().unwrap();
    for (name, width, left, right) in [
        ("n", 500.0, 50.0, 450.0),
        ("o", 520.0, 40.0, 480.0),
        ("H", 700.0, 80.0, 620.0),
        ("A-cy", 600.0, 10.0, 590.0),
    ] {
        add_rectangle(&mut font, source, name, width, left, right);
    }

    let mut triangle = GlyphLayer::with_width(LayerId::new(), source, 500.0);
    triangle.add_contour(contour![(0, 0), (250, 700), (500, 0)]);
    let mut a = Glyph::new("A");
    a.set_layer(triangle);
    font.insert_glyph(a).unwrap();

    let mut space = Glyph::new("space");
    space.set_layer(GlyphLayer::with_width(LayerId::new(), source, 250.0));
    font.insert_glyph(space).unwrap();
    (font, source)
}

fn add_rectangle(font: &mut Font, source: SourceId, name: &str, width: f64, left: f64, right: f64) {
    let glyph_id = font
        .glyph_id_by_name(name)
        .unwrap_or_else(|| font.insert_glyph(Glyph::new(name)).unwrap());
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, width);
    layer.add_contour(contour![(left, 0), (left, 700), (right, 700), (right, 0)]);
    font.insert_glyph_layer(glyph_id, layer).unwrap();
}

fn names(font: &Font) -> impl Fn(&str) -> bool + '_ {
    |name| font.glyph_id_by_name(name).is_some()
}

fn expr(font: &Font, text: &str) -> Expr {
    match parse(text, &names(font)).unwrap().body {
        KeyBody::Expr(expr) => expr,
        KeyBody::AutoOffset(offset) => panic!("{text} parsed as an offset of {offset}"),
    }
}

fn measure(glyph: Option<&str>, side: MeasureSide, at: Option<f64>) -> Expr {
    Expr::Measure(Measure {
        glyph: glyph.map(GlyphName::from),
        side,
        at,
    })
}

fn same(glyph: &str) -> Expr {
    measure(Some(glyph), MeasureSide::Same, None)
}

fn binary(op: BinaryOp, left: Expr, right: Expr) -> Expr {
    Expr::Binary {
        op,
        left: Box::new(left),
        right: Box::new(right),
    }
}

fn evaluate(font: &Font, source: SourceId, glyph: &str, side: MetricsKeySide, text: &str) -> f64 {
    try_evaluate(font, source, glyph, side, text).unwrap()
}

fn try_evaluate(
    font: &Font,
    source: SourceId,
    glyph: &str,
    side: MetricsKeySide,
    text: &str,
) -> Result<f64, MetricsKeyError> {
    let key = parse(text, &names(font))?;
    let glyph_id = font.glyph_id_by_name(glyph).unwrap();
    MetricsKeyEvaluator::new(font, source)?.evaluate(glyph_id, side, &key)
}

#[test]
fn every_glyphs_form_parses() {
    let (font, _) = font();

    assert_eq!(expr(&font, "n"), same("n"));
    assert_eq!(expr(&font, "=n"), same("n"));
    assert_eq!(
        expr(&font, "=n+10"),
        binary(BinaryOp::Add, same("n"), Expr::Number(10.0))
    );
    assert_eq!(
        expr(&font, "=o*1.2"),
        binary(BinaryOp::Multiply, same("o"), Expr::Number(1.2))
    );
    assert_eq!(expr(&font, "=50"), Expr::Number(50.0));
    assert_eq!(
        expr(&font, "=|n"),
        measure(Some("n"), MeasureSide::Opposite, None)
    );
    assert_eq!(
        expr(&font, "=|"),
        measure(None, MeasureSide::Opposite, None)
    );
    assert_eq!(
        expr(&font, "=A@200"),
        measure(Some("A"), MeasureSide::Same, Some(200.0))
    );

    let local = parse("==n", &names(&font)).unwrap();
    assert_eq!(local.scope, KeyScope::ThisSource);
    assert_eq!(local.body, KeyBody::Expr(same("n")));
    assert_eq!(
        parse("=+25", &names(&font)).unwrap().body,
        KeyBody::AutoOffset(25.0)
    );
    assert_eq!(
        parse("=-10", &names(&font)).unwrap().body,
        KeyBody::AutoOffset(-10.0)
    );
}

#[test]
fn a_hyphen_is_part_of_a_name_the_font_has_and_subtraction_otherwise() {
    let (font, _) = font();

    assert_eq!(expr(&font, "=A-cy"), same("A-cy"));
    assert_eq!(
        expr(&font, "=n-10"),
        binary(BinaryOp::Subtract, same("n"), Expr::Number(10.0))
    );
    assert_eq!(
        expr(&font, "=A-cy-10"),
        binary(BinaryOp::Subtract, same("A-cy"), Expr::Number(10.0))
    );
    assert_eq!(
        expr(&font, "=n-o"),
        binary(BinaryOp::Subtract, same("n"), same("o"))
    );
    assert!(matches!(
        parse("=A-xx", &names(&font)),
        Err(MetricsKeyError::UnknownGlyph(name)) if name == "A-xx"
    ));
}

#[test]
fn full_expressions_parse_with_precedence() {
    let (font, _) = font();

    assert_eq!(
        expr(&font, "=n+o*2"),
        binary(
            BinaryOp::Add,
            same("n"),
            binary(BinaryOp::Multiply, same("o"), Expr::Number(2.0))
        )
    );
    assert_eq!(
        expr(&font, "=(n+o)/2"),
        binary(
            BinaryOp::Divide,
            binary(BinaryOp::Add, same("n"), same("o")),
            Expr::Number(2.0)
        )
    );
    assert_eq!(
        expr(&font, "=max(n, o) - 5"),
        binary(
            BinaryOp::Subtract,
            Expr::Call {
                function: Function::Max,
                args: vec![same("n"), same("o")],
            },
            Expr::Number(5.0)
        )
    );
    assert_eq!(
        expr(&font, "=rsb(o) + |H@200"),
        binary(
            BinaryOp::Add,
            measure(Some("o"), MeasureSide::Right, None),
            measure(Some("H"), MeasureSide::Opposite, Some(200.0))
        )
    );
    assert_eq!(
        expr(&font, "=round(width(n) / 3)"),
        Expr::Round(Box::new(binary(
            BinaryOp::Divide,
            measure(Some("n"), MeasureSide::Width, None),
            Expr::Number(3.0)
        )))
    );
}

#[test]
fn malformed_keys_are_syntax_errors() {
    let (font, _) = font();
    for text in [
        "=n+",
        "=(n",
        "=round(n, o)",
        "=lsb(5)",
        "=n @",
        "=n o",
        "=n#",
    ] {
        assert!(
            matches!(parse(text, &names(&font)), Err(MetricsKeyError::Syntax(_))),
            "{text} should not parse"
        );
    }
    assert!(matches!(
        parse("=widths(n)", &names(&font)),
        Err(MetricsKeyError::Syntax(_))
    ));
    assert!(matches!(
        parse("=m", &names(&font)),
        Err(MetricsKeyError::UnknownGlyph(name)) if name == "m"
    ));
}

#[test]
fn keys_read_other_glyphs_sidebearings_and_widths() {
    let (font, source) = font();

    assert_eq!(evaluate(&font, source, "o", LEFT, "=n"), 50.0);
    assert_eq!(evaluate(&font, source, "o", RIGHT, "=n+10"), 60.0);
    assert_eq!(evaluate(&font, source, "o", RIGHT, "=|H"), 80.0);
    assert_eq!(evaluate(&font, source, "o", LEFT, "=|"), 40.0);
    assert_eq!(evaluate(&font, source, "o", WIDTH, "=n*1.05"), 525.0);
    assert_eq!(evaluate(&font, source, "o", LEFT, "=(n+H)/2"), 65.0);
    assert_eq!(
        evaluate(&font, source, "o", LEFT, "=min(n, H) - rsb(o)"),
        10.0
    );
    assert_eq!(evaluate(&font, source, "o", WIDTH, "=width(H) / 3"), 233.0);
    assert_eq!(evaluate(&font, source, "o", LEFT, "=50"), 50.0);
}

#[test]
fn a_height_measures_where_the_outline_crosses_it() {
    let (font, source) = font();

    assert_eq!(evaluate(&font, source, "o", LEFT, "=A@0"), 0.0);
    assert_eq!(evaluate(&font, source, "o", LEFT, "=A@350"), 125.0);
    assert_eq!(evaluate(&font, source, "o", RIGHT, "=A@350"), 125.0);
    assert!(matches!(
        try_evaluate(&font, source, "o", LEFT, "=A@900"),
        Err(MetricsKeyError::NothingAtHeight { height, .. }) if height == 900.0
    ));
}

#[test]
fn keys_that_cannot_be_evaluated_say_why() {
    let (font, source) = font();

    assert!(matches!(
        try_evaluate(&font, source, "o", LEFT, "=space"),
        Err(MetricsKeyError::NoOutline(name)) if name == "space"
    ));
    assert_eq!(evaluate(&font, source, "o", WIDTH, "=space"), 250.0);
    assert!(matches!(
        try_evaluate(&font, source, "o", WIDTH, "=|n"),
        Err(MetricsKeyError::OppositeOfWidth)
    ));
    assert!(matches!(
        try_evaluate(&font, source, "o", LEFT, "=n/0"),
        Err(MetricsKeyError::DivisionByZero)
    ));
    assert!(matches!(
        try_evaluate(&font, source, "o", LEFT, "=+25"),
        Err(MetricsKeyError::AutoOffset)
    ));
}

#[test]
fn a_composite_is_measured_with_its_components() {
    let (mut font, source) = font();
    let n_id = font.glyph_id_by_name("n").unwrap();
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, 560.0);
    let mut component = Component::new(n_id, "n");
    component.translate(30.0, 0.0);
    layer.add_component(component);
    let mut composite = Glyph::new("ndot");
    composite.set_layer(layer);
    font.insert_glyph(composite).unwrap();

    assert_eq!(evaluate(&font, source, "o", LEFT, "=ndot"), 80.0);
    assert_eq!(evaluate(&font, source, "o", RIGHT, "=ndot"), 80.0);
}

#[test]
fn each_source_reads_the_glyphs_it_draws() {
    let (mut font, regular) = font();
    let weight = Axis::weight();
    let weight_id = weight.id();
    font.add_axis(weight).unwrap();
    font.source_mut(regular)
        .unwrap()
        .set_location(DesignLocation::from([(weight_id, 400.0)]));
    let bold = font.add_source(Source::new(
        "Bold".to_string(),
        DesignLocation::from([(weight_id, 700.0)]),
    ));
    add_rectangle(&mut font, bold, "n", 560.0, 30.0, 530.0);

    assert_eq!(evaluate(&font, regular, "o", LEFT, "=n"), 50.0);
    assert_eq!(evaluate(&font, bold, "o", LEFT, "=n"), 30.0);
}

fn set_key(font: &mut Font, glyph: &str, side: MetricsKeySide, text: &str) {
    let glyph_id = font.glyph_id_by_name(glyph).unwrap();
    let mut keys = font.glyph(glyph_id).unwrap().metrics_keys().clone();
    keys.set(side, MetricsKey::new(text));
    font.set_glyph_metrics_keys(glyph_id, keys).unwrap();
}

fn side(font: &Font, glyph: &str, side: MetricsKeySide) -> LinkedSide {
    LinkedSide {
        glyph_id: font.glyph_id_by_name(glyph).unwrap(),
        side,
    }
}

fn ordered(order: &LinkedMetricsOrder) -> Vec<LinkedSide> {
    order.keys.iter().map(|ordered| ordered.linked).collect()
}

#[test]
fn keys_come_after_the_keys_they_read() {
    let (mut font, source) = font();
    set_key(&mut font, "H", LEFT, "=o");
    set_key(&mut font, "o", LEFT, "=n");
    set_key(&mut font, "o", WIDTH, "=n");
    set_key(&mut font, "A", LEFT, "=width(o)/2");

    let order = font.linked_metrics_order(source);

    assert!(order.problems.is_empty(), "{:?}", order.problems);
    let keys = ordered(&order);
    let position = |linked: LinkedSide| keys.iter().position(|&key| key == linked).unwrap();
    assert!(position(side(&font, "o", LEFT)) < position(side(&font, "H", LEFT)));
    // A width moves with every key on its glyph.
    assert!(position(side(&font, "o", LEFT)) < position(side(&font, "A", LEFT)));
    assert!(position(side(&font, "o", WIDTH)) < position(side(&font, "A", LEFT)));
}

#[test]
fn keys_that_depend_on_each_other_are_reported_not_ordered() {
    let (mut font, source) = font();
    set_key(&mut font, "o", LEFT, "=|");
    set_key(&mut font, "o", RIGHT, "=|");
    set_key(&mut font, "H", LEFT, "=o");
    set_key(&mut font, "n", LEFT, "=H@100");

    let order = font.linked_metrics_order(source);

    assert_eq!(ordered(&order), vec![]);
    let cycles: Vec<LinkedSide> = order
        .problems
        .iter()
        .filter(|(_, error)| matches!(error, MetricsKeyError::Cycle(_)))
        .map(|(linked, _)| *linked)
        .collect();
    assert_eq!(cycles.len(), 4);
    assert!(cycles.contains(&side(&font, "n", LEFT)));
}

#[test]
fn a_glyph_naming_itself_is_a_cycle() {
    let (mut font, source) = font();
    set_key(&mut font, "o", LEFT, "=o+10");

    let order = font.linked_metrics_order(source);

    assert!(order.keys.is_empty());
    assert!(matches!(
        order.problems.as_slice(),
        [(_, MetricsKeyError::Cycle(_))]
    ));
}

#[test]
fn a_key_reading_a_composite_waits_for_its_base_left_sidebearing() {
    let (mut font, source) = font();
    let n_id = font.glyph_id_by_name("n").unwrap();
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, 560.0);
    layer.add_component(Component::new(n_id, "n"));
    let mut composite = Glyph::new("ndot");
    composite.set_layer(layer);
    font.insert_glyph(composite).unwrap();
    set_key(&mut font, "o", LEFT, "=ndot");
    set_key(&mut font, "n", LEFT, "=H");

    let order = font.linked_metrics_order(source);

    assert_eq!(
        ordered(&order),
        vec![side(&font, "n", LEFT), side(&font, "o", LEFT)]
    );
}

#[test]
fn unreadable_keys_are_problems_and_the_rest_still_order() {
    let (mut font, source) = font();
    set_key(&mut font, "o", LEFT, "=n+");
    set_key(&mut font, "H", LEFT, "=m");
    set_key(&mut font, "n", RIGHT, "=|o");

    let order = font.linked_metrics_order(source);

    assert_eq!(ordered(&order), vec![side(&font, "n", RIGHT)]);
    assert_eq!(order.problems.len(), 2);
}

#[test]
fn a_layer_key_wins_over_its_glyph_key() {
    let (mut font, source) = font();
    set_key(&mut font, "o", LEFT, "=n");
    let o_id = font.glyph_id_by_name("o").unwrap();
    let layer_id = font
        .glyph(o_id)
        .unwrap()
        .layer_for_source(source)
        .unwrap()
        .id();
    font.layer_mut(layer_id)
        .unwrap()
        .metrics_keys_mut()
        .set(LEFT, MetricsKey::new("==H"));

    let glyph = font.glyph(o_id).unwrap();
    assert_eq!(
        glyph.metrics_key(source, LEFT).map(MetricsKey::as_str),
        Some("==H")
    );
    assert_eq!(glyph.metrics_key(source, RIGHT), None);
}

/// Keys re-applied by edits: through `Font::apply_intents`, in the same
/// change set as the edit.
mod following {
    use super::*;
    use crate::{FontIntent, FontIntentSet, ShiftSidebearing, Sidebearing, TranslatePoints};

    fn layer_of(font: &Font, glyph: &str, source: SourceId) -> LayerId {
        font.glyph_by_name(glyph)
            .unwrap()
            .layer_for_source(source)
            .unwrap()
            .id()
    }

    fn sidebearings(font: &Font, source: SourceId, glyph: &str) -> (f64, f64, f64) {
        let glyph_id = font.glyph_id_by_name(glyph).unwrap();
        let mut evaluator = MetricsKeyEvaluator::new(font, source).unwrap();
        (
            evaluator.current(glyph_id, LEFT).unwrap(),
            evaluator.current(glyph_id, RIGHT).unwrap(),
            evaluator.current(glyph_id, WIDTH).unwrap(),
        )
    }

    fn shift(font: &mut Font, source: SourceId, glyph: &str, side: Sidebearing, delta: f64) {
        let layer_id = layer_of(font, glyph, source);
        font.apply_intents(&FontIntentSet::from(FontIntent::from(ShiftSidebearing {
            layer_id,
            sidebearing: side,
            delta,
        })))
        .unwrap();
    }

    #[test]
    fn a_linked_side_follows_its_base_in_the_same_change_set() {
        let (mut font, source) = font();
        set_key(&mut font, "o", LEFT, "=n");
        set_key(&mut font, "o", RIGHT, "=n+10");
        let n_layer = layer_of(&font, "n", source);
        let o_layer = layer_of(&font, "o", source);

        let applied = font
            .apply_intents(&FontIntentSet::from(FontIntent::from(ShiftSidebearing {
                layer_id: n_layer,
                sidebearing: Sidebearing::Left,
                delta: 20.0,
            })))
            .unwrap();

        assert_eq!(sidebearings(&font, source, "n").0, 70.0);
        assert_eq!(sidebearings(&font, source, "o"), (70.0, 60.0, 570.0));
        assert!(
            applied
                .layers
                .iter()
                .any(|touched| touched.layer.id() == o_layer)
        );

        font.apply_change_set(&applied.changes.inverted()).unwrap();
        assert_eq!(sidebearings(&font, source, "o"), (40.0, 40.0, 520.0));
    }

    #[test]
    fn editing_a_linked_glyph_puts_its_side_back() {
        let (mut font, source) = font();
        set_key(&mut font, "o", LEFT, "=n");
        let o_layer = layer_of(&font, "o", source);
        let left_points: Vec<_> = font
            .layer(o_layer)
            .unwrap()
            .points()
            .filter(|point| point.x() == 40.0)
            .map(crate::Point::id)
            .collect();

        font.apply_intents(&FontIntentSet::from(FontIntent::from(TranslatePoints {
            layer_id: o_layer,
            point_ids: left_points,
            dx: -25.0,
            dy: 0.0,
        })))
        .unwrap();

        // The outline grew 25 units to the left and the key moved it back.
        let (left, right, width) = sidebearings(&font, source, "o");
        assert_eq!(left, 50.0);
        assert_eq!(width - left - right, 465.0);
    }

    #[test]
    fn a_chain_of_keys_follows_through() {
        let (mut font, source) = font();
        set_key(&mut font, "o", LEFT, "=n");
        set_key(&mut font, "H", LEFT, "=o*2");

        shift(&mut font, source, "n", Sidebearing::Left, 10.0);

        assert_eq!(sidebearings(&font, source, "o").0, 60.0);
        assert_eq!(sidebearings(&font, source, "H").0, 120.0);
    }

    #[test]
    fn a_width_key_follows_its_base() {
        let (mut font, source) = font();
        set_key(&mut font, "o", WIDTH, "=width(n)+20");

        shift(&mut font, source, "n", Sidebearing::Right, 30.0);

        assert_eq!(sidebearings(&font, source, "o").2, 550.0);
    }

    #[test]
    fn keys_that_cannot_be_applied_leave_the_edit_and_their_sides_alone() {
        let (mut font, source) = font();
        set_key(&mut font, "o", LEFT, "=|");
        set_key(&mut font, "o", RIGHT, "=|");
        set_key(&mut font, "H", RIGHT, "=n");
        set_key(&mut font, "H", WIDTH, "=n");

        shift(&mut font, source, "n", Sidebearing::Left, 10.0);
        shift(&mut font, source, "o", Sidebearing::Left, 5.0);

        assert_eq!(sidebearings(&font, source, "n").0, 60.0);
        assert_eq!(sidebearings(&font, source, "o").0, 45.0);
        assert_eq!(sidebearings(&font, source, "H"), (80.0, 80.0, 700.0));
    }

    #[test]
    fn an_edit_in_one_source_leaves_the_others_keys_alone() {
        let (mut font, regular) = font();
        let weight = Axis::weight();
        let weight_id = weight.id();
        font.add_axis(weight).unwrap();
        font.source_mut(regular)
            .unwrap()
            .set_location(DesignLocation::from([(weight_id, 400.0)]));
        let bold = font.add_source(Source::new(
            "Bold".to_string(),
            DesignLocation::from([(weight_id, 700.0)]),
        ));
        add_rectangle(&mut font, bold, "n", 560.0, 30.0, 530.0);
        add_rectangle(&mut font, bold, "o", 580.0, 25.0, 555.0);
        set_key(&mut font, "o", LEFT, "=n");

        shift(&mut font, bold, "n", Sidebearing::Left, 15.0);

        assert_eq!(sidebearings(&font, bold, "o").0, 45.0);
        // Regular's `o` was never brought in line with `n`, and still isn't.
        assert_eq!(sidebearings(&font, regular, "o").0, 40.0);
    }
}

/// What linked metrics add to one edit, on a font big enough that a cost per
/// glyph or per key shows. Run with `cargo test --release -p shift-font --
/// perf_mark` for timings; budgets are asserted only in release builds.
mod perf {
    use std::time::{Duration, Instant};

    use super::*;
    use crate::{FontIntent, FontIntentSet, ShiftSidebearing, Sidebearing};

    const GLYPHS: usize = 10_000;
    /// 300 glyphs linked to `g00000`, then 15 groups of 20 linked to one
    /// base each: a large Latin family's spacing classes.
    const LINKED_TO_ONE: usize = 300;
    const GROUPS: usize = 15;
    const PER_GROUP: usize = 20;

    fn name(index: usize) -> String {
        format!("g{index:05}")
    }

    /// The key both sides of glyph `index` get, if any.
    fn key_of(index: usize) -> Option<String> {
        if (1..=LINKED_TO_ONE).contains(&index) {
            return Some(format!("={}", name(0)));
        }
        let group = index.checked_sub(1_000)? / 100;
        let member = index % 100;
        (group < GROUPS && (1..=PER_GROUP).contains(&member))
            .then(|| format!("={}+5", name(1_000 + group * 100)))
    }

    fn large_font(keyed: bool) -> (Font, SourceId) {
        let mut font = Font::new();
        let source = font.default_source_id().unwrap();
        for index in 0..GLYPHS {
            let mut glyph = Glyph::new(name(index));
            let mut layer = GlyphLayer::with_width(LayerId::new(), source, 600.0);
            for contour in 0..2 {
                let offset = f64::from(u32::try_from(contour * 200).unwrap());
                layer.add_contour(contour![
                    (50.0 + offset, 0),
                    (50.0 + offset, 700),
                    (150.0 + offset, 700),
                    (150.0 + offset, 0)
                ]);
            }
            glyph.set_layer(layer);
            if keyed && let Some(text) = key_of(index) {
                glyph
                    .metrics_keys_mut()
                    .set(LEFT, MetricsKey::new(text.clone()));
                glyph.metrics_keys_mut().set(RIGHT, MetricsKey::new(text));
            }
            font.insert_glyph(glyph).unwrap();
        }
        (font, source)
    }

    /// Median time of `edit` over fifteen runs, after one warm-up run.
    fn median_time(mut edit: impl FnMut(u32)) -> Duration {
        edit(0);
        let mut samples: Vec<Duration> = (1..=15)
            .map(|run| {
                let start = Instant::now();
                edit(run);
                start.elapsed()
            })
            .collect();
        samples.sort();
        samples[samples.len() / 2]
    }

    fn shift_left(font: &mut Font, source: SourceId, glyph: usize) -> Duration {
        let layer_id = font
            .glyph_by_name(&name(glyph))
            .unwrap()
            .layer_for_source(source)
            .unwrap()
            .id();
        median_time(|run| {
            let delta = if run % 2 == 0 { 3.0 } else { -3.0 };
            font.apply_intents(&FontIntentSet::from(FontIntent::from(ShiftSidebearing {
                layer_id,
                sidebearing: Sidebearing::Left,
                delta,
            })))
            .unwrap();
        })
    }

    #[test]
    fn perf_mark_linked_metrics_add_little_to_an_edit() {
        let (mut plain, plain_source) = large_font(false);
        let (mut keyed, source) = large_font(true);
        assert_eq!(keyed.metrics_keyed_glyph_ids().count(), 600);

        let baseline = shift_left(&mut plain, plain_source, 5_000);
        let unread = shift_left(&mut keyed, source, 5_000);
        let read_by_group = shift_left(&mut keyed, source, 1_000);
        let read_by_many = shift_left(&mut keyed, source, 0);
        let scan = median_time(|_| {
            assert!(!keyed.linked_glyph_ids().is_empty());
        });
        let linked_id = keyed.glyph_id_by_name(&name(1)).unwrap();
        let report = median_time(|_| {
            assert_eq!(keyed.linked_sides(linked_id, source).len(), 2);
        });

        println!("perf_mark linked metrics, {GLYPHS} glyphs, 600 keyed:");
        println!("  edit, no keys in the font:        {baseline:?}");
        println!("  edit no key reads:                {unread:?}");
        println!("  edit {PER_GROUP} glyphs follow:            {read_by_group:?}");
        println!("  edit {LINKED_TO_ONE} glyphs follow:           {read_by_many:?}");
        println!("  linked_glyph_ids (engine, per edit): {scan:?}");
        println!("  linked_sides of one glyph (per half drawn): {report:?}");
        if cfg!(debug_assertions) {
            return;
        }
        // About 2x the measured times on a Ryzen 5 5500U (Linux): an edit no
        // key reads costs ~0.5 ms more than in a font without keys, and one
        // that 300 glyphs follow ~7.6 ms. The drag preview runs this per frame.
        assert!(unread < baseline + Duration::from_millis(1), "{unread:?}");
        assert!(
            read_by_group < Duration::from_millis(2),
            "{read_by_group:?}"
        );
        assert!(read_by_many < Duration::from_millis(16), "{read_by_many:?}");
        assert!(scan < Duration::from_millis(2), "{scan:?}");
        assert!(report < Duration::from_micros(200), "{report:?}");
    }
}

#[test]
fn linked_sides_say_where_each_key_is_set_and_what_stops_it() {
    let (mut font, source) = font();
    set_key(&mut font, "o", LEFT, "=n");
    set_key(&mut font, "o", RIGHT, "=o");
    let o_id = font.glyph_id_by_name("o").unwrap();
    let layer_id = font
        .glyph(o_id)
        .unwrap()
        .layer_for_source(source)
        .unwrap()
        .id();
    font.apply_intents(&crate::FontIntentSet::from(crate::SetLayerMetricsKey {
        layer_id,
        side: WIDTH,
        key: Some("==H".to_string()),
    }))
    .unwrap();

    let sides = font.linked_sides(o_id, source);

    let summary: Vec<(MetricsKeySide, &str, KeyLevel, bool)> = sides
        .iter()
        .map(|link| {
            (
                link.side,
                link.key.as_str(),
                link.level,
                link.problem.is_some(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (LEFT, "=n", KeyLevel::Glyph, false),
            (RIGHT, "=o", KeyLevel::Glyph, true),
            (WIDTH, "==H", KeyLevel::Layer, true),
        ]
    );
    assert!(
        font.linked_sides(font.glyph_id_by_name("n").unwrap(), source)
            .is_empty()
    );
}

#[test]
fn setting_a_key_applies_it_and_clearing_it_keeps_the_value() {
    let (mut font, source) = font();
    let o_id = font.glyph_id_by_name("o").unwrap();
    let set = |key: Option<&str>| crate::SetGlyphMetricsKey {
        glyph_id: o_id,
        side: LEFT,
        key: key.map(str::to_owned),
    };

    font.apply_intents(&crate::FontIntentSet::from(set(Some("=H"))))
        .unwrap();
    let mut evaluator = MetricsKeyEvaluator::new(&font, source).unwrap();
    assert_eq!(evaluator.current(o_id, LEFT).unwrap(), 80.0);

    font.apply_intents(&crate::FontIntentSet::from(set(None)))
        .unwrap();
    assert!(font.linked_sides(o_id, source).is_empty());
    let mut evaluator = MetricsKeyEvaluator::new(&font, source).unwrap();
    assert_eq!(evaluator.current(o_id, LEFT).unwrap(), 80.0);
}

#[test]
fn a_typed_key_is_checked_against_the_font() {
    let (font, _) = font();
    assert_eq!(font.metrics_key_problem("=n+10"), None);
    assert_eq!(font.metrics_key_problem("  "), None);
    assert_eq!(
        font.metrics_key_problem("=nn").as_deref(),
        Some("no glyph named `nn`")
    );
    assert!(font.metrics_key_problem("=(n").is_some());
}

#[test]
fn undoing_a_glyph_key_reports_the_layer_it_moved() {
    let (mut font, source) = font();
    let o_id = font.glyph_id_by_name("o").unwrap();
    let o_layer = font
        .glyph(o_id)
        .unwrap()
        .layer_for_source(source)
        .unwrap()
        .id();

    let applied = font
        .apply_intents(&crate::FontIntentSet::from(crate::SetGlyphMetricsKey {
            glyph_id: o_id,
            side: LEFT,
            key: Some("=n".to_string()),
        }))
        .unwrap();
    let undo = applied.changes.inverted();

    // An editor redraws the layers a replayed change set reports.
    assert!(
        undo.touched_layers()
            .iter()
            .any(|touched| touched.layer.id() == o_layer)
    );
    font.apply_change_set(&undo).unwrap();
    let mut evaluator = MetricsKeyEvaluator::new(&font, source).unwrap();
    assert_eq!(evaluator.current(o_id, LEFT).unwrap(), 40.0);
}

#[test]
fn linking_puts_a_key_where_its_prefix_says_and_unlinking_clears_what_holds_the_side() {
    let (mut font, source) = font();
    let o_id = font.glyph_id_by_name("o").unwrap();
    let layer_id = font
        .glyph(o_id)
        .unwrap()
        .layer_for_source(source)
        .unwrap()
        .id();
    let link = |side, key: &str| crate::LinkMetricsSide {
        layer_id,
        side,
        key: key.to_owned(),
    };
    let levels = |font: &Font| -> Vec<(MetricsKeySide, KeyLevel)> {
        font.linked_sides(o_id, source)
            .iter()
            .map(|link| (link.side, link.level))
            .collect()
    };

    font.apply_intents(&crate::FontIntentSet::from(link(LEFT, "==n")))
        .unwrap();
    font.apply_intents(&crate::FontIntentSet::from(link(WIDTH, "=n")))
        .unwrap();
    assert_eq!(
        levels(&font),
        [(LEFT, KeyLevel::Layer), (WIDTH, KeyLevel::Glyph)]
    );

    // A glyph key replaces the layer's own for that side.
    font.apply_intents(&crate::FontIntentSet::from(link(LEFT, "=H")))
        .unwrap();
    assert_eq!(
        levels(&font),
        [(LEFT, KeyLevel::Glyph), (WIDTH, KeyLevel::Glyph)]
    );

    // The width holds the right sidebearing's edge, so unlinking the right clears it.
    font.apply_intents(&crate::FontIntentSet::from(crate::UnlinkMetricsSide {
        layer_id,
        side: RIGHT,
    }))
    .unwrap();
    assert_eq!(levels(&font), [(LEFT, KeyLevel::Glyph)]);

    font.apply_intents(&crate::FontIntentSet::from(link(LEFT, " ")))
        .unwrap();
    assert!(levels(&font).is_empty());
}
