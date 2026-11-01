//! A session over a partly loaded font edits exactly as a fully loaded font
//! does: it loads what each edit reads before applying it.

use std::collections::BTreeSet;
use std::convert::Infallible;

use proptest::prelude::*;
use shift_engine::{EditHistory, EngineSession, LayerSource, RecordCache, RecordSource, Recording};
use shift_font::test_support::sample_font;
use shift_font::{
    AddComponent, Anchor, AnchorId, Component, ComponentId, CreateGlyph, DecomposeComponents,
    DecomposedTransform, Font, FontIntent, FontIntentSet, Glyph, GlyphCategory, GlyphDataCategory,
    GlyphId, GlyphLayer, GlyphName, GlyphSubcategory, LayerId, MoveAnchors, MovePoints, NamedGlyph,
    OpenTypeCategory, RemoveAnchors, SourceId, UpdateGlyph, contour,
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

    fn bases_of(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, Infallible> {
        let mut pending: Vec<GlyphId> = glyph_ids
            .iter()
            .filter_map(|glyph_id| self.0.glyph(*glyph_id))
            .flat_map(|glyph| glyph.layers().values().flat_map(|layer| bases(layer)))
            .collect();
        let mut closure = BTreeSet::new();
        while let Some(glyph_id) = pending.pop() {
            if !closure.insert(glyph_id) {
                continue;
            }
            if let Some(glyph) = self.0.glyph(glyph_id) {
                pending.extend(glyph.layers().values().flat_map(|layer| bases(layer)));
            }
        }
        Ok(closure
            .into_iter()
            .filter(|glyph_id| !glyph_ids.contains(glyph_id))
            .collect())
    }

    fn composites_of(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, Infallible> {
        let targets: BTreeSet<GlyphId> = glyph_ids.iter().copied().collect();
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

impl RecordSource for Persisted {
    type Error = Infallible;

    fn component_bases(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<Vec<GlyphId>>, Infallible> {
        Ok(glyph_ids
            .iter()
            .map(|glyph_id| {
                let bases: BTreeSet<GlyphId> = self
                    .0
                    .glyph(*glyph_id)
                    .into_iter()
                    .flat_map(Glyph::component_glyph_ids)
                    .collect();
                bases.into_iter().collect()
            })
            .collect())
    }

    /// Glyph data that knows only that `mark…` glyphs are nonspacing marks.
    fn glyph_data_categories(
        &mut self,
        glyphs: &[NamedGlyph],
    ) -> Result<Vec<GlyphDataCategory>, Infallible> {
        Ok(glyphs
            .iter()
            .map(|glyph| match glyph.name.as_str().starts_with("mark") {
                true => GlyphDataCategory {
                    category: Some(GlyphCategory::Mark),
                    sub_category: Some(GlyphSubcategory::Nonspacing),
                },
                false => GlyphDataCategory::default(),
            })
            .collect())
    }

    fn attaching_anchor_layers(
        &mut self,
        layer_ids: &[LayerId],
    ) -> Result<Vec<LayerId>, Infallible> {
        Ok(layer_ids
            .iter()
            .copied()
            .filter(|layer_id| {
                self.0
                    .layer(*layer_id)
                    .is_some_and(|layer| layer.anchors().iter().any(Anchor::attaches_marks))
            })
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
    history.begin(None);
    for (index, base) in ["base1", "base2"].into_iter().enumerate() {
        let add = FontIntentSet::from(FontIntent::from(AddComponent {
            layer_id,
            component_id: ComponentId::from_raw(format!("added{index}")),
            base_glyph_id: GlyphId::from_raw(base),
        }));
        history.record(window.apply(&mut persisted, &add).unwrap().changes);
    }
    let edit = history
        .end(window.font(), window.scene(), Recording::Undoable)
        .unwrap()
        .expect("the edit changed the layer");

    // Native persists the one change set the window sends.
    native.replay(&mut persisted, edit.font).unwrap();
    assert_eq!(native.font().layer(layer_id), window.font().layer(layer_id));
    let edited = window.font().layer(layer_id).cloned();

    // Undo in the window, persisted the same way.
    let undone = history
        .undo(&mut window, &mut persisted)
        .unwrap()
        .expect("one edit to undo");
    native
        .replay(&mut persisted, undone.applied.changes)
        .unwrap();
    assert_eq!(window.font().layer(layer_id), font.layer(layer_id));
    assert_eq!(native.font().layer(layer_id), font.layer(layer_id));

    let redone = history
        .redo(&mut window, &mut persisted)
        .unwrap()
        .expect("one edit to redo");
    native
        .replay(&mut persisted, redone.applied.changes)
        .unwrap();
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
        history.begin(None);
        let add = FontIntentSet::from(FontIntent::from(AddComponent {
            layer_id,
            component_id: ComponentId::from_raw(name),
            base_glyph_id: GlyphId::from_raw("base1"),
        }));
        let mut source = Persisted(font.clone());
        history.record(session.apply(&mut source, &add).unwrap().changes);
        history
            .end(session.font(), session.scene(), Recording::Undoable)
            .unwrap();
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

#[test]
fn a_partly_loaded_session_lists_the_records_a_loaded_font_would() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    session
        .load_glyphs(&mut persisted, &[GlyphId::from_raw("composite0")])
        .unwrap();
    let loaded = EngineSession::open_loaded(font);

    let records = session.glyph_records(&mut persisted).unwrap();

    assert_eq!(records, loaded.glyph_records(&mut persisted).unwrap());
    let record = |name: &str| {
        records
            .iter()
            .find(|record| record.name.as_str() == name)
            .unwrap()
    };
    assert_eq!(
        record("composite1").component_base_glyph_ids,
        [GlyphId::from_raw("base1"), GlyphId::from_raw("mark1")]
    );
    assert!(record("mark0").nonspacing_mark);
    assert!(!record("base0").mark);
}

#[test]
fn a_rename_changes_the_glyphs_record_in_the_edit_that_made_it() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let mark = GlyphId::from_raw("mark0");
    let rename = FontIntentSet::from(FontIntent::from(UpdateGlyph {
        glyph_id: mark,
        new_name: GlyphName::from("dot"),
        new_unicodes: vec![0x2e],
    }));

    let applied = session.apply(&mut persisted, &rename).unwrap();
    let changes = session
        .glyph_record_changes(&mut persisted, &applied.changes)
        .unwrap();

    let [record] = &*changes.updated else {
        panic!("the rename changes one record");
    };
    assert_eq!((record.id, record.name.as_str()), (mark, "dot"));
    assert_eq!(record.unicodes, [0x2e]);
    assert!(!record.mark, "glyph data no longer calls it a mark");
    assert!(changes.removed.is_empty());
}

/// The glyphs' names, in the records' order.
fn record_names(records: &[shift_font::GlyphRecord]) -> Vec<&str> {
    records.iter().map(|record| record.name.as_str()).collect()
}

#[test]
fn glyph_records_and_the_glyph_order_follow_an_add_a_rename_and_a_remove() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let mut history = EditHistory::default();
    let added = GlyphId::from_raw("added");
    let create = FontIntentSet::from(FontIntent::from(CreateGlyph {
        glyph_id: Some(added),
        name: "0first".to_string(),
        unicodes: Vec::new(),
    }));
    let rename = FontIntentSet::from(FontIntent::from(UpdateGlyph {
        glyph_id: added,
        new_name: GlyphName::from("zzz"),
        new_unicodes: Vec::new(),
    }));
    let order_of = |session: &EngineSession| -> Vec<GlyphId> {
        let mut glyphs: Vec<&Glyph> = session.font().glyphs().collect();
        glyphs.sort_by(|a, b| a.name().cmp(b.name()));
        glyphs.into_iter().map(Glyph::id).collect()
    };

    history.begin(None);
    let created = session.apply(&mut persisted, &create).unwrap();
    let created_changes = session
        .glyph_record_changes(&mut persisted, &created.changes)
        .unwrap();
    history.record(created.changes);
    history
        .end(session.font(), session.scene(), Recording::Undoable)
        .unwrap();
    assert_eq!(created_changes.order, Some(order_of(&session)));
    assert_eq!(created_changes.order.as_ref().unwrap()[0], added);
    let records = session.glyph_records(&mut persisted).unwrap();
    assert_eq!(record_names(&records)[0], "0first");

    history.begin(None);
    let renamed = session.apply(&mut persisted, &rename).unwrap();
    let renamed_changes = session
        .glyph_record_changes(&mut persisted, &renamed.changes)
        .unwrap();
    history.record(renamed.changes);
    history
        .end(session.font(), session.scene(), Recording::Undoable)
        .unwrap();
    assert_eq!(renamed_changes.order, Some(order_of(&session)));
    assert_eq!(renamed_changes.order.as_ref().unwrap().last(), Some(&added));
    let records = session.glyph_records(&mut persisted).unwrap();
    assert_eq!(record_names(&records).last(), Some(&"zzz"));

    history.undo(&mut session, &mut persisted).unwrap();
    let removed = history.undo(&mut session, &mut persisted).unwrap().unwrap();
    let removed_changes = session
        .glyph_record_changes(&mut persisted, &removed.applied.changes)
        .unwrap();
    assert_eq!(removed_changes.removed, [added]);
    assert_eq!(removed_changes.order, Some(order_of(&session)));
    let records = session.glyph_records(&mut persisted).unwrap();
    assert!(!records.iter().any(|record| record.id == added));
    let mut sorted = record_names(&records);
    sorted.sort_unstable();
    assert_eq!(record_names(&records), sorted);
}

#[test]
fn an_edit_that_keeps_the_glyph_order_sends_none() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let recode = FontIntentSet::from(FontIntent::from(UpdateGlyph {
        glyph_id: GlyphId::from_raw("mark0"),
        new_name: GlyphName::from("mark0"),
        new_unicodes: vec![0x301],
    }));

    let applied = session.apply(&mut persisted, &recode).unwrap();
    let changes = session
        .glyph_record_changes(&mut persisted, &applied.changes)
        .unwrap();

    assert_eq!(record_names(&changes.updated), ["mark0"]);
    assert_eq!(changes.order, None);
}

#[test]
fn a_partly_loaded_session_reads_the_shaper_font_source_a_loaded_font_would() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    session
        .load_glyphs(&mut persisted, &[GlyphId::from_raw("base1")])
        .unwrap();
    let loaded = EngineSession::open_loaded(font);

    let source = session.shaper_font_source(&mut persisted).unwrap();

    assert_eq!(source, loaded.shaper_font_source(&mut persisted).unwrap());
    let class = |name: &str| {
        source
            .glyphs
            .iter()
            .find(|glyph| glyph.name.as_str() == name)
            .unwrap()
            .gdef_class
    };
    assert_eq!(class("base0"), Some(OpenTypeCategory::Base));
    assert_eq!(class("base1"), Some(OpenTypeCategory::Base));
    assert_eq!(class("mark0"), Some(OpenTypeCategory::Mark));
    assert_eq!(class("composite0"), None);
}

#[test]
fn an_unsaved_anchor_removal_unclasses_a_base_in_the_shaper_font_source() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let removals: FontIntentSet = font
        .glyph(GlyphId::from_raw("base0"))
        .unwrap()
        .layers()
        .values()
        .map(|layer| {
            RemoveAnchors {
                layer_id: layer.id(),
                anchor_ids: layer.anchors_iter().map(Anchor::id).collect(),
            }
            .into()
        })
        .collect();

    session.apply(&mut persisted, &removals).unwrap();
    let source = session.shaper_font_source(&mut persisted).unwrap();

    let base0 = source
        .glyphs
        .iter()
        .find(|glyph| glyph.name.as_str() == "base0")
        .unwrap();
    assert_eq!(base0.gdef_class, None);
}

#[test]
fn an_outline_edit_leaves_the_shaper_font_source_unchanged_and_a_rename_changes_it() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let before = session.shaper_font_source(&mut persisted).unwrap();
    let base = GlyphId::from_raw("base0");
    let layer = font.glyph(base).unwrap().layers().values().next().unwrap();
    let point = layer.contours_iter().next().unwrap().points()[0].clone();
    let outline = FontIntentSet::from(FontIntent::from(MovePoints {
        layer_id: layer.id(),
        point_ids: vec![point.id()],
        coords: vec![point.x() + 10.0, point.y()],
    }));

    session.apply(&mut persisted, &outline).unwrap();
    assert_eq!(session.shaper_font_source(&mut persisted).unwrap(), before);

    let rename = FontIntentSet::from(FontIntent::from(UpdateGlyph {
        glyph_id: base,
        new_name: GlyphName::from("base0.alt"),
        new_unicodes: Vec::new(),
    }));
    session.apply(&mut persisted, &rename).unwrap();
    assert_ne!(session.shaper_font_source(&mut persisted).unwrap(), before);
}

/// Counts what a [`RecordSource`] is asked, around [`Persisted`].
struct Counted<'a> {
    inner: &'a mut Persisted,
    categories: usize,
    attaching: usize,
}

