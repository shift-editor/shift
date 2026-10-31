use shift_font::{
    AddAnchors, AddComponent, CreateGlyph, CreateGlyphLayer, MoveAnchors, SetComponentAlignment,
    SetComponentTransforms,
};
use shift_font::{
    AnchorId, AnchorSeed, ComponentAlignment, ComponentId, FontIntent, FontIntentSet, GlyphId,
    LayerId, SourceId,
};
use shift_workspace::{FontWorkspace, NewWorkspace};

fn apply(workspace: &mut FontWorkspace, intents: Vec<FontIntent>) {
    workspace.apply(&FontIntentSet { intents }, None).unwrap();
}

/// Creates a glyph with one layer at `source_id` holding `anchors`.
fn glyph(
    workspace: &mut FontWorkspace,
    source_id: SourceId,
    name: &str,
    anchors: &[(&str, f64, f64)],
) -> (GlyphId, LayerId, Vec<AnchorId>) {
    apply(
        workspace,
        vec![
            CreateGlyph {
                glyph_id: None,
                name: name.to_string(),
                unicodes: Vec::new(),
            }
            .into(),
        ],
    );
    let glyph_id = workspace.font().glyph_id_by_name(name).unwrap();
    let layer_id = LayerId::new();
    let anchor_ids = anchors.iter().map(|_| AnchorId::new()).collect::<Vec<_>>();
    apply(
        workspace,
        vec![
            CreateGlyphLayer {
                layer_id,
                glyph_id,
                source_id,
            }
            .into(),
            AddAnchors {
                layer_id,
                anchors: anchors
                    .iter()
                    .zip(&anchor_ids)
                    .map(|(&(name, x, y), id)| AnchorSeed {
                        id: id.clone(),
                        name: Some(name.to_string()),
                        x,
                        y,
                    })
                    .collect(),
            }
            .into(),
        ],
    );
    (glyph_id, layer_id, anchor_ids)
}

/// Adds a component, placed on its anchors as adding one places it.
fn add_component(workspace: &mut FontWorkspace, layer_id: LayerId, base: GlyphId) -> ComponentId {
    let component_id = ComponentId::new();
    apply(
        workspace,
        vec![
            AddComponent {
                layer_id,
                component_id: component_id.clone(),
                base_glyph_id: base,
            }
            .into(),
        ],
    );
    component_id
}

fn translation(
    workspace: &FontWorkspace,
    layer_id: LayerId,
    component: &ComponentId,
) -> (f64, f64) {
    let transform = *workspace
        .font()
        .layer(layer_id)
        .unwrap()
        .component(component)
        .unwrap()
        .transform();
    (transform.translate_x, transform.translate_y)
}

struct Fixture {
    _temp: tempfile::TempDir,
    workspace: FontWorkspace,
    a_layer: LayerId,
    a_top: AnchorId,
    aacute: LayerId,
    acute: ComponentId,
    tilde: ComponentId,
    off_anchor: LayerId,
    off_acute: ComponentId,
}

/// `a`, an acute and a tilde that stack, `aacute` built on them, and a
/// composite whose acute was moved off its anchor by hand.
fn fixture() -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let mut workspace =
        FontWorkspace::create_untitled(temp.path().join("working.sqlite"), NewWorkspace::new())
            .unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let (a, a_layer, a_anchors) = glyph(&mut workspace, source_id, "a", &[("top", 250.0, 500.0)]);
    let (acutecomb, _, _) = glyph(
        &mut workspace,
        source_id,
        "acutecomb",
        &[("_top", 100.0, 500.0), ("top", 100.0, 700.0)],
    );
    let (tildecomb, _, _) = glyph(
        &mut workspace,
        source_id,
        "tildecomb",
        &[("_top", 120.0, 500.0), ("top", 120.0, 650.0)],
    );

    let (aacute_id, aacute, _) = glyph(&mut workspace, source_id, "aacutetilde", &[]);
    add_component(&mut workspace, aacute, a);
    let acute = add_component(&mut workspace, aacute, acutecomb);
    let tilde = add_component(&mut workspace, aacute, tildecomb);

    let (off_id, off_anchor, _) = glyph(&mut workspace, source_id, "aacute.off", &[]);
    add_component(&mut workspace, off_anchor, a);
    let off_acute = add_component(&mut workspace, off_anchor, acutecomb);
    apply(
        &mut workspace,
        vec![
            SetComponentTransforms {
                layer_id: off_anchor,
                component_ids: vec![off_acute.clone()],
                transforms: vec![160.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
            }
            .into(),
        ],
    );

    // The composites are not in memory when the base anchor moves.
    workspace.evict_glyphs(&[aacute_id, off_id]).unwrap();

    Fixture {
        _temp: temp,
        workspace,
        a_layer,
        a_top: a_anchors[0].clone(),
        aacute,
        acute,
        tilde,
        off_anchor,
        off_acute,
    }
}

