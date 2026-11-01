use shift_font::{GlyphId, NodeId, RunId, SourceId, TextItemId};

use super::*;
use shift_font::index_key;
use shift_text::layout::{FeatureSetting, LayoutUnit, LineHeight, TextAlign, TextOptions};

/// The sibling key at `position`: ascending keys made one after another.
fn key(position: usize) -> String {
    let mut key = index_key::between(None, None).unwrap();
    for _ in 0..position {
        key = index_key::between(Some(&key), None).unwrap();
    }
    key
}

fn page(id: &str, position: usize) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: None,
        index: key(position),
        x: 0.0,
        y: 0.0,
        sizing: BoxSizing::default(),
        placement: Placement::Absolute,
        content: NodeContent::Page {
            name: id.into(),
            role: None,
        },
    }
}

fn run(id: &str, parent: &str, position: usize) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: Some(NodeId::from_raw(parent)),
        index: key(position),
        x: 10.0,
        y: 20.0,
        sizing: BoxSizing::default(),
        placement: Placement::Absolute,
        content: NodeContent::TextRun {
            run_id: RunId::from_raw(id),
            size: 1000.0,
            items: Vec::new(),
            settings: RunSettings::default(),
        },
    }
}

fn glyph(id: &str, parent: &str, position: usize) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: Some(NodeId::from_raw(parent)),
        index: key(position),
        x: 0.0,
        y: 0.0,
        sizing: BoxSizing::default(),
        placement: Placement::Absolute,
        content: NodeContent::Glyph {
            glyph_id: GlyphId::from_raw("a"),
            source_id: SourceId::from_raw("regular"),
            item_id: None,
        },
    }
}

fn ids(nodes: &[&SceneNode]) -> Vec<String> {
    nodes.iter().map(|node| node.id.to_string()).collect()
}

/// Two pages, the first with a run holding one glyph.
fn two_pages() -> Scene {
    let mut scene = Scene::default();
    scene
        .apply_intents(&[
            SceneIntent::CreateNode(page("second", 1)),
            SceneIntent::CreateNode(page("first", 0)),
            SceneIntent::CreateNode(run("run", "first", 0)),
            SceneIntent::CreateNode(glyph("glyph", "run", 0)),
        ])
        .unwrap();
    scene
}

#[test]
fn reads_list_pages_by_index_and_each_parent_before_its_children() {
    let scene = two_pages();

    assert_eq!(
        ids(&scene.pages().collect::<Vec<_>>()),
        ["node_first", "node_second"]
    );
    assert_eq!(
        ids(&scene.nodes()),
        ["node_first", "node_run", "node_glyph", "node_second"]
    );
    assert_eq!(
        ids(&scene.descendants(&NodeId::from_raw("first"))),
        ["node_run", "node_glyph"]
    );
    assert_eq!(
        scene
            .page_of(&NodeId::from_raw("glyph"))
            .map(|page| &page.id),
        Some(&NodeId::from_raw("first"))
    );
}

#[test]
fn deleting_a_node_removes_everything_under_it_and_undoes_whole() {
    let mut scene = two_pages();
    let before = scene.clone();

    let changes = scene
        .apply_intents(&[SceneIntent::DeleteNode(DeleteNode {
            id: NodeId::from_raw("first"),
        })])
        .unwrap();

    assert_eq!(ids(&scene.nodes()), ["node_second"]);
    assert_eq!(changes.changes.len(), 3);
    scene.apply_change_set(&changes.inverted()).unwrap();
    assert_eq!(scene, before);
    assert_eq!(
        ids(&scene.nodes()),
        ["node_first", "node_run", "node_glyph", "node_second"]
    );
}

