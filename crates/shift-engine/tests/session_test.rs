//! A session over a partly loaded font edits exactly as a fully loaded font
//! does: it loads what each edit reads before applying it.

use std::collections::BTreeSet;
use std::convert::Infallible;

use proptest::prelude::*;
use shift_engine::{EditHistory, EngineSession, LayerSource};
use shift_font::test_support::sample_font;
use shift_font::{
    AddComponent, Anchor, AnchorId, Component, ComponentId, DecomposeComponents,
    DecomposedTransform, Font, FontIntent, FontIntentSet, Glyph, GlyphId, GlyphLayer, LayerId,
    MoveAnchors, MovePoints, SourceId, contour,
};

const BASES: usize = 4;
const MARKS: usize = 2;
const COMPOSITES: usize = 6;

/// Bases with `top` anchors, marks with `_top`, composites of one base and one
/// mark, and a composite built on a composite, in every source.
fn composite_font() -> Font {
    let mut font = sample_font();
    let sources: Vec<SourceId> = font.sources().iter().map(shift_font::Source::id).collect();
    let mut add = |name: &str, layer: &dyn Fn(&mut GlyphLayer)| {
        let mut glyph = Glyph::with_id(GlyphId::from_raw(name), name);
        for source_id in &sources {
            let mut content = GlyphLayer::with_width(
                LayerId::from_raw(format!("{name}@{source_id}")),
                *source_id,
                500.0,
            );
            layer(&mut content);
            glyph.set_layer(content);
        }
        font.insert_glyph(glyph).unwrap();
    };
    for base in 0..BASES {
        add(&format!("base{base}"), &|layer| {
            layer.add_contour(contour![(0, 0), (400, 0), (400, 700), (0, 700)]);
            layer.add_anchor(Anchor::with_id(
                AnchorId::from_raw(format!("{}_top", layer.id())),
                Some("top".to_string()),
                200.0,
                700.0,
            ));
        });
    }
    for mark in 0..MARKS {
        add(&format!("mark{mark}"), &|layer| {
            layer.add_contour(contour![(0, 0), (100, 0), (100, 100)]);
            layer.add_anchor(Anchor::with_id(
                AnchorId::from_raw(format!("{}__top", layer.id())),
                Some("_top".to_string()),
                50.0,
                0.0,
            ));
        });
    }
    let component = |id: String, base: String| {
        Component::with_id(
            ComponentId::from_raw(id),
            GlyphId::from_raw(&base),
            base,
            DecomposedTransform::identity(),
        )
    };
    for composite in 0..COMPOSITES {
        add(&format!("composite{composite}"), &|layer| {
            layer.add_component(component(
                format!("{}_base", layer.id()),
                format!("base{}", composite % BASES),
            ));
            layer.add_component(component(
                format!("{}_mark", layer.id()),
                format!("mark{}", composite % MARKS),
            ));
        });
    }
    add("nested", &|layer| {
        layer.add_component(component(
            format!("{}_inner", layer.id()),
            "composite0".into(),
        ));
    });
    font
}

/// The persisted font: what a store holds once each committed edit is written.
struct Persisted(Font);

impl LayerSource for Persisted {
    type Error = Infallible;

