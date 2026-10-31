use super::*;
use crate::test_support::sample_font;
use crate::{FontIntentSet, RemovePoints, SetPositions};

const LAYER: &str = "A_regular";

fn layer_id() -> LayerId {
    LayerId::from_raw(LAYER)
}

/// Every position of the sample layer moved one unit right.
fn moved(font: &Font) -> SetPositions {
    let layer = font.layer(layer_id()).unwrap();
    let count = layer.points().count() + layer.anchors().len();
    let values = layer.interpolation_values().into_vec();
    SetPositions {
        layer_id: layer_id(),
        positions: values[1..=count * 2]
            .iter()
            .enumerate()
            .map(|(index, value)| if index % 2 == 0 { value + 1.0 } else { *value })
            .collect(),
    }
}

/// `compact` sent through serde, as the bridge receives it.
fn sent(compact: &CompactChangeSet) -> CompactChangeSet {
    serde_json::from_str(&serde_json::to_string(compact).unwrap()).unwrap()
}

#[test]
fn a_move_travels_as_values_and_expands_to_the_same_change() {
    let before = sample_font();
    let mut after = before.clone();
    let applied = after
        .apply_intents(&FontIntentSet::from(moved(&before)))
        .unwrap();

    let compact = applied.changes.compact();
    assert_eq!(compact.value_layer_ids().collect::<Vec<_>>(), [layer_id()]);

    let expanded = sent(&compact).expand(&before).unwrap();
    assert_eq!(expanded, applied.changes);
    let mut replayed = before;
    replayed.apply_change_set(&expanded).unwrap();
    assert_eq!(replayed.layer(layer_id()), after.layer(layer_id()));
}

#[test]
fn a_structural_change_travels_whole() {
    let mut font = sample_font();
    let point = font
        .layer(layer_id())
        .unwrap()
        .points()
        .next()
        .unwrap()
        .id();
    let applied = font
        .apply_intents(&FontIntentSet::from(RemovePoints {
            layer_id: layer_id(),
            point_ids: vec![point],
        }))
        .unwrap();

    let compact = applied.changes.compact();

    assert_eq!(compact.value_layer_ids().count(), 0);
    assert_eq!(
        sent(&compact).expand(&sample_font()).unwrap(),
        applied.changes
    );
}

#[test]
fn a_change_outside_the_values_is_never_sent_as_values() {
    let font = sample_font();
    let glyph_id = font.glyph_id_by_layer(layer_id()).unwrap();
    let before = Arc::new(font.layer(layer_id()).unwrap().clone());
    let mut taller = GlyphLayer::clone(&before);
    taller.set_height(Some(999.0));
    let change_set = FontChangeSet::new(vec![FontChange::Layer {
        glyph_id,
        layer: Replacement::new(Some(before), Some(Arc::new(taller))),
        structural: false,
    }]);

    assert_eq!(change_set.compact().value_layer_ids().count(), 0);
}

#[test]
fn values_sent_against_a_layer_that_moved_since_are_rejected() {
    let before = sample_font();
    let mut after = before.clone();
    let applied = after
        .apply_intents(&FontIntentSet::from(moved(&before)))
        .unwrap();

    let stale = sent(&applied.changes.compact()).expand(&after);

    assert!(matches!(stale, Err(CoreError::ChangeOriginMismatch { .. })));
}
