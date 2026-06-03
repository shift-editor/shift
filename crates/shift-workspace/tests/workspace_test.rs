use shift_workspace::{FontWorkspace, NewWorkspace};

#[test]
fn creates_workspace_with_source_package_and_working_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::create_new(
        &source_path,
        &store_path,
        NewWorkspace::with_family_name("Test Font"),
    )
    .unwrap();

    assert_eq!(workspace.source_package().path(), source_path.as_path());
    assert!(workspace.source_package().manifest_path().is_file());
    assert_eq!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .as_deref(),
        Some("Test Font")
    );
    assert_eq!(workspace.font().glyphs().len(), 0);
}

#[test]
fn opens_existing_workspace_paths() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    FontWorkspace::create_new(&source_path, &store_path, NewWorkspace::new()).unwrap();

    let workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    assert_eq!(workspace.source_package().path(), source_path.as_path());
    assert!(workspace.font_info().unwrap().is_some());
}
