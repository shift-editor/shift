use crate::test_support::sample_font;
use crate::{
    CoreError, FontChange, FontChangeImpact, FontIntent, FontIntentSet, GlyphId, KerningGroupId,
    KerningPair, KerningPosition, KerningSide, KerningValueEdit, SourceId,
};

fn regular() -> SourceId {
    SourceId::from_raw("regular")
}

/// The sample font's first and second groups named `A`.
fn first_a() -> KerningGroupId {
    KerningGroupId::from_raw("first_A")
}

fn second_a() -> KerningGroupId {
    KerningGroupId::from_raw("second_A")
}

fn a_groups() -> KerningPair {
    KerningPair::groups(first_a(), second_a())
}

fn exception() -> KerningPair {
    KerningPair::new(
        KerningSide::Glyph(GlyphId::from_raw("A")),
        KerningSide::Group(second_a()),
    )
}

fn set(edits: Vec<KerningValueEdit>) -> FontIntentSet {
    FontIntentSet {
        intents: vec![FontIntent::SetKerningValues { edits }],
    }
}

#[test]
fn setting_a_value_records_one_reversible_change() {
    let mut font = sample_font();
    let original = font.clone();

    let outcome = font
        .apply_intents(set(vec![KerningValueEdit {
            source_id: regular(),
            pair: a_groups(),
            value: Some(-60.0),
        }]))
        .unwrap();

    assert_eq!(font.kerning().value(&regular(), &a_groups()), Some(-60.0));
    assert_eq!(outcome.changes.changes.len(), 1);
    assert!(matches!(
        &outcome.changes.changes[0],
        FontChange::KerningValue { value, .. } if value.before == Some(-80.0) && value.after == Some(-60.0)
    ));
    assert_eq!(outcome.changes.impact(), FontChangeImpact::KERNING);

    let edited = font.clone();
    font.apply_change_set(&outcome.changes.inverted()).unwrap();
    assert_eq!(font, original);
    font.apply_change_set(&outcome.changes).unwrap();
    assert_eq!(font, edited);
}

#[test]
fn an_exception_is_added_and_removed_without_touching_its_group_pair() {
    let mut font = sample_font();
    let a = GlyphId::from_raw("A");

    font.apply_intents(set(vec![KerningValueEdit {
        source_id: regular(),
        pair: exception(),
        value: Some(-20.0),
    }]))
    .unwrap();
    assert_eq!(
        font.kerning().resolve(&regular(), &a, &a).unwrap().pair,
        exception()
    );

    let outcome = font
        .apply_intents(set(vec![KerningValueEdit {
            source_id: regular(),
            pair: exception(),
            value: None,
        }]))
        .unwrap();
    assert!(matches!(
        &outcome.changes.changes[0],
        FontChange::KerningValue { value, .. } if value.before == Some(-20.0) && value.after.is_none()
    ));
    let resolved = font.kerning().resolve(&regular(), &a, &a).unwrap();
    assert_eq!(resolved.pair, a_groups());
    assert_eq!(resolved.value, -80.0);
}

#[test]
fn an_unchanged_value_records_nothing() {
    let mut font = sample_font();

    let outcome = font
        .apply_intents(set(vec![KerningValueEdit {
            source_id: regular(),
            pair: a_groups(),
            value: Some(-80.0),
        }]))
        .unwrap();

    assert!(outcome.changes.is_empty());
}

#[test]
fn edits_naming_a_missing_group_source_or_a_non_finite_value_are_rejected_atomically() {
    let original = sample_font();
    let rejected = [
        KerningValueEdit {
            source_id: regular(),
            pair: KerningPair::groups(first_a(), KerningGroupId::from_raw("Missing")),
            value: Some(-10.0),
        },
        KerningValueEdit {
            source_id: SourceId::from_raw("missing"),
            pair: a_groups(),
            value: Some(-10.0),
        },
        KerningValueEdit {
            source_id: regular(),
            pair: a_groups(),
            value: Some(f64::NAN),
        },
    ];

    for edit in rejected {
        let mut font = original.clone();
        let result = font.apply_intents(set(vec![
            KerningValueEdit {
                source_id: regular(),
                pair: a_groups(),
                value: Some(-5.0),
            },
            edit,
        ]));
        assert!(result.is_err());
        assert_eq!(font, original);
    }

    let mut font = original.clone();
    assert!(matches!(
        font.apply_intents(set(vec![KerningValueEdit {
            source_id: regular(),
            pair: KerningPair::groups(first_a(), KerningGroupId::from_raw("Missing")),
            value: Some(-10.0),
        }])),
        Err(CoreError::KerningGroupNotFound(_))
    ));
}

#[test]
fn a_group_on_the_wrong_side_of_a_pair_is_rejected() {
    let mut font = sample_font();
    let original = font.clone();

    let result = font.apply_intents(set(vec![KerningValueEdit {
        source_id: regular(),
        pair: KerningPair::groups(second_a(), second_a()),
        value: Some(-10.0),
    }]));

    assert!(matches!(
        result,
        Err(CoreError::KerningGroupPosition {
            position: KerningPosition::First,
            ..
        })
    ));
    assert_eq!(font, original);
}
