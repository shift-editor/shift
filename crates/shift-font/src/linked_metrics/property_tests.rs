//! Generated keys and glyph names: every key Shift prints parses back to the
//! same tree, bare hyphenated names resolve against the font, and no input
//! panics or takes long.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use proptest::prelude::*;

use super::syntax::candidate_names;
use super::*;
use crate::GlyphName;

/// Glyph names in the shapes real fonts use: a base, an optional script tag
/// after a hyphen, and dotted suffixes.
fn glyph_name() -> impl Strategy<Value = String> {
    let base = prop_oneof![
        prop::sample::select(vec![
            "a", "n", "o", "H", "A", "ain", "beh", "alef", "yeh", "lam_alef", "f_f_i", "uni0627",
            "uniFEB4", "zero", "one", "Lcaron", "ka", "_part", "dotabove", "ع", "Ж", "α",
        ])
        .prop_map(str::to_owned),
        "[a-zA-Z][a-zA-Z0-9_]{0,6}",
    ];
    let script = prop::option::of(prop::sample::select(vec![
        "-ar", "-cy", "-deva", "-he", "-gr", "-latn",
    ]));
    let suffixes = prop::collection::vec(
        prop::sample::select(vec![
            ".medi", ".init", ".fina", ".isol", ".sc", ".ss01", ".alt", ".001", ".2", ".case",
            ".tf",
        ]),
        0..3,
    );
    (base, script, suffixes).prop_map(|(base, script, suffixes)| {
        format!("{base}{}{}", script.unwrap_or(""), suffixes.concat())
    })
}

fn number() -> impl Strategy<Value = f64> {
    (0u32..4000).prop_map(|quarters| f64::from(quarters) / 4.0)
}

fn height() -> impl Strategy<Value = Option<f64>> {
    prop::option::of((-200i32..1200).prop_map(f64::from))
}

/// A measurement of one of `names`, in every form the grammar has.
fn measure(names: Vec<String>) -> impl Strategy<Value = Expr> {
    let name = prop::sample::select(names);
    let side = prop::sample::select(vec![
        MeasureSide::Same,
        MeasureSide::Opposite,
        MeasureSide::Left,
        MeasureSide::Right,
        MeasureSide::Width,
    ]);
    (name, side, height(), any::<bool>()).prop_map(|(name, side, at, own_glyph)| {
        let glyph = (side != MeasureSide::Opposite || !own_glyph).then(|| GlyphName::from(name));
        Expr::Measure(Measure { glyph, side, at })
    })
}

/// An expression tree over `names`, a few levels deep.
fn expr(names: Vec<String>) -> impl Strategy<Value = Expr> {
    let leaf = prop_oneof![number().prop_map(Expr::Number), measure(names)];
    leaf.prop_recursive(4, 24, 3, |inner| {
        let op = prop::sample::select(vec![
            BinaryOp::Add,
            BinaryOp::Subtract,
            BinaryOp::Multiply,
            BinaryOp::Divide,
        ]);
        prop_oneof![
            (op, inner.clone(), inner.clone()).prop_map(|(op, left, right)| Expr::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            }),
            inner
                .clone()
                .prop_map(|value| Expr::Negate(Box::new(value))),
            inner.clone().prop_map(|value| Expr::Round(Box::new(value))),
            (
                prop::sample::select(vec![Function::Min, Function::Max]),
                prop::collection::vec(inner, 1..4),
            )
                .prop_map(|(function, args)| Expr::Call { function, args }),
        ]
    })
}

/// `expr` as a key body: spaced and fully bracketed, so a name never runs into
/// an operator and the tree it prints is the only reading.
fn print(expr: &Expr) -> String {
    match expr {
        Expr::Number(value) => value.to_string(),
        Expr::Measure(Measure { glyph, side, at }) => {
            let name = glyph.as_ref().map_or("", GlyphName::as_str);
            let at = at.map_or(String::new(), |height| format!(" @ {height}"));
            match side {
                MeasureSide::Same => format!("{name}{at}"),
                MeasureSide::Opposite => format!("|{name}{at}"),
                MeasureSide::Left => format!("lsb({name}{at})"),
                MeasureSide::Right => format!("rsb({name}{at})"),
                MeasureSide::Width => format!("width({name}{at})"),
            }
        }
        Expr::Negate(value) => format!("-({})", print(value)),
        Expr::Binary { op, left, right } => {
            let symbol = match op {
                BinaryOp::Add => "+",
                BinaryOp::Subtract => "-",
                BinaryOp::Multiply => "*",
                BinaryOp::Divide => "/",
            };
            format!("({} {symbol} {})", print(left), print(right))
        }
        Expr::Call { function, args } => {
            let name = match function {
                Function::Min => "min",
                Function::Max => "max",
            };
            let args: Vec<String> = args.iter().map(print).collect();
            format!("{name}({})", args.join(", "))
        }
        Expr::Round(value) => format!("round({})", print(value)),
    }
}