#[test]
fn components_on_a_moved_anchor_follow_it_and_marks_stacked_on_them_too() {
    let mut f = fixture();

    apply(
        &mut f.workspace,
        vec![
            MoveAnchors {
                layer_id: f.a_layer,
                anchor_ids: vec![f.a_top.clone()],
                coords: vec![300.0, 520.0],
            }
            .into(),
        ],
    );

    assert_eq!(translation(&f.workspace, f.aacute, &f.acute), (200.0, 20.0));
    assert_eq!(
        translation(&f.workspace, f.aacute, &f.tilde),
        (180.0, 220.0)
    );
    // Placed by hand off its anchor: stays where it was put.
    assert_eq!(
        translation(&f.workspace, f.off_anchor, &f.off_acute),
        (160.0, 0.0)
    );
}

#[test]
fn undo_puts_followers_back_with_the_anchor() {
    let mut f = fixture();
    apply(
        &mut f.workspace,
        vec![
            MoveAnchors {
                layer_id: f.a_layer,
                anchor_ids: vec![f.a_top.clone()],
                coords: vec![300.0, 520.0],
            }
            .into(),
        ],
    );

    f.workspace.undo().unwrap();

    assert_eq!(translation(&f.workspace, f.aacute, &f.acute), (150.0, 0.0));
    assert_eq!(
        translation(&f.workspace, f.aacute, &f.tilde),
        (130.0, 200.0)
    );
}

#[test]
fn moving_an_attached_component_by_hand_detaches_it_and_carries_marks_stacked_on_it() {
    let mut f = fixture();
    apply(
        &mut f.workspace,
        vec![
            SetComponentTransforms {
                layer_id: f.aacute,
                component_ids: vec![f.acute.clone()],
                transforms: vec![170.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
            }
            .into(),
        ],
    );
    assert_eq!(translation(&f.workspace, f.aacute, &f.acute), (170.0, 0.0));
    assert_eq!(
        translation(&f.workspace, f.aacute, &f.tilde),
        (150.0, 200.0)
    );

    apply(
        &mut f.workspace,
        vec![
            MoveAnchors {
                layer_id: f.a_layer,
                anchor_ids: vec![f.a_top.clone()],
                coords: vec![300.0, 520.0],
            }
            .into(),
        ],
    );
    assert_eq!(translation(&f.workspace, f.aacute, &f.acute), (170.0, 0.0));
}

fn alignment(
    workspace: &FontWorkspace,
    layer_id: LayerId,
    component: &ComponentId,
) -> ComponentAlignment {
    workspace
        .font()
        .layer(layer_id)
        .unwrap()
        .component(component)
        .unwrap()
        .alignment()
}

fn move_a_top(f: &mut Fixture, x: f64, y: f64) {
    apply(
        &mut f.workspace,
        vec![
            MoveAnchors {
                layer_id: f.a_layer,
                anchor_ids: vec![f.a_top.clone()],
                coords: vec![x, y],
            }
            .into(),
        ],
    );
}

#[test]
fn adding_on_anchors_records_anchored_and_moving_by_hand_records_free() {
    let mut f = fixture();
    move_a_top(&mut f, 250.0, 500.0);
    assert_eq!(
        alignment(&f.workspace, f.aacute, &f.acute),
        ComponentAlignment::Anchored
    );
    assert_eq!(
        alignment(&f.workspace, f.off_anchor, &f.off_acute),
        ComponentAlignment::Free
    );
}

#[test]
fn anchoring_a_free_component_puts_it_back_on_its_anchors_and_it_follows_again() {
    let mut f = fixture();
    apply(
        &mut f.workspace,
        vec![
            SetComponentAlignment {
                layer_id: f.off_anchor,
                component_ids: vec![f.off_acute.clone()],
                alignment: ComponentAlignment::Anchored,
            }
            .into(),
        ],
    );
    assert_eq!(
        translation(&f.workspace, f.off_anchor, &f.off_acute),
        (150.0, 0.0)
    );

    move_a_top(&mut f, 300.0, 520.0);
    assert_eq!(
        translation(&f.workspace, f.off_anchor, &f.off_acute),
        (200.0, 20.0)
    );
}

#[test]
fn an_unrecorded_component_follows_while_it_sits_on_its_anchors_and_is_then_recorded() {
    let mut f = fixture();
    apply(
        &mut f.workspace,
        vec![
            SetComponentAlignment {
                layer_id: f.aacute,
                component_ids: vec![f.acute.clone(), f.tilde.clone()],
                alignment: ComponentAlignment::Unset,
            }
            .into(),
        ],
    );

    move_a_top(&mut f, 300.0, 520.0);

    assert_eq!(translation(&f.workspace, f.aacute, &f.acute), (200.0, 20.0));
    assert_eq!(
        translation(&f.workspace, f.aacute, &f.tilde),
        (180.0, 220.0)
    );
    assert_eq!(
        alignment(&f.workspace, f.aacute, &f.acute),
        ComponentAlignment::Anchored
    );
}