#[test]
fn a_refused_intent_leaves_the_scene_unchanged() {
    let mut scene = two_pages();
    let before = scene.clone();
    let revisions = scene.revised_nodes();

    let cycle = scene.apply_intents(&[
        SceneIntent::SetRunItems(SetRunItems {
            id: NodeId::from_raw("run"),
            items: vec![TextItem::Linebreak {
                id: TextItemId::from_raw("break"),
            }],
        }),
        SceneIntent::MoveNode(MoveNode {
            id: NodeId::from_raw("run"),
            parent_id: Some(NodeId::from_raw("glyph")),
            index: key(0),
        }),
    ]);

    assert_eq!(cycle, Err(SceneError::Cycle(NodeId::from_raw("run"))));
    assert_eq!(scene, before);
    assert_eq!(scene.revised_nodes(), revisions);

    // A subtree deleted earlier in a refused batch comes back where it was.
    let deleted_then_refused = scene.apply_intents(&[
        SceneIntent::DeleteNode(DeleteNode {
            id: NodeId::from_raw("first"),
        }),
        SceneIntent::DeleteNode(DeleteNode {
            id: NodeId::from_raw("missing"),
        }),
    ]);
    assert_eq!(
        deleted_then_refused,
        Err(SceneError::NodeNotFound(NodeId::from_raw("missing")))
    );
    assert_eq!(scene.revised_nodes(), revisions);
    assert_eq!(
        ids(&scene.descendants(&NodeId::from_raw("first"))),
        ["node_run", "node_glyph"]
    );
    assert_eq!(
        scene.apply_intents(&[SceneIntent::CreateNode(SceneNode {
            parent_id: Some(NodeId::from_raw("second")),
            ..page("third", 0)
        })]),
        Err(SceneError::PageWithParent(NodeId::from_raw("third")))
    );
    assert_eq!(
        scene.apply_intents(&[SceneIntent::UpdateNode(SceneNode {
            id: NodeId::from_raw("run"),
            ..page("x", 0)
        })]),
        Err(SceneError::KindChanged {
            id: NodeId::from_raw("run"),
            expected: NodeKind::TextRun,
            found: NodeKind::Page,
        })
    );
}

#[test]
fn several_edits_to_one_node_coalesce_to_its_first_and_last_values() {
    let mut scene = two_pages();
    let moved = |x: f64| {
        SceneIntent::UpdateNode(SceneNode {
            x,
            ..run("run", "first", 0)
        })
    };
    let first = scene.apply_intents(&[moved(30.0)]).unwrap();
    let second = scene.apply_intents(&[moved(40.0)]).unwrap();
    let back = scene.apply_intents(&[moved(10.0)]).unwrap();

    let both = SceneChangeSet::coalesce([&first, &second]);
    let [change] = &*both.changes else {
        panic!("one node changed");
    };
    assert_eq!(change.node.before.as_ref().map(|node| node.x), Some(10.0));
    assert_eq!(change.node.after.as_ref().map(|node| node.x), Some(40.0));
    assert!(SceneChangeSet::coalesce([&first, &second, &back]).is_empty());
}

#[test]
fn a_replay_of_a_stale_change_is_refused() {
    let mut scene = two_pages();
    let moved = scene
        .apply_intents(&[SceneIntent::MoveNode(MoveNode {
            id: NodeId::from_raw("run"),
            parent_id: Some(NodeId::from_raw("second")),
            index: key(0),
        })])
        .unwrap();

    assert_eq!(
        scene.apply_change_set(&moved),
        Err(SceneError::ChangeOriginMismatch(NodeId::from_raw("run")))
    );
    assert_eq!(
        ids(&scene.descendants(&NodeId::from_raw("second"))),
        ["node_run", "node_glyph"]
    );
}

#[test]
fn a_change_set_round_trips_through_named_messagepack() {
    let mut scene = Scene::default();
    let changes = scene
        .apply_intents(&[SceneIntent::CreateNode(page("first", 0))])
        .unwrap();

    let bytes = rmp_serde::to_vec_named(&changes).unwrap();
    let decoded: SceneChangeSet = rmp_serde::from_slice(&bytes).unwrap();

    assert_eq!(decoded, changes);
}

#[test]
fn a_new_page_takes_the_first_index_key() {
    assert_eq!(
        SceneNode::new_page(DEFAULT_PAGE_NAME).unwrap().index,
        index_key::between(None, None).unwrap()
    );
}