/// Every glyph `expr` measures.
fn measured(expr: &Expr, names: &mut BTreeSet<String>) {
    match expr {
        Expr::Number(_) => {}
        Expr::Measure(measure) => {
            names.extend(measure.glyph.as_ref().map(|name| name.as_str().to_owned()));
        }
        Expr::Negate(value) | Expr::Round(value) => measured(value, names),
        Expr::Binary { left, right, .. } => {
            measured(left, names);
            measured(right, names);
        }
        Expr::Call { args, .. } => args.iter().for_each(|arg| measured(arg, names)),
    }
}

fn body(text: &str, font: &BTreeSet<String>) -> Result<Expr, MetricsKeyError> {
    match parse(text, &|name| font.contains(name))?.body {
        KeyBody::Expr(expr) => Ok(expr),
        KeyBody::AutoOffset(offset) => panic!("{text} parsed as an offset of {offset}"),
    }
}

/// A font's glyph names and an expression over them.
fn font_and_expr() -> impl Strategy<Value = (BTreeSet<String>, Expr)> {
    prop::collection::btree_set(glyph_name(), 1..6).prop_flat_map(|font| {
        let names: Vec<String> = font.iter().cloned().collect();
        (Just(font), expr(names))
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn every_printed_key_parses_back_to_its_tree((font, expr) in font_and_expr()) {
        let text = print(&expr);

        for prefix in ["=", "==", ""] {
            prop_assert_eq!(body(&format!("{prefix}{text}"), &font)?, expr.clone(), "{}{}", prefix, text);
        }
    }

    #[test]
    fn the_prefix_alone_decides_the_scope((font, expr) in font_and_expr()) {
        let text = print(&expr);
        let has_glyph = |name: &str| font.contains(name);

        prop_assert_eq!(parse(&format!("=={text}"), &has_glyph)?.scope, KeyScope::ThisSource);
        prop_assert_eq!(parse(&format!("={text}"), &has_glyph)?.scope, KeyScope::EverySource);
        prop_assert_eq!(parse(&text, &has_glyph)?.scope, KeyScope::EverySource);
    }

    #[test]
    fn candidate_names_include_every_glyph_a_key_measures((_font, expr) in font_and_expr()) {
        let text = format!("={}", print(&expr));
        let candidates: BTreeSet<&str> = candidate_names(&text).collect();
        let mut names = BTreeSet::new();
        measured(&expr, &mut names);

        for name in &names {
            prop_assert!(candidates.contains(name.as_str()), "{} missing from {:?}", name, candidates);
        }
    }

    #[test]
    fn a_bare_name_is_the_glyph_the_font_has(name in glyph_name(), offset in 1u32..1000) {
        let font = BTreeSet::from([name.clone()]);
        let glyph = |name: &str| Expr::Measure(Measure {
            glyph: Some(GlyphName::from(name)),
            side: MeasureSide::Same,
            at: None,
        });

        prop_assert_eq!(body(&format!("={name}"), &font)?, glyph(&name));
        prop_assert_eq!(
            body(&format!("={name}-{offset}"), &font)?,
            Expr::Binary {
                op: BinaryOp::Subtract,
                left: Box::new(glyph(&name)),
                right: Box::new(Expr::Number(f64::from(offset))),
            }
        );
        prop_assert_eq!(
            body(&format!("=|{name}"), &font)?,
            Expr::Measure(Measure {
                glyph: Some(GlyphName::from(name.as_str())),
                side: MeasureSide::Opposite,
                at: None,
            })
        );
    }

    #[test]
    fn two_names_joined_by_a_hyphen_read_as_names_the_font_has(
        first in glyph_name(),
        second in glyph_name(),
    ) {
        let font = BTreeSet::from([first.clone(), second.clone()]);
        let text = format!("={first}-{second}");
        let mut names = BTreeSet::new();
        measured(&body(&text, &font)?, &mut names);

        prop_assert!(names.is_subset(&font), "{} measured {:?}", text, names);
    }

    #[test]
    fn a_name_the_font_lacks_is_an_unknown_glyph(name in glyph_name()) {
        let result = parse(&format!("={name}"), &|_| false);

        prop_assert!(matches!(result, Err(MetricsKeyError::UnknownGlyph(_))), "{:?}", result);
    }

    #[test]
    fn no_text_panics(
        text in prop_oneof!["\\PC{0,40}", "[a-z0-9.\\-+*/|@(), =_]{0,40}"],
        known in any::<bool>(),
    ) {
        let _ = parse(&text, &|name| known && name.len() % 2 == 0);
        let _ = is_glyphs_syntax(&text);
        let _ = candidate_names(&text).count();
    }
}

#[test]
fn a_long_hyphenated_word_parses_quickly() {
    let word = vec!["x"; 60].join("-");
    let start = Instant::now();

    let result = parse(&format!("={word}"), &|_| false);

    assert!(matches!(result, Err(MetricsKeyError::UnknownGlyph(_))));
    assert!(
        start.elapsed() < Duration::from_millis(50),
        "took {:?}",
        start.elapsed()
    );
}