impl RecordSource for Counted<'_> {
    type Error = Infallible;

    fn component_bases(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<Vec<GlyphId>>, Infallible> {
        self.inner.component_bases(glyph_ids)
    }

    fn glyph_data_categories(
        &mut self,
        glyphs: &[NamedGlyph],
    ) -> Result<Vec<GlyphDataCategory>, Infallible> {
        self.categories += glyphs.len();
        self.inner.glyph_data_categories(glyphs)
    }

    fn attaching_anchor_layers(
        &mut self,
        layer_ids: &[LayerId],
    ) -> Result<Vec<LayerId>, Infallible> {
        self.attaching += layer_ids.len();
        self.inner.attaching_anchor_layers(layer_ids)
    }
}

#[test]
fn a_record_cache_asks_the_store_again_only_for_glyphs_whose_name_or_codepoints_changed() {
    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let mut session = EngineSession::open_directory(placeholders(&font));
    let uncached = session.shaper_font_source(&mut persisted).unwrap();
    let mut cache = RecordCache::default();
    let mut counted = Counted {
        inner: &mut persisted,
        categories: 0,
        attaching: 0,
    };

    let first = session
        .shaper_font_source(&mut cache.reading(&mut counted))
        .unwrap();
    let asked = (counted.categories, counted.attaching);
    let again = session
        .shaper_font_source(&mut cache.reading(&mut counted))
        .unwrap();

    assert_eq!(first, uncached);
    assert_eq!(again, first);
    assert!(asked.0 > 0 && asked.1 > 0);
    assert_eq!((counted.categories, counted.attaching), asked);

    let rename = FontIntentSet::from(FontIntent::from(UpdateGlyph {
        glyph_id: GlyphId::from_raw("base0"),
        new_name: GlyphName::from("mark9"),
        new_unicodes: Vec::new(),
    }));
    session.apply(counted.inner, &rename).unwrap();
    let renamed = session
        .shaper_font_source(&mut cache.reading(&mut counted))
        .unwrap();

    assert_eq!(counted.categories, asked.0 + 1);
    assert_eq!(renamed, session.shaper_font_source(counted.inner).unwrap());
}

