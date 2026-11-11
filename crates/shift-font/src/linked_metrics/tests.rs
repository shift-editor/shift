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
    order.keys.iter().map(|(linked, _)| *linked).collect()
}

#[test]
fn keys_come_after_the_keys_they_read() {
    let (mut font, source) = font();
    set_key(&mut font, "H", LEFT, "=o");
    set_key(&mut font, "o", LEFT, "=n");
    set_key(&mut font, "o", WIDTH, "=n");
    set_key(&mut font, "A", LEFT, "=width(o)/2");

    let order = linked_metrics_order(&font, source);

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

    let order = linked_metrics_order(&font, source);

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

    let order = linked_metrics_order(&font, source);

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

    let order = linked_metrics_order(&font, source);

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

    let order = linked_metrics_order(&font, source);

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
