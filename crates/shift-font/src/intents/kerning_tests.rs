use crate::test_support::sample_font;
use crate::{
    CoreError, FontChange, FontChangeImpact, FontIntent, FontIntentSet, GlyphId, KerningPair,
    KerningPosition, KerningSide, KerningValueEdit, SourceId,
};

fn regular() -> SourceId {
    SourceId::from_raw("regular")
}

fn exception() -> KerningPair {
    KerningPair::new(
        KerningSide::Glyph(GlyphId::from_raw("A")),
        KerningSide::Group("A".to_string()),
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
            pair: KerningPair::groups("A", "A"),
            value: Some(-60.0),
        }]))
        .unwrap();

    assert_eq!(
        font.kerning()
            .value(&regular(), &KerningPair::groups("A", "A")),
        Some(-60.0)
    );
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
    assert_eq!(resolved.pair, KerningPair::groups("A", "A"));
    assert_eq!(resolved.value, -80.0);
}

#[test]
fn an_unchanged_value_records_nothing() {
    let mut font = sample_font();

    let outcome = font
        .apply_intents(set(vec![KerningValueEdit {
            source_id: regular(),
            pair: KerningPair::groups("A", "A"),
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
            pair: KerningPair::groups("A", "Missing"),
            value: Some(-10.0),
        },
        KerningValueEdit {
            source_id: SourceId::from_raw("missing"),
            pair: KerningPair::groups("A", "A"),
            value: Some(-10.0),
        },
        KerningValueEdit {
            source_id: regular(),
            pair: KerningPair::groups("A", "A"),
            value: Some(f64::NAN),
        },
    ];

    for edit in rejected {
        let mut font = original.clone();
        let result = font.apply_intents(set(vec![
            KerningValueEdit {
                source_id: regular(),
                pair: KerningPair::groups("A", "A"),
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
            pair: KerningPair::groups("A", "Missing"),
            value: Some(-10.0),
        }])),
        Err(CoreError::KerningGroupNotFound {
            position: KerningPosition::Second,
            ..
        })
    ));
}
