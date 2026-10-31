use shift_font::{GlyphId, NodeId, RunId, SourceId, TextItemId};

use super::*;
use shift_font::index_key;

fn page(id: &str, index: &str) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: None,
        index: index.into(),
        x: 0.0,
        y: 0.0,
        content: NodeContent::Page {
            name: id.into(),
            role: None,
        },
    }
}

fn run(id: &str, parent: &str, index: &str) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: Some(NodeId::from_raw(parent)),
        index: index.into(),
        x: 10.0,
        y: 20.0,
        content: NodeContent::TextRun {
            run_id: RunId::from_raw(id),
            size: 1000.0,
            items: Vec::new(),
        },
    }
}

fn glyph(id: &str, parent: &str, index: &str) -> SceneNode {
    SceneNode {
        id: NodeId::from_raw(id),
        parent_id: Some(NodeId::from_raw(parent)),
        index: index.into(),
        x: 0.0,
        y: 0.0,
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
            SceneIntent::CreateNode(page("second", "a1")),
            SceneIntent::CreateNode(page("first", "a0")),
            SceneIntent::CreateNode(run("run", "first", "a0")),
            SceneIntent::CreateNode(glyph("glyph", "run", "a0")),
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
            index: "a0".into(),
        }),
    ]);

    assert_eq!(cycle, Err(SceneError::Cycle(NodeId::from_raw("run"))));
    assert_eq!(scene, before);
    assert_eq!(
        scene.apply_intents(&[SceneIntent::CreateNode(SceneNode {
            parent_id: Some(NodeId::from_raw("second")),
            ..page("third", "a0")
        })]),
        Err(SceneError::PageWithParent(NodeId::from_raw("third")))
    );
    assert_eq!(
        scene.apply_intents(&[SceneIntent::UpdateNode(SceneNode {
            id: NodeId::from_raw("run"),
            ..page("x", "a0")
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
            ..run("run", "first", "a0")
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
            index: "a0".into(),
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
        .apply_intents(&[SceneIntent::CreateNode(page("first", "a0"))])
        .unwrap();

    let bytes = rmp_serde::to_vec_named(&changes).unwrap();
    let decoded: SceneChangeSet = rmp_serde::from_slice(&bytes).unwrap();

    assert_eq!(decoded, changes);
}

#[test]
fn a_new_page_takes_the_first_index_key() {
    assert_eq!(
        SceneNode::new_page(DEFAULT_PAGE_NAME).index,
        index_key::between(None, None).unwrap()
    );
}
