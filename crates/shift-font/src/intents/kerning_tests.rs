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

fn one(intent: FontIntent) -> FontIntentSet {
    FontIntentSet {
        intents: vec![intent],
    }
}

fn create(group_id: &KerningGroupId, position: KerningPosition, name: &str) -> FontIntent {
    FontIntent::CreateKerningGroup {
        group_id: group_id.clone(),
        position,
        name: name.to_string(),
    }
}

#[test]
fn moving_a_glyph_into_a_new_group_is_one_reversible_step() {
    let mut font = sample_font();
    let original = font.clone();
    let a = GlyphId::from_raw("A");
    let round = KerningGroupId::from_raw("round");

    let outcome = font
        .apply_intents(FontIntentSet {
            intents: vec![
                create(&round, KerningPosition::First, " Round "),
                FontIntent::SetKerningGroupMember {
                    position: KerningPosition::First,
                    glyph_id: a.clone(),
                    group_id: Some(round.clone()),
                },
            ],
        })
        .unwrap();

    assert_eq!(
        font.kerning().group_of(KerningPosition::First, &a),
        Some(&round)
    );
    assert_eq!(font.kerning().group(&round).unwrap().name, "Round");
    assert!(font.kerning().group(&first_a()).unwrap().members.is_empty());
    // The new group and the group A left.
    assert_eq!(outcome.changes.changes.len(), 2);
    font.apply_change_set(&outcome.changes.inverted()).unwrap();
    assert_eq!(font, original);
}

#[test]
fn taking_a_glyph_out_of_its_group_keeps_the_group() {
    let mut font = sample_font();
    let a = GlyphId::from_raw("A");

    font.apply_intents(one(FontIntent::SetKerningGroupMember {
        position: KerningPosition::Second,
        glyph_id: a.clone(),
        group_id: None,
    }))
    .unwrap();

    assert_eq!(font.kerning().group_of(KerningPosition::Second, &a), None);
    assert!(font.kerning().group(&second_a()).is_some());
}

#[test]
fn renaming_a_group_keeps_its_pairs() {
    let mut font = sample_font();
    let original = font.clone();

    let outcome = font
        .apply_intents(one(FontIntent::RenameKerningGroup {
            group_id: first_a(),
            name: "Round".to_string(),
        }))
        .unwrap();

    assert_eq!(font.kerning().group(&first_a()).unwrap().name, "Round");
    assert_eq!(font.kerning().value(&regular(), &a_groups()), Some(-80.0));
    assert_eq!(outcome.changes.changes.len(), 1);
    font.apply_change_set(&outcome.changes.inverted()).unwrap();
    assert_eq!(font, original);
}

#[test]
fn deleting_a_group_keeps_its_pairs_for_undo() {
    let mut font = sample_font();
    let original = font.clone();
    let a = GlyphId::from_raw("A");

    let outcome = font
        .apply_intents(one(FontIntent::DeleteKerningGroup {
            group_id: second_a(),
        }))
        .unwrap();

    assert!(font.kerning().group(&second_a()).is_none());
    assert_eq!(font.kerning().resolve(&regular(), &a, &a), None);
    assert_eq!(font.kerning().value(&regular(), &a_groups()), Some(-80.0));
    font.apply_change_set(&outcome.changes.inverted()).unwrap();
    assert_eq!(font, original);
}

#[test]
fn group_edits_reject_bad_names_ids_and_positions_without_changing_anything() {
    let mut font = sample_font();
    let original = font.clone();
    let rejected = [
        create(
            &KerningGroupId::from_raw("blank"),
            KerningPosition::First,
            "  ",
        ),
        create(&first_a(), KerningPosition::First, "Again"),
        create(
            &KerningGroupId::from_raw("twin"),
            KerningPosition::First,
            "A",
        ),
        FontIntent::RenameKerningGroup {
            group_id: first_a(),
            name: "bad\nname".to_string(),
        },
        FontIntent::SetKerningGroupMember {
            position: KerningPosition::First,
            glyph_id: GlyphId::from_raw("A"),
            group_id: Some(second_a()),
        },
        FontIntent::DeleteKerningGroup {
            group_id: KerningGroupId::from_raw("missing"),
        },
    ];

    for intent in rejected {
        assert!(font.apply_intents(one(intent)).is_err());
        assert_eq!(font, original);
    }
}
