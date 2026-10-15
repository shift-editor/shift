use std::path::PathBuf;

use read_fonts::tables::math::MathConstant;
use read_fonts::{FontRef, TableProvider};

fn wpt_font(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fonts/wpt")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

#[test]
fn wpt_fonts_carry_the_math_constants_their_names_promise() {
    let cases = [
        (
            "fraction-numeratorgapmin9000-rulethickness1000.otf",
            MathConstant::FractionNumeratorGapMin,
            9000,
        ),
        (
            "fraction-numeratorgapmin9000-rulethickness1000.otf",
            MathConstant::FractionRuleThickness,
            1000,
        ),
        (
            "radical-verticalgap6000-rulethickness1000.otf",
            MathConstant::RadicalVerticalGap,
            6000,
        ),
        (
            "scripts-superscriptshiftup7000.otf",
            MathConstant::SuperscriptShiftUp,
            7000,
        ),
        (
            "limits-lowerlimitgapmin11000.otf",
            MathConstant::LowerLimitGapMin,
            11000,
        ),
        (
            "underover-accentbaseheight4000-overbarverticalgap11000.otf",
            MathConstant::AccentBaseHeight,
            4000,
        ),
    ];

    for (name, constant, expected) in cases {
        let data = wpt_font(name);
        let font = FontRef::new(&data).unwrap();
        let constants = font.math().unwrap().math_constants().unwrap();
        assert_eq!(
            constants.constant(constant),
            expected,
            "{name} {constant:?}"
        );
    }
}

#[test]
fn wpt_fonts_leave_unnamed_constants_at_zero() {
    let data = wpt_font("fraction-numeratorgapmin9000-rulethickness1000.otf");
    let font = FontRef::new(&data).unwrap();
    let constants = font.math().unwrap().math_constants().unwrap();

    assert_eq!(
        constants.constant(MathConstant::FractionDenominatorGapMin),
        0
    );
    assert_eq!(constants.constant(MathConstant::AxisHeight), 0);
}