    fn load_layers(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphLayer>, Infallible> {
        Ok(layer_ids
            .iter()
            .filter_map(|layer_id| self.0.layer(*layer_id).cloned())
            .collect())
    }

    fn component_closure(&mut self, roots: &[GlyphId]) -> Result<Vec<GlyphId>, Infallible> {
        let mut pending = roots.to_vec();
        let mut closure = BTreeSet::new();
        while let Some(glyph_id) = pending.pop() {
            if !closure.insert(glyph_id) {
                continue;
            }
            if let Some(glyph) = self.0.glyph(glyph_id) {
                pending.extend(glyph.layers().values().flat_map(|layer| bases(layer)));
            }
        }
        Ok(closure.into_iter().collect())
    }

    fn dependents(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphId>, Infallible> {
        let targets: BTreeSet<GlyphId> = layer_ids
            .iter()
            .filter_map(|layer_id| self.0.glyph_id_by_layer(*layer_id))
            .collect();
        Ok(self
            .0
            .glyphs()
            .filter(|glyph| {
                glyph
                    .layers()
                    .values()
                    .any(|layer| bases(layer).any(|base| targets.contains(&base)))
            })
            .map(Glyph::id)
            .collect())
    }
}

fn bases(layer: &GlyphLayer) -> impl Iterator<Item = GlyphId> + '_ {
    layer.components_iter().map(Component::base_glyph_id)
}

#[derive(Clone, Debug)]
enum Step {
    MovePoint {
        glyph: usize,
        layer: usize,
        dx: i16,
    },
    MoveAnchor {
        base: usize,
        layer: usize,
        dy: i16,
    },
    AddComponent {
        glyph: usize,
        layer: usize,
        base: usize,
    },
    Decompose {
        glyph: usize,
        layer: usize,
    },
    Preload {
        glyph: usize,
    },
    Evict {
        glyph: usize,
    },
}

fn step() -> impl Strategy<Value = Step> {
    let index = 0..64usize;
    prop_oneof![
        (index.clone(), 0..2usize, -50..50i16).prop_map(|(glyph, layer, dx)| Step::MovePoint {
            glyph,
            layer,
            dx
        }),
        (0..BASES, 0..2usize, -50..50i16).prop_map(|(base, layer, dy)| Step::MoveAnchor {
            base,
            layer,
            dy
        }),
        (index.clone(), 0..2usize, index.clone())
            .prop_map(|(glyph, layer, base)| Step::AddComponent { glyph, layer, base }),
        (index.clone(), 0..2usize).prop_map(|(glyph, layer)| Step::Decompose { glyph, layer }),
        index.clone().prop_map(|glyph| Step::Preload { glyph }),
        index.prop_map(|glyph| Step::Evict { glyph }),
    ]
}

fn nth<T: Clone>(items: &[T], index: usize) -> T {
    items[index % items.len()].clone()
}

/// The intent a step makes against the fully loaded font, if any.
fn intent(font: &Font, glyphs: &[GlyphId], step: &Step, number: usize) -> Option<FontIntent> {
    let layer_of = |glyph: &GlyphId, layer: usize| -> Option<&GlyphLayer> {
        let layers: Vec<&GlyphLayer> = font
            .glyph(*glyph)?
            .layers()
            .values()
            .map(AsRef::as_ref)
            .collect();
        Some(nth(&layers, layer))
    };
    match step {
        Step::MovePoint { glyph, layer, dx } => {
            let layer = layer_of(&nth(glyphs, *glyph), *layer)?;
            let point = layer.contours_iter().next()?.points().first()?.clone();
            Some(
                MovePoints {
                    layer_id: layer.id(),
                    point_ids: vec![point.id()],
                    coords: vec![point.x() + f64::from(*dx), point.y()],
                }
                .into(),
            )
        }
        Step::MoveAnchor { base, layer, dy } => {
            let layer = layer_of(&GlyphId::from_raw(format!("base{base}")), *layer)?;
            let anchor = layer.anchors_iter().next()?.clone();
            Some(
                MoveAnchors {
                    layer_id: layer.id(),
                    anchor_ids: vec![anchor.id()],
                    coords: vec![anchor.x(), anchor.y() + f64::from(*dy)],
                }
                .into(),
            )
        }
        Step::AddComponent { glyph, layer, base } => Some(
            AddComponent {
                layer_id: layer_of(&nth(glyphs, *glyph), *layer)?.id(),
                component_id: ComponentId::from_raw(format!("added{number}")),
                base_glyph_id: nth(glyphs, *base),
            }
            .into(),
        ),
        Step::Decompose { glyph, layer } => {
            let layer = layer_of(&nth(glyphs, *glyph), *layer)?;
            let component = layer.components_iter().next()?.id();
            Some(
                DecomposeComponents {
                    layer_id: layer.id(),
                    component_ids: vec![component],
                }
                .into(),
            )
        }
        Step::Preload { .. } | Step::Evict { .. } => None,
    }
}

proptest! {
    #[test]
    fn a_partly_loaded_session_edits_as_a_fully_loaded_font(steps in prop::collection::vec(step(), 1..40)) {
        let mut reference = composite_font();
        let glyphs: Vec<GlyphId> = reference.glyphs().map(Glyph::id).collect();
        let mut persisted = Persisted(reference.clone());
        let mut session = EngineSession::open_directory(placeholders(&reference));

        for (number, step) in steps.iter().enumerate() {
            match step {
                Step::Preload { glyph } => {
                    session.load_glyphs(&mut persisted, &[nth(&glyphs, *glyph)]).unwrap();
                    continue;
                }
                Step::Evict { glyph } => {
                    session.evict(&[nth(&glyphs, *glyph)]).unwrap();
                    continue;
                }
                _ => {}
            }
            let Some(intent) = intent(&reference, &glyphs, step, number) else {
                continue;
            };
            let set = FontIntentSet::from(intent);
            let expected = reference.clone().apply_intents(&set);
            let actual = session.apply(&mut persisted, &set);
            match (expected, actual) {
                (Ok(expected), Ok(actual)) => {
                    let (expected_text, actual_text) =
                        (without_minted_ids(&expected.changes), without_minted_ids(&actual.changes));
                    if expected_text != actual_text {
                        let (expected, actual) = (expected_text, actual_text);
                        let at = expected.chars().zip(actual.chars()).take_while(|(a, b)| a == b).count();
                        let from = at.saturating_sub(300);
                        prop_assert!(false, "{step:?}\nexpected …{}\nactual   …{}", &expected[from..(at + 300).min(expected.len())], &actual[from..(at + 300).min(actual.len())]);
                    }
                    // Decompose mints fresh ids; carry the session's forward so
                    // later steps name the same entities on both sides.
                    reference.apply_change_set(&actual.changes).unwrap();
                    persisted.0.apply_change_set(&actual.changes).unwrap();
                }
                (Err(_), Err(_)) => {}
                (expected, actual) => prop_assert!(
                    false,
                    "{step:?}: fully loaded {:?}, session {:?}",
                    expected.map(|applied| applied.changes),
                    actual.map(|applied| applied.changes)
                ),
            }
        }

        session.load_all(&mut persisted).unwrap();
        prop_assert!(session.font() == &reference);
    }
}

/// `font` with every layer replaced by an empty placeholder of the same
/// identity and metrics, as a store's directory loads it.
fn placeholders(font: &Font) -> Font {
    let mut directory = font.clone();
    let layers: Vec<GlyphLayer> = font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .map(|layer| {
            let mut placeholder =
                GlyphLayer::with_width(layer.id(), layer.source_id(), layer.width());
            placeholder.set_height(layer.height());
            placeholder
        })
        .collect();
    directory.replace_glyph_layers(layers).unwrap();
    directory
}

/// `changes` with every contour and point id masked, since decomposing mints
/// fresh ones.
fn without_minted_ids(changes: &shift_font::FontChangeSet) -> String {
    let mut text = format!("{changes:?}");
    for prefix in ["ContourId(\"contour_", "PointId(\"point_"] {
        let mut masked = String::with_capacity(text.len());
        let mut rest = text.as_str();
        while let Some(start) = rest.find(prefix) {
            let id_start = start + prefix.len();
            let id_end = rest[id_start..]
                .find('"')
                .map_or(rest.len(), |end| id_start + end);
            masked.push_str(&rest[..id_start]);
            masked.push('_');
            rest = &rest[id_end..];
        }
        masked.push_str(rest);
        text = masked;
    }
    text
}

#[test]
fn components_not_persisted_yet_still_load_their_bases() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let layer_id = LayerId::from_raw(format!("composite0@{}", font.sources()[0].id()));
    let base = GlyphId::from_raw("base1");

