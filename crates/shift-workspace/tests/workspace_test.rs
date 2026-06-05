use std::path::PathBuf;

use shift_font::PointType;
use shift_store::GlyphId as StoreGlyphId;
use shift_workspace::{
    FontWorkspace, GlyphLayerTarget, NewWorkspace, WorkspaceError, WorkspaceSource,
};

#[test]
fn creates_workspace_with_source_package_and_working_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::create(
        &source_path,
        &store_path,
        NewWorkspace::with_family_name("Test Font"),
    )
    .unwrap();

    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Package {
            path: source_path.clone()
        }
    );
    assert_eq!(workspace.save_target(), Some(source_path.as_path()));
    assert!(source_path.join("manifest.json").is_file());
    assert_eq!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .as_deref(),
        Some("Test Font")
    );
    assert!(workspace.font().glyphs().is_empty());
}

#[test]
fn opens_existing_workspace_paths() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    FontWorkspace::create(&source_path, &store_path, NewWorkspace::new()).unwrap();

    let workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    assert_eq!(workspace.save_target(), Some(source_path.as_path()));
    assert!(workspace.font_info().unwrap().is_some());
}

#[test]
fn imports_external_fonts_without_a_save_target() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Imported {
            original_path: source_path
        }
    );
    assert_eq!(workspace.save_target(), None);
    assert!(!workspace.font().glyphs().is_empty());
    assert!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .is_some()
    );
}

#[test]
fn save_requires_save_as_for_imported_fonts() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("working.sqlite");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::NeedsSaveAs));
}

#[test]
fn save_as_assigns_a_shift_package_save_target() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    workspace.save_as(&save_path).unwrap();

    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Package {
            path: save_path.clone()
        }
    );
    assert_eq!(workspace.save_target(), Some(save_path.as_path()));
    assert!(save_path.join("manifest.json").is_file());
    workspace.save().unwrap();
}

#[test]
fn workspace_add_contour_creates_glyph_and_persists_layer() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");
    let mut workspace =
        FontWorkspace::create(&source_path, &store_path, NewWorkspace::new()).unwrap();

    let target = GlyphLayerTarget {
        glyph_name: "A".to_string(),
        unicode: Some(65),
        layer_id: workspace.font().default_layer_id(),
    };

    let change = workspace.add_contour(target).unwrap();

    assert_eq!(change.structure.contours.len(), 1);
    let glyph = workspace.font().glyph("A").unwrap();
    assert_eq!(glyph.unicodes(), &[65]);
    assert!(
        workspace
            .store()
            .get_glyph(&StoreGlyphId::new(glyph.id().to_string()))
            .unwrap()
            .is_some()
    );
}

#[test]
fn workspace_add_point_updates_live_font_and_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");
    let mut workspace =
        FontWorkspace::create(&source_path, &store_path, NewWorkspace::new()).unwrap();

    let target = GlyphLayerTarget {
        glyph_name: "A".to_string(),
        unicode: Some(65),
        layer_id: workspace.font().default_layer_id(),
    };
    let contour = workspace
        .add_contour(target.clone())
        .unwrap()
        .structure
        .contours[0]
        .id
        .parse()
        .unwrap();

    let change = workspace
        .add_point(
            target.clone(),
            contour,
            10.0,
            20.0,
            PointType::OnCurve,
            false,
        )
        .unwrap();

    assert_eq!(change.changed.point_ids.len(), 1);
    let glyph = workspace.font().glyph("A").unwrap();
    let layer = glyph.layer(target.layer_id).unwrap();
    let point = layer
        .contour(contour)
        .unwrap()
        .get_point(change.changed.point_ids[0])
        .unwrap();
    assert_eq!((point.x(), point.y()), (10.0, 20.0));
    assert_eq!(point.point_type(), PointType::OnCurve);
    assert_eq!(
        workspace
            .store()
            .list_points_for_contour(&contour.to_string())
            .unwrap()
            .len(),
        1
    );
}

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}