#[test]
fn a_node_gets_a_new_revision_when_it_changes_and_a_run_keeps_its_items_revision_when_it_moves() {
    let mut scene = two_pages();
    let revision_of = |scene: &Scene, id: &str| {
        scene
            .revised_nodes()
            .into_iter()
            .find(|revised| revised.node.id == NodeId::from_raw(id))
            .map(|revised| (revised.revision, revised.items_revision))
            .unwrap()
    };
    let (revision, items) = revision_of(&scene, "run");
    let untouched = revision_of(&scene, "second");

    scene
        .apply_intents(&[SceneIntent::UpdateNode(SceneNode {
            x: 99.0,
            ..run("run", "first", 0)
        })])
        .unwrap();
    let (moved, moved_items) = revision_of(&scene, "run");
    scene
        .apply_intents(&[SceneIntent::SetRunItems(SetRunItems {
            id: NodeId::from_raw("run"),
            items: Vec::new(),
        })])
        .unwrap();

    assert_ne!(moved, revision);
    assert_eq!(moved_items, items);
    assert_ne!(revision_of(&scene, "run").1, items);
    assert_eq!(revision_of(&scene, "second"), untouched);
}

#[test]
fn an_update_never_changes_a_runs_items() {
    let mut scene = two_pages();
    scene
        .apply_intents(&[SceneIntent::SetRunItems(SetRunItems {
            id: NodeId::from_raw("run"),
            items: vec![TextItem::Linebreak {
                id: TextItemId::from_raw("break"),
            }],
        })])
        .unwrap();

    scene
        .apply_intents(&[SceneIntent::UpdateNode(run("run", "first", 0))])
        .unwrap();

    let Some(NodeContent::TextRun { items, .. }) = scene
        .node(&NodeId::from_raw("run"))
        .map(|node| &node.content)
    else {
        panic!("the run is still a run");
    };
    assert_eq!(items.len(), 1);
}

#[test]
fn a_run_stored_without_settings_reads_them_at_their_defaults() {
    /// A text run node as stored before runs had settings.
    #[derive(serde::Serialize)]
    enum OldContent {
        TextRun {
            run_id: RunId,
            size: f64,
            items: Vec<TextItem>,
        },
    }
    #[derive(serde::Serialize)]
    struct OldNode {
        id: NodeId,
        parent_id: Option<NodeId>,
        index: String,
        x: f64,
        y: f64,
        content: OldContent,
    }
    let old = OldNode {
        id: NodeId::from_raw("run_node"),
        parent_id: None,
        index: "a0".to_string(),
        x: 0.0,
        y: 0.0,
        content: OldContent::TextRun {
            run_id: RunId::from_raw("run"),
            size: 1000.0,
            items: Vec::new(),
        },
    };

    let stored = rmp_serde::to_vec_named(&old).unwrap();
    let node: SceneNode = rmp_serde::from_slice(&stored).unwrap();

    let NodeContent::TextRun { settings, .. } = node.content else {
        panic!("expected a text run");
    };
    assert_eq!(settings, RunSettings::default());
    assert!(settings.shaping);
}

#[test]
fn a_node_stored_before_frames_hugs_and_keeps_its_position() {
    /// A page node as stored before nodes had sizing and placement.
    #[derive(serde::Serialize)]
    enum OldContent {
        Page {
            name: String,
            role: Option<PageRole>,
        },
    }
    #[derive(serde::Serialize)]
    struct OldNode {
        id: NodeId,
        parent_id: Option<NodeId>,
        index: String,
        x: f64,
        y: f64,
        content: OldContent,
    }
    let old = OldNode {
        id: NodeId::from_raw("page"),
        parent_id: None,
        index: "a0".to_string(),
        x: 30.0,
        y: 40.0,
        content: OldContent::Page {
            name: "Page".to_string(),
            role: None,
        },
    };

    let stored = rmp_serde::to_vec_named(&old).unwrap();
    let node: SceneNode = rmp_serde::from_slice(&stored).unwrap();

    assert_eq!(node.sizing, BoxSizing::new(Sizing::Hug, Sizing::Hug));
    assert_eq!(node.placement, Placement::Absolute);
    assert_eq!((node.x, node.y), (30.0, 40.0));
}