    // The renderer adds a component the store has not seen yet.
    let add = FontIntentSet::from(FontIntent::from(AddComponent {
        layer_id,
        component_id: ComponentId::from_raw("unpersisted"),
        base_glyph_id: base,
    }));
    session.apply(&mut persisted, &add).unwrap();
    session.evict(std::slice::from_ref(&base)).unwrap();

    let component = font
        .layer(layer_id)
        .unwrap()
        .components_iter()
        .next()
        .unwrap()
        .id();
    let edit = FontIntentSet::from(FontIntent::from(DecomposeComponents {
        layer_id,
        component_ids: vec![component],
    }));
    session.load_reads(&mut persisted, &edit).unwrap();

    let base_layers: Vec<LayerId> = font.glyph(base).unwrap().layer_ids().collect();
    assert!(
        base_layers
            .iter()
            .all(|layer_id| !session.residency().is_unloaded(*layer_id))
    );
}

#[test]
fn a_preview_shows_the_edit_and_keeps_the_font_as_it_was() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let layer_id = LayerId::from_raw(format!("composite0@{}", font.sources()[0].id()));
    let add = FontIntentSet::from(FontIntent::from(AddComponent {
        layer_id,
        component_id: ComponentId::from_raw("previewed"),
        base_glyph_id: GlyphId::from_raw("base1"),
    }));

    let previewed = session.preview(&mut persisted, &add).unwrap();

    let shown = previewed
        .layers
        .iter()
        .find(|touched| touched.layer.id() == layer_id)
        .unwrap();
    let components = |layer: &GlyphLayer| layer.components_iter().count();
    let kept = session.font().layer(layer_id).unwrap();
    assert_eq!(components(&shown.layer), components(kept) + 1);
    assert_eq!(kept, font.layer(layer_id).unwrap());
}