/// A page with `id`, at the top of the scene.
fn scene_page(id: &str) -> shift_engine::scene::SceneNode {
    shift_engine::scene::SceneNode {
        id: shift_font::NodeId::from_raw(id),
        parent_id: None,
        index: "a0".into(),
        x: 0.0,
        y: 0.0,
        content: shift_engine::scene::NodeContent::Page {
            name: id.into(),
            role: None,
        },
    }
}

#[test]
fn scene_and_font_edits_share_one_history_and_undo_in_order() {
    use shift_engine::scene::{NodeContent, SceneIntent, SceneNode};
    use shift_font::{NodeId, RunId};

    let font = composite_font();
    let mut persisted = Persisted(font.clone());
    let layer_id = LayerId::from_raw(format!("composite0@{}", font.sources()[0].id()));
    let mut session = EngineSession::open_directory(placeholders(&font));
    let mut history = EditHistory::default();
    let page = NodeId::from_raw("page");
    let run = NodeId::from_raw("run");

    // The page, made with nothing shown: the entry is located on the page it made.
    history.begin(None);
    history.record_scene(
        session
            .apply_scene(&[SceneIntent::CreateNode(scene_page("page"))])
            .unwrap(),
    );
    history
        .end(session.font(), session.scene(), Recording::Undoable)
        .unwrap();
    history.mark_saved();

    // A run placed on the page, then a font edit made while it is shown.
    history.begin(Some(page.clone()));
    history.record_scene(
        session
            .apply_scene(&[SceneIntent::CreateNode(SceneNode {
                id: run.clone(),
                parent_id: Some(page.clone()),
                index: "a0".into(),
                x: 0.0,
                y: 0.0,
                content: NodeContent::TextRun {
                    run_id: RunId::from_raw("run"),
                    size: 1000.0,
                    items: Vec::new(),
                },
            })])
            .unwrap(),
    );
    history
        .end(session.font(), session.scene(), Recording::Undoable)
        .unwrap();
    assert!(
        !history.matches_saved(),
        "a scene edit leaves the document unsaved"
    );

    history.begin(Some(page.clone()));
    let add = FontIntentSet::from(FontIntent::from(AddComponent {
        layer_id,
        component_id: ComponentId::from_raw("added"),
        base_glyph_id: GlyphId::from_raw("base1"),
    }));
    history.record(session.apply(&mut persisted, &add).unwrap().changes);
    history
        .end(session.font(), session.scene(), Recording::Undoable)
        .unwrap();

    let font_undo = history
        .undo(&mut session, &mut persisted)
        .unwrap()
        .expect("the font edit undoes first");
    assert_eq!(font_undo.location.page_id, Some(page.clone()));
    assert_eq!(
        font_undo.location.glyph_ids,
        [GlyphId::from_raw("composite0")]
    );
    assert!(font_undo.location.node_ids.is_empty());
    assert!(session.scene().node(&run).is_some());
    assert_eq!(session.font().layer(layer_id), font.layer(layer_id));

    let scene_undo = history
        .undo(&mut session, &mut persisted)
        .unwrap()
        .expect("then the run");
    assert_eq!(scene_undo.location.page_id, Some(page.clone()));
    assert_eq!(scene_undo.location.node_ids, std::slice::from_ref(&run));
    assert!(scene_undo.location.glyph_ids.is_empty());
    assert!(session.scene().node(&run).is_none());
    assert!(history.matches_saved(), "undo landed on the save");

    let first = history.latest().expect("the page's own entry");
    assert_eq!(first.location.page_id, Some(page.clone()));
    assert_eq!(first.location.node_ids, [page]);

    history.redo(&mut session, &mut persisted).unwrap();
    assert!(session.scene().node(&run).is_some());
}

#[test]
fn an_unrecorded_scene_edit_is_kept_but_never_reaches_the_saved_position() {
    use shift_engine::scene::SceneIntent;

    let font = composite_font();
    let mut session = EngineSession::open_directory(placeholders(&font));
    let mut history = EditHistory::default();
    history.mark_saved();

    history.begin(None);
    history.record_scene(
        session
            .apply_scene(&[SceneIntent::CreateNode(scene_page("page"))])
            .unwrap(),
    );
    let kept = history
        .end(session.font(), session.scene(), Recording::Unrecorded)
        .unwrap();

    assert!(kept.is_some_and(|change_set| !change_set.scene.is_empty()));
    assert!(history.latest().is_none(), "no undo step");
    assert!(!history.matches_saved());
}