#[test]
fn a_frame_keeps_its_layout_through_storage_and_an_update() {
    let frame = SceneNode {
        id: NodeId::from_raw("frame"),
        parent_id: Some(NodeId::from_raw("page")),
        sizing: BoxSizing::new(Sizing::Fixed(300.0), Sizing::Fill),
        placement: Placement::Auto,
        content: NodeContent::Frame {
            direction: LayoutDirection::Column,
            gap: 8.0,
            padding: Insets::uniform(16.0),
            align: Align::End,
            justify: Justify::Center,
            wrap: false,
        },
        ..page("frame", 0)
    };
    let stored = rmp_serde::to_vec_named(&frame).unwrap();
    assert_eq!(rmp_serde::from_slice::<SceneNode>(&stored).unwrap(), frame);
    assert_eq!(frame.kind(), NodeKind::Frame);
    assert_eq!(
        frame
            .frame_layout()
            .map(|layout| (layout.direction, layout.gap)),
        Some((LayoutDirection::Column, 8.0))
    );

    let mut scene = Scene::default();
    scene
        .apply_intents(&[
            SceneIntent::CreateNode(page("page", 0)),
            SceneIntent::CreateNode(frame.clone()),
        ])
        .unwrap();
    let rowed = SceneNode {
        content: NodeContent::Frame {
            direction: LayoutDirection::Row,
            gap: 4.0,
            padding: Insets::ZERO,
            align: Align::Start,
            justify: Justify::Start,
            wrap: true,
        },
        sizing: BoxSizing::default(),
        ..frame
    };
    scene
        .apply_intents(&[SceneIntent::UpdateNode(rowed.clone())])
        .unwrap();

    assert_eq!(scene.node(&rowed.id), Some(&rowed));
}

#[test]
fn a_frame_is_placed_only_in_a_page_or_a_frame() {
    let frame = |id: &str, parent: &str| SceneNode {
        id: NodeId::from_raw(id),
        parent_id: Some(NodeId::from_raw(parent)),
        content: NodeContent::Frame {
            direction: LayoutDirection::Row,
            gap: 0.0,
            padding: Insets::ZERO,
            align: Align::Start,
            justify: Justify::Start,
            wrap: false,
        },
        ..page(id, 0)
    };
    let mut scene = Scene::default();
    scene
        .apply_intents(&[
            SceneIntent::CreateNode(page("page", 0)),
            SceneIntent::CreateNode(run("run", "page", 0)),
            SceneIntent::CreateNode(frame("outer", "page")),
            SceneIntent::CreateNode(frame("inner", "outer")),
        ])
        .unwrap();

    let in_a_run = scene.apply_intents(&[SceneIntent::CreateNode(frame("stray", "run"))]);
    let moved_into_a_run = scene.apply_intents(&[SceneIntent::MoveNode(MoveNode {
        id: NodeId::from_raw("inner"),
        parent_id: Some(NodeId::from_raw("run")),
        index: key(0),
    })]);

    assert_eq!(
        in_a_run,
        Err(SceneError::FrameInLeaf {
            node: NodeId::from_raw("stray"),
            parent: NodeId::from_raw("run"),
            kind: NodeKind::TextRun,
        })
    );
    assert_eq!(
        moved_into_a_run,
        Err(SceneError::FrameInLeaf {
            node: NodeId::from_raw("inner"),
            parent: NodeId::from_raw("run"),
            kind: NodeKind::TextRun,
        })
    );
    assert_eq!(
        scene
            .node(&NodeId::from_raw("inner"))
            .and_then(|node| node.parent_id.clone()),
        Some(NodeId::from_raw("outer"))
    );
}

#[test]
fn setting_a_run_s_settings_keeps_its_items_and_an_update_keeps_both() {
    let mut scene = Scene::default();
    scene
        .apply_intents(&[
            SceneIntent::CreateNode(page("page", 0)),
            SceneIntent::CreateNode(run("run", "page", 0)),
        ])
        .unwrap();

    scene
        .apply_intents(&[SceneIntent::SetRunSettings(SetRunSettings {
            id: NodeId::from_raw("run"),
            settings: RunSettings {
                shaping: false,
                ..RunSettings::default()
            },
        })])
        .unwrap();
    scene
        .apply_intents(&[SceneIntent::UpdateNode(run("run", "page", 0))])
        .unwrap();

    let Some(NodeContent::TextRun { settings, .. }) = scene
        .node(&NodeId::from_raw("run"))
        .map(|node| node.content.clone())
    else {
        panic!("expected the run");
    };
    assert!(!settings.shaping);
}