#[test]
fn a_partly_loaded_session_hands_out_the_directory_the_store_would() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    session
        .load_glyphs(&mut persisted, &[GlyphId::from_raw("composite0")])
        .unwrap();

    let directory = session.directory().unwrap();

    assert!(directory == placeholders(&font));
    assert!(
        session.font() != &directory,
        "the session keeps what it loaded"
    );
}

#[test]
fn a_replayed_change_set_leaves_the_font_as_the_session_that_made_it() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let layer_id = LayerId::from_raw(format!("composite0@{}", font.sources()[0].id()));
    let add = FontIntentSet::from(FontIntent::from(AddComponent {
        layer_id,
        component_id: ComponentId::from_raw("replayed"),
        base_glyph_id: GlyphId::from_raw("base1"),
    }));

    // Native applies the edit; the window's engine only ever sees its change set.
    let mut native = EngineSession::open_directory(placeholders(&font));
    let applied = native.apply(&mut persisted, &add).unwrap();
    let mut window = EngineSession::open_directory(placeholders(&font));
    window
        .replay(&mut persisted, applied.changes.clone())
        .unwrap();
    assert_eq!(window.font().layer(layer_id), native.font().layer(layer_id));

    // Undo replays the inverse, back to the font as it was.
    window
        .replay(&mut persisted, applied.changes.inverted())
        .unwrap();
    assert_eq!(window.font().layer(layer_id), font.layer(layer_id));
}

#[test]
fn an_edit_of_several_applies_persists_and_undoes_as_one_change_set() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let layer_id = LayerId::from_raw(format!("composite0@{}", font.sources()[0].id()));
    let mut window = EngineSession::open_directory(placeholders(&font));
    let mut native = EngineSession::open_directory(placeholders(&font));
    let mut history = EditHistory::default();

    // Two applies to the same layer, as one transaction.
    history.begin();
    for (index, base) in ["base1", "base2"].into_iter().enumerate() {
        let add = FontIntentSet::from(FontIntent::from(AddComponent {
            layer_id,
            component_id: ComponentId::from_raw(format!("added{index}")),
            base_glyph_id: GlyphId::from_raw(base),
        }));
        history.record(window.apply(&mut persisted, &add).unwrap().changes);
    }
    let edit = history
        .end(window.font())
        .unwrap()
        .expect("the edit changed the layer");

    // Native persists the one change set the window sends.
    native.replay(&mut persisted, edit).unwrap();
    assert_eq!(native.font().layer(layer_id), window.font().layer(layer_id));
    let edited = window.font().layer(layer_id).cloned();

    // Undo in the window, persisted the same way.
    let undone = history
        .undo(&mut window, &mut persisted)
        .unwrap()
        .expect("one edit to undo");
    native.replay(&mut persisted, undone.changes).unwrap();
    assert_eq!(window.font().layer(layer_id), font.layer(layer_id));
    assert_eq!(native.font().layer(layer_id), font.layer(layer_id));

    let redone = history
        .redo(&mut window, &mut persisted)
        .unwrap()
        .expect("one edit to redo");
    native.replay(&mut persisted, redone.changes).unwrap();
    assert_eq!(window.font().layer(layer_id).cloned(), edited);
    assert_eq!(native.font().layer(layer_id).cloned(), edited);
}

#[test]
fn the_history_knows_when_undo_and_redo_reach_the_saved_font() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let layer_id = LayerId::from_raw(format!("composite0@{}", font.sources()[0].id()));
    let mut session = EngineSession::open_directory(placeholders(&font));
    let mut history = EditHistory::default();
    let edit = |session: &mut EngineSession, history: &mut EditHistory, name: &str| {
        history.begin();
        let add = FontIntentSet::from(FontIntent::from(AddComponent {
            layer_id,
            component_id: ComponentId::from_raw(name),
            base_glyph_id: GlyphId::from_raw("base1"),
        }));
        let mut source = Persisted(font.clone());
        history.record(session.apply(&mut source, &add).unwrap().changes);
        history.end(session.font()).unwrap();
    };

    edit(&mut session, &mut history, "first");
    history.mark_saved();
    edit(&mut session, &mut history, "second");
    assert!(!history.matches_saved());

    history.undo(&mut session, &mut persisted).unwrap();
    assert!(history.matches_saved(), "undo landed on the save");
    history.undo(&mut session, &mut persisted).unwrap();
    assert!(!history.matches_saved());
    history.redo(&mut session, &mut persisted).unwrap();
    assert!(history.matches_saved(), "redo landed on the save");

    // Undo past the save, then edit: the saved font is no longer reachable.
    history.undo(&mut session, &mut persisted).unwrap();
    edit(&mut session, &mut history, "branch");
    history.undo(&mut session, &mut persisted).unwrap();
    assert!(!history.matches_saved());
}