#[test]
fn a_run_created_without_settings_gets_their_defaults() {
    let mut scene = Scene::default();
    let page = page("page", 0);
    scene
        .apply_intents(&[
            SceneIntent::CreateNode(page),
            SceneIntent::CreateRun(CreateRun {
                id: NodeId::from_raw("run"),
                parent_id: Some(NodeId::from_raw("page")),
                index: key(0),
                x: 0.0,
                y: 0.0,
                run_id: RunId::from_raw("run"),
                size: 1000.0,
                items: Vec::new(),
            }),
        ])
        .unwrap();

    let Some(NodeContent::TextRun { settings, .. }) = scene
        .node(&NodeId::from_raw("run"))
        .map(|node| node.content.clone())
    else {
        panic!("expected the run");
    };
    assert_eq!(settings, RunSettings::default());
}

#[test]
fn a_run_s_settings_become_its_layout_options() {
    let settings = RunSettings {
        shaping: false,
        features: [("liga".to_string(), false), ("ss01".to_string(), true)].into(),
        language: Some("tr".into()),
        script: Some("Latn".into()),
        line_height: Some(1.5),
        align: Some(TextAlign::Center),
    };

    let options = settings.text_options();

    assert_eq!(
        options,
        TextOptions {
            language: Some("tr".into()),
            script: Some("Latn".into()),
            features: vec![
                FeatureSetting {
                    tag: "liga".into(),
                    value: 0
                },
                FeatureSetting {
                    tag: "ss01".into(),
                    value: 1
                },
            ],
            shaping: false,
            align: Some(TextAlign::Center),
            line_height: LineHeight::Em { em: 1.5 },
            width: None,
        }
    );
}

#[test]
fn a_run_with_default_settings_lays_out_shaped_at_the_font_s_line_spacing() {
    let options = RunSettings::default().text_options();

    assert!(options.shaping);
    assert!(options.features.is_empty());
    assert_eq!(options.line_height, LineHeight::Auto);
    assert_eq!(options.align, None);
}

#[test]
fn a_run_lays_out_one_unit_per_item() {
    let glyph = GlyphId::from_raw("a.alt");
    let run = TextRun {
        items: vec![
            TextItem::Character {
                id: TextItemId::from_raw("a"),
                codepoint: 0x61,
            },
            TextItem::Linebreak {
                id: TextItemId::from_raw("break"),
            },
            TextItem::Glyph {
                id: TextItemId::from_raw("alt"),
                glyph_id: glyph,
            },
        ],
        settings: RunSettings::default(),
    };

    assert_eq!(
        run.layout_request().units,
        [
            LayoutUnit::Character { codepoint: 0x61 },
            LayoutUnit::LineBreak,
            LayoutUnit::Glyph { glyph_id: glyph },
        ]
    );
}

#[test]
fn refuses_run_settings_shaping_cannot_read() {
    let mut scene = Scene::default();
    scene
        .apply_intents(&[
            SceneIntent::CreateNode(page("page", 0)),
            SceneIntent::CreateNode(run("run", "page", 0)),
        ])
        .unwrap();
    let set = |settings: RunSettings| {
        scene
            .clone()
            .apply_intents(&[SceneIntent::SetRunSettings(SetRunSettings {
                id: NodeId::from_raw("run"),
                settings,
            })])
    };

    let tag = RunSettings {
        features: [("liga!x".to_owned(), false)].into(),
        ..RunSettings::default()
    };
    let language = RunSettings {
        language: Some("not a language".to_owned()),
        ..RunSettings::default()
    };
    let script = RunSettings {
        script: Some("Ara".to_owned()),
        ..RunSettings::default()
    };
    let line_height = RunSettings {
        line_height: Some(0.0),
        ..RunSettings::default()
    };
    let fine = RunSettings {
        features: [("liga".to_owned(), false), ("ss01".to_owned(), true)].into(),
        language: Some("sr-Latn".to_owned()),
        script: Some("Arab".to_owned()),
        line_height: Some(1.5),
        ..RunSettings::default()
    };

    assert!(matches!(
        set(tag),
        Err(SceneError::RunSettings {
            source: RunSettingsError::FeatureTag(_),
            ..
        })
    ));
    assert!(matches!(
        set(language),
        Err(SceneError::RunSettings {
            source: RunSettingsError::Language(_),
            ..
        })
    ));
    assert!(matches!(
        set(script),
        Err(SceneError::RunSettings {
            source: RunSettingsError::Script(_),
            ..
        })
    ));
    assert!(matches!(
        set(line_height),
        Err(SceneError::RunSettings {
            source: RunSettingsError::LineHeight(_),
            ..
        })
    ));
    assert!(set(fine).is_ok());
}
