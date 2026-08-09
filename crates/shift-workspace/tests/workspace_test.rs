use std::{fs, path::PathBuf};

use shift_font::{
    AnchorId, AnchorSeed, Axis, AxisId, BooleanOp, ContourId, DesignLocation, ExternalLocation,
    Font, FontChange, FontIntent, FontIntentSet, Glyph, GlyphId, GlyphLayer, GlyphName, LayerId,
    NamedInstance, NamedInstanceId, PointId, PointSeed, PointType, SourceId, error::CoreError,
};
use shift_source::ShiftSourcePackage;
use shift_store::ShiftStore;
use shift_workspace::{AcquireScope, FontWorkspace, NewWorkspace, WorkspaceError, WorkspaceSource};

fn create_glyph_intent(name: &str, unicodes: Vec<u32>) -> FontIntent {
    FontIntent::CreateGlyph {
        glyph_id: None,
        name: name.to_string(),
        unicodes,
    }
}

fn create_glyph(workspace: &mut FontWorkspace, name: &str, unicodes: Vec<u32>) -> GlyphId {
    workspace
        .apply(
            FontIntentSet {
                intents: vec![create_glyph_intent(name, unicodes)],
            },
            None,
        )
        .unwrap();

    workspace.font().glyph_id_by_name(name).unwrap()
}

fn create_glyph_layer(
    workspace: &mut FontWorkspace,
    glyph_id: GlyphId,
    source_id: SourceId,
) -> LayerId {
    let layer_id = LayerId::new();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id,
                    source_id,
                }],
            },
            None,
        )
        .unwrap();
    layer_id
}

#[test]
fn creates_untitled_workspace_with_working_store_only() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    let workspace =
        FontWorkspace::create_untitled(&store_path, NewWorkspace::with_family_name("Test Font"))
            .unwrap();

    assert_eq!(workspace.source(), &WorkspaceSource::Untitled);
    assert_eq!(workspace.save_target(), None);
    assert!(store_path.is_file());
    assert_eq!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .as_deref(),
        Some("Test Font")
    );
    assert_eq!(workspace.font().glyph_count(), 0);
}

#[test]
fn creates_package_workspace_with_source_package_and_working_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    let workspace = FontWorkspace::create_package(
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
    assert!(source_path.is_file());
    assert_eq!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .as_deref(),
        Some("Test Font")
    );
    assert_eq!(workspace.font().glyph_count(), 0);
}

#[test]
fn opens_existing_workspace_paths() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("TestFont.shift");
    let store_path = temp.path().join("working.sqlite");

    FontWorkspace::create_package(&source_path, &store_path, NewWorkspace::new()).unwrap();

    let workspace = FontWorkspace::open(&source_path, &store_path).unwrap();

    assert_eq!(workspace.save_target(), Some(source_path.as_path()));
    assert!(workspace.font_info().unwrap().is_some());
}

#[test]
fn native_document_reopens_sparse_recovery_and_saves_to_canonical() {
    let temp = tempfile::tempdir().unwrap();
    let document_path = temp.path().join("Dogfood.shift");
    let recovery_path = temp.path().join("recovery.sqlite");
    let original = shift_font::Font::new();
    drop(ShiftStore::create_document(&document_path, &original).unwrap());

    let mut workspace = FontWorkspace::open_document(&document_path, &recovery_path).unwrap();
    assert_eq!(
        workspace.source(),
        &WorkspaceSource::Document {
            path: document_path.clone(),
        }
    );
    assert_eq!(workspace.loaded_layer_count(), 0);
    let clean_revision = workspace.slug_atlas_cache_revision().unwrap();
    create_glyph(&mut workspace, "B", vec![66]);
    assert!(workspace.is_dirty().unwrap());
    let dirty_revision = workspace.slug_atlas_cache_revision().unwrap();
    assert_ne!(dirty_revision, clean_revision);
    drop(workspace);
    assert!(
        ShiftStore::open_document(&document_path)
            .unwrap()
            .load_font_state()
            .unwrap()
            .glyph_id_by_name("B")
            .is_none()
    );

    let mut recovered = FontWorkspace::open_document(&document_path, &recovery_path).unwrap();
    assert_eq!(
        recovered.slug_atlas_cache_revision().unwrap(),
        dirty_revision
    );
    assert!(recovered.font().glyph_id_by_name("B").is_some());
    recovered.save().unwrap();
    assert!(!recovered.is_dirty().unwrap());
    assert_ne!(
        recovered.slug_atlas_cache_revision().unwrap(),
        dirty_revision
    );
    drop(recovered);
    assert!(
        ShiftStore::open_document(&document_path)
            .unwrap()
            .load_font_state()
            .unwrap()
            .glyph_id_by_name("B")
            .is_some()
    );
}

#[test]
fn native_document_save_as_adopts_new_identity_without_mutating_source() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("Source.shift");
    let source_recovery = temp.path().join("source-recovery.sqlite");
    let destination_path = temp.path().join("Destination.shift");
    let destination_recovery = temp.path().join("destination-recovery.sqlite");
    drop(ShiftStore::create_document(&source_path, &shift_font::Font::new()).unwrap());
    let source_id = ShiftStore::open_document(&source_path)
        .unwrap()
        .document_metadata()
        .unwrap()
        .document_id;
    let mut workspace = FontWorkspace::open_document(&source_path, &source_recovery).unwrap();
    create_glyph(&mut workspace, "B", vec![66]);

    let destination = workspace
        .save_as_document(&destination_path, &destination_recovery)
        .unwrap();

    assert_ne!(destination.document_id, source_id);
    assert_eq!(workspace.save_target(), Some(destination_path.as_path()));
    assert!(!workspace.is_dirty().unwrap());
    assert!(
        ShiftStore::open_document(&source_path)
            .unwrap()
            .load_font_state()
            .unwrap()
            .glyph_id_by_name("B")
            .is_none()
    );
    assert!(
        ShiftStore::open_document(&destination_path)
            .unwrap()
            .load_font_state()
            .unwrap()
            .glyph_id_by_name("B")
            .is_some()
    );
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
    assert!(workspace.font().glyph_count() > 0);
    assert!(
        workspace
            .font_info()
            .unwrap()
            .unwrap()
            .family_name
            .is_some()
    );
    let entries = fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert!(
        entries
            .iter()
            .all(|name| !name.to_string_lossy().starts_with(".shift-import-")),
        "staging artifacts remain: {entries:?}"
    );
}

#[test]
fn large_ttf_reopens_directory_first_and_acquires_only_requested_layers() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("apps/desktop/src/renderer/src/assets/fonts/Inter-VariableFont.ttf");
    let store_path = temp.path().join("inter.sqlite");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    let glyph_count = workspace.font().glyph_count();
    let total_layers = workspace
        .font()
        .glyphs()
        .map(|glyph| glyph.layers().len())
        .sum::<usize>();
    assert!(
        glyph_count > 2_000,
        "fixture should exercise a large glyph directory"
    );
    assert!(total_layers >= glyph_count);

    let requested = workspace
        .font()
        .glyphs()
        .filter(|glyph| !glyph.layers().is_empty())
        .take(520)
        .map(|glyph| glyph.id())
        .collect::<Vec<_>>();
    assert!(requested.len() > 512);
    assert_eq!(workspace.loaded_layer_count(), 0);
    workspace
        .acquire_glyphs(&requested, AcquireScope::Glyphs)
        .unwrap();
    let expected = requested
        .iter()
        .flat_map(|glyph_id| {
            workspace
                .font()
                .glyph(glyph_id.clone())
                .unwrap()
                .layers()
                .values()
                .map(|layer| (layer.id(), layer.as_ref().clone()))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    drop(workspace);

    let mut resumed = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(resumed.font().glyph_count(), glyph_count);
    assert_eq!(resumed.loaded_layer_count(), 0);

    resumed
        .acquire_glyphs(&requested, AcquireScope::Glyphs)
        .unwrap();

    assert_eq!(resumed.loaded_layer_count(), expected.len());
    assert!(resumed.loaded_layer_count() < total_layers);
    for (layer_id, layer) in expected {
        assert_eq!(resumed.font().layer(layer_id).unwrap(), &layer);
    }
}

/// Manual corpus gate for large fonts that cannot live in the repository.
///
/// Run with, for example:
/// `SHIFT_STRESS_FONT=/path/to/SourceHanSans-VF.ttf SHIFT_STRESS_MIN_GLYPHS=65000 SHIFT_STRESS_MIN_LAYERS=65000 cargo test -p shift-workspace configured_large_corpus_streams_resumes_and_acquires -- --ignored --nocapture`.
#[test]
#[ignore = "requires SHIFT_STRESS_FONT and explicit corpus expectations"]
fn configured_large_corpus_streams_resumes_and_acquires() {
    let source_path = PathBuf::from(
        std::env::var_os("SHIFT_STRESS_FONT").expect("SHIFT_STRESS_FONT must name a font source"),
    );
    let min_glyphs = std::env::var("SHIFT_STRESS_MIN_GLYPHS")
        .expect("SHIFT_STRESS_MIN_GLYPHS must document the selected corpus")
        .parse::<usize>()
        .expect("SHIFT_STRESS_MIN_GLYPHS must be an integer");
    let min_layers = std::env::var("SHIFT_STRESS_MIN_LAYERS")
        .expect("SHIFT_STRESS_MIN_LAYERS must document the selected corpus")
        .parse::<usize>()
        .expect("SHIFT_STRESS_MIN_LAYERS must be an integer");
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("corpus.sqlite");
    let started = std::time::Instant::now();

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    let glyph_count = workspace.font().glyph_count();
    let layer_count = workspace
        .font()
        .glyphs()
        .map(|glyph| glyph.layers().len())
        .sum::<usize>();
    assert!(glyph_count >= min_glyphs, "got {glyph_count} glyphs");
    assert!(layer_count >= min_layers, "got {layer_count} layers");
    assert_eq!(workspace.loaded_layer_count(), 0);

    let glyph_ids = workspace
        .font()
        .glyphs()
        .filter(|glyph| !glyph.layers().is_empty())
        .take(16)
        .map(|glyph| glyph.id())
        .collect::<Vec<_>>();
    workspace
        .acquire_glyphs(&glyph_ids, AcquireScope::Glyphs)
        .unwrap();
    assert!(workspace.loaded_layer_count() > 0);
    assert!(workspace.loaded_layer_count() < layer_count);
    drop(workspace);

    let resumed = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(resumed.font().glyph_count(), glyph_count);
    assert_eq!(resumed.loaded_layer_count(), 0);
    eprintln!(
        "corpus={} glyphs={glyph_count} layers={layer_count} store_bytes={} elapsed_ms={:.3}",
        source_path.display(),
        fs::metadata(&store_path).unwrap().len(),
        started.elapsed().as_secs_f64() * 1_000.0
    );
}

#[test]
fn designspace_and_ufo_sources_roundtrip_through_lazy_component_acquisition() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    let store_path = temp.path().join("mutatorsans.sqlite");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    let glyph_count = workspace.font().glyph_count();
    let total_layers = workspace
        .font()
        .glyphs()
        .map(|glyph| glyph.layers().len())
        .sum::<usize>();
    assert!(workspace.font().sources().len() >= 4);
    assert!(total_layers >= glyph_count * 4);

    let root = workspace
        .font()
        .glyphs()
        .find(|glyph| {
            !workspace
                .store()
                .referenced_glyph_ids_for_glyph(&glyph.id())
                .unwrap()
                .is_empty()
        })
        .expect("fixture should contain a composite glyph")
        .id();
    let closure = workspace
        .store()
        .referenced_glyph_closure([root.clone()])
        .unwrap();
    assert!(closure.len() > 1);
    let closure_layer_count = closure
        .iter()
        .map(|glyph_id| {
            workspace
                .font()
                .glyph(glyph_id.clone())
                .unwrap()
                .layers()
                .len()
        })
        .sum::<usize>();
    assert_eq!(workspace.loaded_layer_count(), 0);
    workspace
        .acquire_glyphs(std::slice::from_ref(&root), AcquireScope::ComponentClosure)
        .unwrap();
    let expected_root_layers = workspace
        .font()
        .glyph(root.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.as_ref().clone()))
        .collect::<Vec<_>>();
    drop(workspace);

    let mut resumed = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(resumed.loaded_layer_count(), 0);
    resumed
        .acquire_glyphs(std::slice::from_ref(&root), AcquireScope::ComponentClosure)
        .unwrap();

    assert_eq!(resumed.loaded_layer_count(), closure_layer_count);
    assert!(resumed.loaded_layer_count() < total_layers);
    for (layer_id, layer) in expected_root_layers {
        assert_eq!(resumed.font().layer(layer_id).unwrap(), &layer);
    }
}

#[test]
fn glyphs_source_imports_directory_first_and_acquires_component_closure() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/Homenaje.glyphs");
    let store_path = temp.path().join("homenaje.sqlite");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    let root = workspace
        .font()
        .glyph_id_by_name("Aacute")
        .expect("Homenaje should contain Aacute");
    let closure = workspace
        .store()
        .referenced_glyph_closure([root.clone()])
        .unwrap();
    let closure_layer_count = closure
        .iter()
        .map(|glyph_id| {
            workspace
                .font()
                .glyph(glyph_id.clone())
                .unwrap()
                .layers()
                .len()
        })
        .sum::<usize>();

    assert!(closure.len() > 1);
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(
        workspace
            .font()
            .glyph(root.clone())
            .unwrap()
            .layers()
            .values()
            .all(|layer| layer.is_empty())
    );

    workspace
        .acquire_glyphs(std::slice::from_ref(&root), AcquireScope::ComponentClosure)
        .unwrap();
    assert_eq!(workspace.loaded_layer_count(), closure_layer_count);
    assert_eq!(
        workspace
            .font()
            .glyph(root.clone())
            .unwrap()
            .layers()
            .values()
            .flat_map(|layer| layer.components_iter())
            .count(),
        2
    );
    drop(workspace);

    let mut resumed = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(resumed.loaded_layer_count(), 0);
    resumed
        .acquire_glyphs(std::slice::from_ref(&root), AcquireScope::ComponentClosure)
        .unwrap();
    assert_eq!(resumed.loaded_layer_count(), closure_layer_count);
    assert_eq!(
        resumed
            .font()
            .glyph(root)
            .unwrap()
            .layers()
            .values()
            .flat_map(|layer| layer.components_iter())
            .count(),
        2
    );
}

#[test]
fn ufo_source_roundtrips_through_lazy_acquisition() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    let store_path = temp.path().join("mutatorsans-ufo.sqlite");

    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    let glyph_id = workspace
        .font()
        .glyphs()
        .find(|glyph| !glyph.layers().is_empty())
        .expect("fixture should contain a glyph layer")
        .id();
    assert_eq!(workspace.loaded_layer_count(), 0);

    workspace
        .acquire_glyphs(std::slice::from_ref(&glyph_id), AcquireScope::Glyphs)
        .unwrap();
    let expected = workspace
        .font()
        .glyph(glyph_id.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.as_ref().clone()))
        .collect::<Vec<_>>();
    assert!(!expected.is_empty());
    drop(workspace);

    let mut resumed = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(resumed.loaded_layer_count(), 0);
    resumed
        .acquire_glyphs(std::slice::from_ref(&glyph_id), AcquireScope::Glyphs)
        .unwrap();

    assert_eq!(resumed.loaded_layer_count(), expected.len());
    for (layer_id, layer) in expected {
        assert_eq!(resumed.font().layer(layer_id).unwrap(), &layer);
    }
}

#[test]
fn failed_streaming_import_removes_staging_and_preserves_the_destination() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = temp.path().join("Broken.ufo");
    let store_path = temp.path().join("existing.sqlite");
    let mut font = Font::new();
    let mut glyph = Glyph::new("A");
    let mut layer = GlyphLayer::new(LayerId::new(), font.default_source_id().unwrap());
    let mut contour = shift_font::Contour::new();
    contour.add_point(0.0, 0.0, PointType::OnCurve, false);
    layer.add_contour(contour);
    glyph.set_layer(layer);
    font.insert_glyph(glyph).unwrap();
    shift_backends::font_loader::FontLoader::new()
        .write_font(&font, source_path.to_str().unwrap())
        .unwrap();
    let glif_path = fs::read_dir(source_path.join("glyphs"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "glif")
        })
        .unwrap();
    fs::remove_file(glif_path).unwrap();
    drop(shift_store::ShiftStore::open(&store_path).unwrap());
    let destination_before = fs::read(&store_path).unwrap();

    assert!(FontWorkspace::open(&source_path, &store_path).is_err());

    assert_eq!(fs::read(&store_path).unwrap(), destination_before);
    assert!(
        shift_store::ShiftStore::open(&store_path)
            .unwrap()
            .workspace_state()
            .unwrap()
            .is_none()
    );
    assert!(fs::read_dir(temp.path()).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".shift-import-")
    }));
}

#[test]
fn foreign_import_refuses_to_replace_a_published_workspace_store() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    let store_path = temp.path().join("published.sqlite");
    let workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    drop(workspace);

    let error = match FontWorkspace::open(&source_path, &store_path) {
        Ok(_) => panic!("foreign import must not replace a published workspace"),
        Err(error) => error,
    };

    assert!(matches!(
        error,
        WorkspaceError::Store(shift_store::StoreError::ImportDestinationNotEmpty(path))
            if path == store_path
    ));
    let resumed = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(resumed.font().glyph_count(), 0);
}

#[test]
fn failed_acquisition_keeps_placeholders_and_allows_an_unrelated_retry() {
    let temp = tempfile::tempdir().unwrap();
    let source_path = fixture("fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo");
    let store_path = temp.path().join("corrupt-acquisition.sqlite");
    let mut workspace = FontWorkspace::open(&source_path, &store_path).unwrap();
    let requested = workspace
        .font()
        .glyphs()
        .filter(|glyph| !glyph.layers().is_empty())
        .take(2)
        .map(|glyph| glyph.id())
        .collect::<Vec<_>>();
    assert_eq!(requested.len(), 2);
    let corrupt_layer_id = workspace
        .font()
        .glyph(requested[0].clone())
        .unwrap()
        .layers()
        .keys()
        .next()
        .unwrap()
        .clone();
    let conn = rusqlite::Connection::open(&store_path).unwrap();
    conn.execute(
        "UPDATE glyph_layer_payloads
         SET payload = X'00', stored_byte_length = 1
         WHERE layer_id = ?1",
        [corrupt_layer_id.to_string()],
    )
    .unwrap();
    drop(conn);

    let error = workspace
        .acquire_glyphs(std::slice::from_ref(&requested[0]), AcquireScope::Glyphs)
        .unwrap_err();

    assert!(matches!(
        error,
        WorkspaceError::Store(shift_store::StoreError::LayerDecompression(_))
    ));
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(workspace.font().layer(corrupt_layer_id).unwrap().is_empty());

    workspace
        .acquire_glyphs(std::slice::from_ref(&requested[1]), AcquireScope::Glyphs)
        .unwrap();
    assert!(workspace.loaded_layer_count() > 0);
}

#[test]
fn save_requires_save_as_for_untitled_workspaces() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::NeedsSaveAs));
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
    assert!(save_path.is_file());
    workspace.save().unwrap();
}

#[test]
fn save_and_save_as_write_the_live_font_to_the_source_package() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace =
        FontWorkspace::create_untitled(&store_path, NewWorkspace::with_family_name("Saved Font"))
            .unwrap();
    create_glyph(&mut workspace, "A", vec![65]);

    workspace.save_as(&save_path).unwrap();

    let saved = ShiftSourcePackage::load_font(&save_path).unwrap();
    assert_eq!(saved.metadata().family_name.as_deref(), Some("Saved Font"));
    assert!(saved.glyph_id_by_name("A").is_some());

    create_glyph(&mut workspace, "B", vec![66]);
    workspace.save().unwrap();

    let saved = ShiftSourcePackage::load_font(&save_path).unwrap();
    assert!(saved.glyph_id_by_name("A").is_some());
    assert!(saved.glyph_id_by_name("B").is_some());
}

#[test]
fn slug_atlas_cache_revision_advances_and_survives_resume() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        assert_eq!(workspace.slug_atlas_cache_revision().unwrap(), "0");
        create_glyph(&mut workspace, "A", vec![65]);
        assert_eq!(workspace.slug_atlas_cache_revision().unwrap(), "1");
    }

    let workspace = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(workspace.slug_atlas_cache_revision().unwrap(), "1");
}

#[test]
fn resume_rebuilds_dirty_untitled_workspace_from_store() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        create_glyph(&mut workspace, "A", vec![65]);
        assert!(workspace.is_dirty().unwrap());
    }

    let workspace = FontWorkspace::resume(&store_path).unwrap();

    assert_eq!(workspace.source(), &WorkspaceSource::Untitled);
    assert!(workspace.is_dirty().unwrap());
    assert!(workspace.font().glyph_id_by_name("A").is_some());
}

#[test]
fn resumed_layers_are_acquired_and_evictable_without_losing_authored_state() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = create_glyph_layer(&mut workspace, glyph_id.clone(), source_id);
    add_square_contour(&mut workspace, &layer_id, (10.0, 20.0), 100.0);
    drop(workspace);

    let mut workspace = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(workspace.font().layer(layer_id.clone()).unwrap().is_empty());

    workspace
        .acquire_glyphs(std::slice::from_ref(&glyph_id), AcquireScope::Glyphs)
        .unwrap();
    assert_eq!(workspace.loaded_layer_count(), 1);
    let authored = workspace.font().layer(layer_id.clone()).unwrap().clone();
    assert_eq!(authored.contours_iter().next().unwrap().points().len(), 4);

    workspace
        .evict_glyphs(&[glyph_id.clone(), glyph_id.clone()])
        .unwrap();
    assert_eq!(workspace.loaded_layer_count(), 0);
    assert!(workspace.font().layer(layer_id.clone()).unwrap().is_empty());

    workspace
        .acquire_glyphs(std::slice::from_ref(&glyph_id), AcquireScope::Glyphs)
        .unwrap();
    assert_eq!(workspace.font().layer(layer_id).unwrap(), &authored);
}

#[test]
fn intent_on_directory_layer_acquires_before_persisting() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = create_glyph_layer(&mut workspace, glyph_id.clone(), source_id);
    add_square_contour(&mut workspace, &layer_id, (10.0, 20.0), 100.0);
    drop(workspace);

    let mut workspace = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(workspace.loaded_layer_count(), 0);
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::SetXAdvance {
                    layer_id: layer_id.clone(),
                    width: 777.0,
                }],
            },
            None,
        )
        .unwrap();

    let layer = workspace.font().layer(layer_id.clone()).unwrap();
    assert_eq!(workspace.loaded_layer_count(), 1);
    assert_eq!(layer.width(), 777.0);
    assert_eq!(layer.contours_iter().next().unwrap().points().len(), 4);
    drop(workspace);

    let mut resumed = FontWorkspace::resume(&store_path).unwrap();
    resumed
        .acquire_glyphs(std::slice::from_ref(&glyph_id), AcquireScope::Glyphs)
        .unwrap();
    let layer = resumed.font().layer(layer_id).unwrap();
    assert_eq!(layer.width(), 777.0);
    assert_eq!(layer.contours_iter().next().unwrap().points().len(), 4);
}

#[test]
fn undo_after_eviction_reacquires_and_tracks_restored_layer_as_loaded() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = create_glyph_layer(&mut workspace, glyph_id.clone(), source_id);
    add_square_contour(&mut workspace, &layer_id, (10.0, 20.0), 100.0);
    let original_width = workspace.font().layer(layer_id.clone()).unwrap().width();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::SetXAdvance {
                    layer_id: layer_id.clone(),
                    width: 777.0,
                }],
            },
            Some("Change advance".to_string()),
        )
        .unwrap();
    workspace
        .evict_glyphs(std::slice::from_ref(&glyph_id))
        .unwrap();
    assert_eq!(workspace.loaded_layer_count(), 0);

    workspace.undo().unwrap().expect("advance edit should undo");

    let layer = workspace.font().layer(layer_id).unwrap();
    assert_eq!(workspace.loaded_layer_count(), 1);
    assert_eq!(layer.width(), original_width);
    assert_eq!(layer.contours_iter().next().unwrap().points().len(), 4);
}

#[test]
fn resume_package_workspace_can_save_unsaved_store_state() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        create_glyph(&mut workspace, "A", vec![65]);
        workspace.save_as(&save_path).unwrap();
        create_glyph(&mut workspace, "B", vec![66]);
        assert!(workspace.is_dirty().unwrap());
    }

    let mut workspace = FontWorkspace::resume(&store_path).unwrap();
    assert_eq!(workspace.save_target(), Some(save_path.as_path()));
    assert!(workspace.font().glyph_id_by_name("B").is_some());

    workspace.save().unwrap();

    let saved = ShiftSourcePackage::load_font(&save_path).unwrap();
    assert!(saved.glyph_id_by_name("A").is_some());
    assert!(saved.glyph_id_by_name("B").is_some());
    assert!(!workspace.is_dirty().unwrap());
}

#[test]
fn save_rejects_missing_package_target_without_recreating_it() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&save_path).unwrap();
    fs::remove_file(&save_path).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::SourceMissing(path) if path == save_path));
    assert!(!save_path.exists());
}

#[test]
fn save_rejects_package_target_replaced_by_another_file() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&save_path).unwrap();
    ShiftSourcePackage::save_font(&save_path, &shift_font::Font::new()).unwrap();

    let error = workspace.save().unwrap_err();

    assert!(matches!(error, WorkspaceError::SourceIdentityConflict(path) if path == save_path));
}

#[test]
fn inspect_package_reports_stable_package_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&save_path).unwrap();

    let package = ShiftSourcePackage::open(&save_path).unwrap();
    let identity = FontWorkspace::inspect_package(&save_path).unwrap();

    assert_eq!(identity.package_id, package.package_id().to_string());
    assert_eq!(
        identity.canonical_path,
        fs::canonicalize(&save_path).unwrap()
    );
    assert!(identity.fingerprint.starts_with("fnv1a64:"));
}

#[test]
fn inspect_package_draft_reports_bound_package_and_dirty_state() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&save_path).unwrap();
    workspace.set_workspace_id("doc-1".to_string()).unwrap();

    let package = FontWorkspace::inspect_package(&save_path).unwrap();
    let clean_draft = FontWorkspace::inspect_package_draft(&store_path).unwrap();

    assert_eq!(clean_draft.document_id.as_deref(), Some("doc-1"));
    assert_eq!(clean_draft.package_id, package.package_id);
    assert_eq!(clean_draft.source_path, save_path);
    assert_eq!(clean_draft.base_fingerprint, package.fingerprint);
    assert!(!clean_draft.dirty);

    create_glyph(&mut workspace, "A", vec![65]);
    let dirty_draft = FontWorkspace::inspect_package_draft(&store_path).unwrap();

    assert_eq!(dirty_draft.document_id.as_deref(), Some("doc-1"));
    assert_eq!(dirty_draft.base_fingerprint, clean_draft.base_fingerprint);
    assert!(dirty_draft.dirty);
}

#[test]
fn save_preserves_package_identity_and_save_as_mints_a_new_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let first_path = temp.path().join("First.shift");
    let second_path = temp.path().join("Second.shift");

    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    workspace.save_as(&first_path).unwrap();
    let first_id = ShiftSourcePackage::open(&first_path)
        .unwrap()
        .package_id()
        .to_string();

    create_glyph(&mut workspace, "A", vec![65]);
    workspace.save().unwrap();
    let saved_id = ShiftSourcePackage::open(&first_path)
        .unwrap()
        .package_id()
        .to_string();

    workspace.save_as(&second_path).unwrap();
    let second_id = ShiftSourcePackage::open(&second_path)
        .unwrap()
        .package_id()
        .to_string();

    assert_eq!(saved_id, first_id);
    assert_ne!(second_id, first_id);
}

#[test]
fn resume_for_source_relinks_package_identity_after_move() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let save_path = temp.path().join("SavedFont.shift");
    let moved_path = temp.path().join("MovedFont.shift");

    {
        let mut workspace =
            FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
        workspace.save_as(&save_path).unwrap();
        create_glyph(&mut workspace, "B", vec![66]);
    }
    fs::rename(&save_path, &moved_path).unwrap();

    let mut workspace = FontWorkspace::resume_for_source(&store_path, &moved_path).unwrap();
    assert_eq!(workspace.save_target(), Some(moved_path.as_path()));
    assert!(workspace.font().glyph_id_by_name("B").is_some());

    workspace.save().unwrap();

    let saved = ShiftSourcePackage::load_font(&moved_path).unwrap();
    assert!(saved.glyph_id_by_name("B").is_some());
}

fn set_x_advance_intents(layer_id: LayerId, width: f64) -> FontIntentSet {
    FontIntentSet {
        intents: vec![FontIntent::SetXAdvance { layer_id, width }],
    }
}

#[test]
fn apply_set_x_advance_updates_existing_layer() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = create_glyph_layer(&mut workspace, glyph_id, source_id);

    let outcome = workspace
        .apply(set_x_advance_intents(layer_id.clone(), 640.0), None)
        .unwrap();

    assert_eq!(outcome.layers[0].layer.width(), 640.0);
    assert_eq!(workspace.font().layer(layer_id).unwrap().width(), 640.0);
}

#[test]
fn create_glyph_undo_redo_removes_and_restores_glyph_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let applied = workspace
        .apply(
            FontIntentSet {
                intents: vec![create_glyph_intent("A", vec![65])],
            },
            Some("Add Glyph".to_string()),
        )
        .unwrap();
    let glyph_id = workspace.font().glyph_id_by_name("A").unwrap();

    assert_eq!(workspace.font().glyph_count(), 1);
    assert!(applied.layers.is_empty());
    assert!(
        workspace
            .font()
            .glyph(glyph_id.clone())
            .unwrap()
            .layers()
            .is_empty()
    );

    let undone = workspace.undo().unwrap().expect("createGlyph should undo");
    assert_eq!(workspace.font().glyph_count(), 0);
    assert!(undone.changes.changes.iter().any(
        |change| matches!(change, FontChange::GlyphDeleted(change) if change.glyph_id == glyph_id)
    ));

    let redone = workspace.redo().unwrap().expect("createGlyph should redo");
    assert_eq!(workspace.font().glyph_count(), 1);
    assert!(redone.layers.is_empty());
    assert!(workspace.font().glyph(glyph_id).is_some());
}

#[test]
fn create_glyph_layer_undo_redo_removes_and_restores_sparse_layer() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = LayerId::new();

    let applied = workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateGlyphLayer {
                    layer_id: layer_id.clone(),
                    glyph_id: glyph_id.clone(),
                    source_id: source_id.clone(),
                }],
            },
            Some("Create Layer".to_string()),
        )
        .unwrap();

    assert_eq!(applied.layers.len(), 1);
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
        Some(layer_id.clone())
    );

    let undone = workspace
        .undo()
        .unwrap()
        .expect("createGlyphLayer should undo");
    assert!(undone.changes.changes.iter().any(
        |change| matches!(change, FontChange::GlyphLayerDeleted(change) if change.layer_id == layer_id)
    ));
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
        None
    );

    let redone = workspace
        .redo()
        .unwrap()
        .expect("createGlyphLayer should redo");
    assert_eq!(redone.layers.len(), 1);
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_id, source_id),
        Some(layer_id)
    );
}

#[test]
fn create_glyph_layer_initializes_width_from_font_upm() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut new_workspace = NewWorkspace::new();
    new_workspace.units_per_em = 2048;
    let mut workspace = FontWorkspace::create_untitled(&store_path, new_workspace).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);

    let layer_id = create_glyph_layer(&mut workspace, glyph_id, source_id);

    assert_eq!(workspace.font().layer(layer_id).unwrap().width(), 1024.0);
}

#[test]
fn delete_source_undo_redo_removes_and_restores_existing_sparse_layers() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let glyph_a = create_glyph(&mut workspace, "A", vec![65]);
    let glyph_b = create_glyph(&mut workspace, "B", vec![66]);
    let source_id = SourceId::from_raw("source_alt");
    let axis_id = create_weight_axis(&mut workspace);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateSource {
                    source_id: source_id.clone(),
                    name: "Alt".to_string(),
                    location: weight_location(axis_id, 700.0),
                }],
            },
            Some("Create Source".to_string()),
        )
        .unwrap();
    let layer_id = create_glyph_layer(&mut workspace, glyph_a.clone(), source_id.clone());
    workspace
        .apply(set_x_advance_intents(layer_id.clone(), 640.0), None)
        .unwrap();
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_b.clone(), source_id.clone()),
        None
    );

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteSource {
                    source_id: source_id.clone(),
                }],
            },
            Some("Delete Source".to_string()),
        )
        .unwrap();

    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );
    assert!(workspace.font().layer(layer_id.clone()).is_none());

    let undone = workspace.undo().unwrap().expect("deleteSource should undo");
    assert!(undone
        .changes
        .changes
        .iter()
        .any(|change| matches!(change, FontChange::SourceCreated(change) if change.source_id == source_id)));
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .any(|source| source.id() == source_id)
    );
    assert_eq!(
        workspace.font().layer(layer_id.clone()).unwrap().width(),
        640.0
    );
    assert_eq!(
        workspace
            .font()
            .layer_id_for_glyph_source(glyph_b, source_id.clone()),
        None
    );

    let redone = workspace.redo().unwrap().expect("deleteSource should redo");
    assert!(redone
        .changes
        .changes
        .iter()
        .any(|change| matches!(change, FontChange::GlyphLayerDeleted(change) if change.layer_id == layer_id)));
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );
    assert!(workspace.font().layer(layer_id).is_none());
}

#[test]
fn batched_create_glyphs_undo_as_one_step() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    create_glyph_intent("A", vec![65]),
                    create_glyph_intent("B", vec![66]),
                    create_glyph_intent("C", vec![67]),
                ],
            },
            Some("Add Glyphs".to_string()),
        )
        .unwrap();
    assert_eq!(workspace.font().glyph_count(), 3);

    workspace.undo().unwrap().expect("batch should undo");
    assert_eq!(workspace.font().glyph_count(), 0);
    assert!(workspace.undo().unwrap().is_none());

    workspace.redo().unwrap().expect("batch should redo");
    assert_eq!(workspace.font().glyph_count(), 3);
    assert!(workspace.font().glyph_id_by_name("B").is_some());
}

#[test]
fn mixed_font_level_batch_undoes_axis_source_and_glyph_together() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    create_glyph(&mut workspace, "A", vec![65]);
    let base_sources = workspace.font().sources().len();

    let axis_id = AxisId::from_raw("axis_weight");
    let mut location = DesignLocation::new();
    location.set(axis_id.clone(), 700.0);
    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::CreateAxis {
                        axis: Axis::with_id(
                            axis_id,
                            "wght".to_string(),
                            "Weight".to_string(),
                            100.0,
                            400.0,
                            900.0,
                        ),
                    },
                    FontIntent::CreateSource {
                        source_id: SourceId::from_raw("bold"),
                        name: "Bold".to_string(),
                        location,
                    },
                    create_glyph_intent("B", vec![66]),
                ],
            },
            Some("Add Weight".to_string()),
        )
        .unwrap();

    assert_eq!(workspace.font().axes().len(), 1);
    assert_eq!(workspace.font().sources().len(), base_sources + 1);
    assert_eq!(workspace.font().glyph_count(), 2);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), 0);
    let glyph_b = workspace.font().glyph_by_name("B").unwrap();
    assert_eq!(glyph_b.layers().len(), 0);

    workspace.undo().unwrap().expect("batch should undo");
    assert_eq!(workspace.font().axes().len(), 0);
    assert_eq!(workspace.font().sources().len(), base_sources);
    assert_eq!(workspace.font().glyph_count(), 1);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), 0);

    workspace.redo().unwrap().expect("batch should redo");
    assert_eq!(workspace.font().axes().len(), 1);
    assert_eq!(workspace.font().sources().len(), base_sources + 1);
    assert_eq!(workspace.font().glyph_count(), 2);
    let glyph_a = workspace.font().glyph_by_name("A").unwrap();
    assert_eq!(glyph_a.layers().len(), 0);
}

#[test]
fn apply_set_x_advance_rejects_missing_layer() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let layer_id = LayerId::new();

    let error = match workspace.apply(set_x_advance_intents(layer_id.clone(), 640.0), None) {
        Ok(_) => panic!("apply should reject a missing layer id"),
        Err(error) => error,
    };

    assert!(matches!(
        error,
        WorkspaceError::Font(CoreError::LayerNotFound(missing_layer_id))
            if missing_layer_id == layer_id
    ));
    assert_eq!(workspace.font().glyph_count(), 0);
}

fn workspace_with_layer() -> (tempfile::TempDir, FontWorkspace, LayerId) {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = workspace.font().default_source_id().unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);
    let layer_id = create_glyph_layer(&mut workspace, glyph_id, source_id);

    (temp, workspace, layer_id)
}

fn add_square_contour(
    workspace: &mut FontWorkspace,
    layer_id: &LayerId,
    origin: (f64, f64),
    size: f64,
) -> (ContourId, Vec<PointId>) {
    let contour_id = ContourId::new();
    let point_ids: Vec<PointId> = (0..4).map(|_| PointId::new()).collect();
    let (x, y) = origin;
    let corners = [(x, y), (x + size, y), (x + size, y + size), (x, y + size)];
    let points = point_ids
        .iter()
        .zip(corners)
        .map(|(id, (px, py))| PointSeed {
            id: id.clone(),
            x: px,
            y: py,
            point_type: PointType::OnCurve,
            smooth: false,
        })
        .collect();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::AddContour {
                        layer_id: layer_id.clone(),
                        contour_id: contour_id.clone(),
                        closed: true,
                    },
                    FontIntent::AddPoints {
                        layer_id: layer_id.clone(),
                        contour_id: Some(contour_id.clone()),
                        before: None,
                        points,
                    },
                ],
            },
            None,
        )
        .unwrap();

    (contour_id, point_ids)
}

fn add_anchor(workspace: &mut FontWorkspace, layer_id: &LayerId) -> AnchorId {
    let anchor_id = AnchorId::new();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::AddAnchors {
                    layer_id: layer_id.clone(),
                    anchors: vec![AnchorSeed {
                        id: anchor_id.clone(),
                        name: Some("top".to_string()),
                        x: 100.0,
                        y: 700.0,
                    }],
                }],
            },
            None,
        )
        .unwrap();

    anchor_id
}

/// Applies the intents to the layer, then verifies undo restores the exact
/// pre-apply layer and redo restores the exact post-apply layer.
fn assert_layer_undo_redo(
    workspace: &mut FontWorkspace,
    layer_id: &LayerId,
    intents: Vec<FontIntent>,
) {
    let pre = workspace.font().layer(layer_id.clone()).unwrap().clone();
    workspace.apply(FontIntentSet { intents }, None).unwrap();
    let post = workspace.font().layer(layer_id.clone()).unwrap().clone();
    assert_ne!(pre, post, "intent should change the layer");

    workspace.undo().unwrap().expect("intent should undo");
    assert_eq!(workspace.font().layer(layer_id.clone()).unwrap(), &pre);

    workspace.redo().unwrap().expect("intent should redo");
    assert_eq!(workspace.font().layer(layer_id.clone()).unwrap(), &post);
}

#[test]
fn add_contour_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::AddContour {
            layer_id: layer_id.clone(),
            contour_id: ContourId::new(),
            closed: true,
        }],
    );
}

#[test]
fn add_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let contour_id = ContourId::new();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::AddContour {
                    layer_id: layer_id.clone(),
                    contour_id: contour_id.clone(),
                    closed: false,
                }],
            },
            None,
        )
        .unwrap();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::AddPoints {
            layer_id: layer_id.clone(),
            contour_id: Some(contour_id),
            before: None,
            points: vec![PointSeed {
                id: PointId::new(),
                x: 10.0,
                y: 20.0,
                point_type: PointType::OnCurve,
                smooth: false,
            }],
        }],
    );
}

#[test]
fn set_contour_closed_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (contour_id, _) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::SetContourClosed {
            layer_id: layer_id.clone(),
            contour_id,
            closed: false,
        }],
    );
}

#[test]
fn move_points_undo_redo_restores_exact_coordinates_without_structure() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);
    let pre = workspace.font().layer(layer_id.clone()).unwrap().clone();

    let applied = workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::MovePoints {
                    layer_id: layer_id.clone(),
                    point_ids: vec![point_ids[0].clone(), point_ids[1].clone()],
                    coords: vec![5.0, 6.0, 105.0, 6.0],
                }],
            },
            None,
        )
        .unwrap();
    let post = workspace.font().layer(layer_id.clone()).unwrap().clone();
    assert!(!applied.layers[0].structural);

    let undone = workspace
        .undo()
        .unwrap()
        .expect("position edit should undo");
    assert!(!undone.layers[0].structural);
    assert_eq!(workspace.font().layer(layer_id.clone()).unwrap(), &pre);

    let redone = workspace
        .redo()
        .unwrap()
        .expect("position edit should redo");
    assert!(!redone.layers[0].structural);
    assert_eq!(workspace.font().layer(layer_id).unwrap(), &post);
}

#[test]
fn set_point_smooth_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::SetPointSmooth {
            layer_id: layer_id.clone(),
            point_id: point_ids[0].clone(),
            smooth: true,
        }],
    );
}

#[test]
fn remove_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::RemovePoints {
            layer_id: layer_id.clone(),
            point_ids: vec![point_ids[0].clone()],
        }],
    );
}

#[test]
fn add_anchors_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::AddAnchors {
            layer_id: layer_id.clone(),
            anchors: vec![AnchorSeed {
                id: AnchorId::new(),
                name: Some("top".to_string()),
                x: 100.0,
                y: 700.0,
            }],
        }],
    );
}

#[test]
fn move_anchors_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let anchor_id = add_anchor(&mut workspace, &layer_id);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::MoveAnchors {
            layer_id: layer_id.clone(),
            anchor_ids: vec![anchor_id],
            coords: vec![150.0, 720.0],
        }],
    );
}

#[test]
fn remove_anchors_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let anchor_id = add_anchor(&mut workspace, &layer_id);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::RemoveAnchors {
            layer_id: layer_id.clone(),
            anchor_ids: vec![anchor_id],
        }],
    );
}

#[test]
fn reverse_contour_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (contour_id, _) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::ReverseContour {
            layer_id: layer_id.clone(),
            contour_id,
        }],
    );
}

#[test]
fn translate_points_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (_, point_ids) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::TranslatePoints {
            layer_id: layer_id.clone(),
            point_ids,
            dx: 10.0,
            dy: -5.0,
        }],
    );
}

#[test]
fn set_x_advance_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::SetXAdvance {
            layer_id: layer_id.clone(),
            width: 640.0,
        }],
    );
}

#[test]
fn apply_boolean_op_undo_redo_restores_layer() {
    let (_temp, mut workspace, layer_id) = workspace_with_layer();
    let (contour_a, _) = add_square_contour(&mut workspace, &layer_id, (0.0, 0.0), 100.0);
    let (contour_b, _) = add_square_contour(&mut workspace, &layer_id, (50.0, 50.0), 100.0);

    assert_layer_undo_redo(
        &mut workspace,
        &layer_id,
        vec![FontIntent::ApplyBooleanOp {
            layer_id: layer_id.clone(),
            contour_id_a: contour_a,
            contour_id_b: contour_b,
            operation: BooleanOp::Union,
        }],
    );
}

#[test]
fn update_glyph_undo_redo_restores_old_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let glyph_id = create_glyph(&mut workspace, "A", vec![65]);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::UpdateGlyph {
                    glyph_id: glyph_id.clone(),
                    new_name: GlyphName::new("A.alt").unwrap(),
                    new_unicodes: vec![97],
                }],
            },
            Some("Rename Glyph".to_string()),
        )
        .unwrap();

    let glyph = workspace.font().glyph(glyph_id.clone()).unwrap();
    assert_eq!(glyph.glyph_name().to_string(), "A.alt");
    assert_eq!(glyph.unicodes(), &[97]);

    let undone = workspace.undo().unwrap().expect("updateGlyph should undo");
    assert!(undone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::GlyphIdentityChanged(change) if change.glyph_id == glyph_id
    )));
    let glyph = workspace.font().glyph(glyph_id.clone()).unwrap();
    assert_eq!(glyph.glyph_name().to_string(), "A");
    assert_eq!(glyph.unicodes(), &[65]);
    assert_eq!(
        workspace.font().glyph_id_by_name("A"),
        Some(glyph_id.clone())
    );

    let redone = workspace.redo().unwrap().expect("updateGlyph should redo");
    assert!(redone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::GlyphIdentityChanged(change) if change.glyph_id == glyph_id
    )));
    let glyph = workspace.font().glyph(glyph_id.clone()).unwrap();
    assert_eq!(glyph.glyph_name().to_string(), "A.alt");
    assert_eq!(glyph.unicodes(), &[97]);
    assert_eq!(workspace.font().glyph_id_by_name("A.alt"), Some(glyph_id));
}

fn weight_axis(axis_id: AxisId) -> Axis {
    Axis::with_id(
        axis_id,
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    )
}

fn create_weight_axis(workspace: &mut FontWorkspace) -> AxisId {
    let axis_id = AxisId::from_raw("axis_weight");
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateAxis {
                    axis: weight_axis(axis_id.clone()),
                }],
            },
            Some("Create Axis".to_string()),
        )
        .unwrap();
    axis_id
}

fn weight_location(axis_id: AxisId, value: f64) -> DesignLocation {
    let mut location = DesignLocation::new();
    location.set(axis_id, value);
    location
}

#[test]
fn create_axis_undo_redo_removes_and_restores_axis() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let axis_id = AxisId::from_raw("axis_weight");

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateAxis {
                    axis: weight_axis(axis_id.clone()),
                }],
            },
            Some("Create Axis".to_string()),
        )
        .unwrap();
    let created = workspace.font().axes()[0].clone();

    workspace.undo().unwrap().expect("createAxis should undo");
    assert!(workspace.font().axes().is_empty());

    workspace.redo().unwrap().expect("createAxis should redo");
    assert_eq!(workspace.font().axes(), &[created]);
}

#[test]
fn metadata_replacement_is_persisted_and_undoable_without_changing_metrics() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let original_metadata = workspace.font().metadata().clone();
    let original_metrics = *workspace.font().metrics();
    let mut updated = original_metadata.clone();
    updated.family_name = Some("Shift Dogfood Sans".to_string());
    updated.style_name = Some("Text".to_string());
    updated.version_major = Some(2);
    updated.version_minor = Some(5);
    updated.designer = Some("Shift Type".to_string());
    updated.license = Some("SIL Open Font License 1.1".to_string());

    let applied = workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::UpdateFontMetadata {
                    metadata: updated.clone(),
                }],
            },
            Some("Update Font Metadata".to_string()),
        )
        .unwrap();

    assert_eq!(workspace.font().metadata(), &updated);
    assert_eq!(workspace.font().metrics(), &original_metrics);
    assert!(applied.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::FontMetadataUpdated(change) if change.metadata == updated
    )));
    let stored = workspace
        .font_info()
        .unwrap()
        .expect("font info should exist");
    assert_eq!(stored.family_name, updated.family_name);
    assert_eq!(stored.style_name, updated.style_name);
    assert_eq!(stored.designer, updated.designer);
    assert_eq!(stored.license_description, updated.license);
    assert_eq!(stored.units_per_em, original_metrics.units_per_em);

    let undone = workspace
        .undo()
        .unwrap()
        .expect("metadata update should undo");
    assert!(undone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::FontMetadataUpdated(change) if change.metadata == original_metadata
    )));
    assert_eq!(workspace.font().metadata(), &original_metadata);
    assert_eq!(workspace.font().metrics(), &original_metrics);

    workspace
        .redo()
        .unwrap()
        .expect("metadata update should redo");
    assert_eq!(workspace.font().metadata(), &updated);
    assert_eq!(workspace.font().metrics(), &original_metrics);
}

#[test]
fn named_instance_crud_is_undoable_and_keeps_external_location() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let axis_id = AxisId::from_raw("axis_weight");
    let instance_id = NamedInstanceId::from_raw("instance_bold");
    let mut location = ExternalLocation::new();
    location.set(axis_id.clone(), 700.0);
    let bold = NamedInstance::with_id(
        instance_id.clone(),
        "Bold".to_string(),
        location,
        Some("TestFont-Bold".to_string()),
    );

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::CreateAxis {
                        axis: weight_axis(axis_id.clone()),
                    },
                    FontIntent::CreateNamedInstance {
                        instance: bold.clone(),
                    },
                ],
            },
            Some("Create Bold Instance".to_string()),
        )
        .unwrap();
    assert_eq!(
        workspace.font().named_instances(),
        std::slice::from_ref(&bold)
    );

    let mut updated_location = ExternalLocation::new();
    updated_location.set(axis_id.clone(), 750.0);
    let updated = NamedInstance::with_id(
        instance_id.clone(),
        "Display Bold".to_string(),
        updated_location,
        Some("TestFont-DisplayBold".to_string()),
    );
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::UpdateNamedInstance {
                    instance: updated.clone(),
                }],
            },
            Some("Update Bold Instance".to_string()),
        )
        .unwrap();
    assert_eq!(
        workspace.font().named_instances(),
        std::slice::from_ref(&updated)
    );

    workspace
        .undo()
        .unwrap()
        .expect("instance update should undo");
    assert_eq!(
        workspace.font().named_instances(),
        std::slice::from_ref(&bold)
    );
    workspace
        .redo()
        .unwrap()
        .expect("instance update should redo");
    assert_eq!(
        workspace.font().named_instances(),
        std::slice::from_ref(&updated)
    );

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteNamedInstance {
                    instance_id: instance_id.clone(),
                }],
            },
            Some("Delete Bold Instance".to_string()),
        )
        .unwrap();
    assert!(workspace.font().named_instances().is_empty());

    let undone = workspace
        .undo()
        .unwrap()
        .expect("instance delete should undo");
    assert!(undone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::NamedInstancesUpdated(change) if change.instances == [updated.clone()]
    )));
    assert_eq!(
        workspace.font().named_instances(),
        std::slice::from_ref(&updated)
    );

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteAxis {
                    axis_id: axis_id.clone(),
                }],
            },
            Some("Delete Weight Axis".to_string()),
        )
        .unwrap();
    assert!(
        workspace.font().named_instances()[0]
            .location()
            .iter()
            .next()
            .is_none()
    );

    workspace.undo().unwrap().expect("axis delete should undo");
    assert_eq!(
        workspace.font().named_instances()[0]
            .location()
            .get(&axis_id),
        Some(750.0)
    );
}

#[test]
fn delete_axis_undo_redo_restores_full_axis_definition() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let axis_id = AxisId::from_raw("axis_weight");
    let source_id = SourceId::from_raw("bold");
    let mut location = DesignLocation::new();
    location.set(axis_id.clone(), 700.0);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![
                    FontIntent::CreateAxis {
                        axis: weight_axis(axis_id.clone()),
                    },
                    FontIntent::CreateSource {
                        source_id: source_id.clone(),
                        name: "Bold".to_string(),
                        location,
                    },
                ],
            },
            None,
        )
        .unwrap();
    let axis = workspace.font().axes()[0].clone();

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteAxis {
                    axis_id: axis_id.clone(),
                }],
            },
            Some("Delete Axis".to_string()),
        )
        .unwrap();
    assert!(workspace.font().axes().is_empty());

    let undone = workspace.undo().unwrap().expect("deleteAxis should undo");
    assert!(undone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::AxisCreated(change) if change.axis.id() == axis_id
    )));
    assert_eq!(workspace.font().axes(), std::slice::from_ref(&axis));

    // Deleting the axis also stripped source location values; undo must
    // bring them back both in memory and in the store.
    let restored = workspace
        .font()
        .sources()
        .iter()
        .find(|source| source.id() == source_id)
        .unwrap();
    assert_eq!(restored.location().get(&axis_id), Some(700.0));

    let store_source_id = shift_store::SourceId::new(source_id.to_string());
    let locations = workspace
        .store()
        .get_source_locations(&store_source_id)
        .unwrap();
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].value, 700.0);

    let redone = workspace.redo().unwrap().expect("deleteAxis should redo");
    assert!(redone.changes.changes.iter().any(|change| matches!(
        change,
        FontChange::AxisDeleted(change) if change.axis_id == axis_id
    )));
    assert!(workspace.font().axes().is_empty());

    workspace
        .undo()
        .unwrap()
        .expect("deleteAxis should undo again");
    assert_eq!(workspace.font().axes(), &[axis]);
}

#[test]
fn create_source_undo_redo_removes_and_restores_source() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = SourceId::from_raw("bold");
    let base_sources = workspace.font().sources().len();
    let axis_id = create_weight_axis(&mut workspace);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateSource {
                    source_id: source_id.clone(),
                    name: "Bold".to_string(),
                    location: weight_location(axis_id, 700.0),
                }],
            },
            Some("Create Source".to_string()),
        )
        .unwrap();
    let created = workspace
        .font()
        .sources()
        .iter()
        .find(|source| source.id() == source_id)
        .cloned()
        .unwrap();

    workspace.undo().unwrap().expect("createSource should undo");
    assert_eq!(workspace.font().sources().len(), base_sources);
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );

    workspace.redo().unwrap().expect("createSource should redo");
    assert_eq!(
        workspace
            .font()
            .sources()
            .iter()
            .find(|source| source.id() == source_id),
        Some(&created)
    );
}

#[test]
fn failed_undo_replay_hands_the_entry_back_for_retry() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    create_glyph(&mut workspace, "A", vec![65]);

    // Wipe the store's font rows so the undo's GlyphDeleted change has no
    // row to delete and the replay fails at the persistence step.
    workspace
        .store_mut()
        .replace_font_state(&shift_font::Font::new())
        .unwrap();

    let error = match workspace.undo() {
        Ok(_) => panic!("undo should fail when the store rejects the replay"),
        Err(error) => error,
    };
    assert!(matches!(error, WorkspaceError::Store(_)));
    assert!(workspace.font().glyph_id_by_name("A").is_some());

    // Repair the store; the handed-back entry must still be undoable.
    let font = workspace.font().clone();
    workspace.store_mut().replace_font_state(&font).unwrap();

    workspace
        .undo()
        .unwrap()
        .expect("failed undo should hand the entry back for retry");
    assert_eq!(workspace.font().glyph_count(), 0);
}

#[test]
fn failed_redo_replay_hands_the_entry_back_for_retry() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();
    let source_id = SourceId::from_raw("bold");
    let axis_id = create_weight_axis(&mut workspace);

    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::CreateSource {
                    source_id: source_id.clone(),
                    name: "Bold".to_string(),
                    location: weight_location(axis_id, 700.0),
                }],
            },
            None,
        )
        .unwrap();
    workspace
        .apply(
            FontIntentSet {
                intents: vec![FontIntent::DeleteSource {
                    source_id: source_id.clone(),
                }],
            },
            None,
        )
        .unwrap();
    workspace.undo().unwrap().expect("deleteSource should undo");

    // Wipe the store's font rows so the redo's SourceDeleted change has no
    // row to delete and the replay fails at the persistence step.
    workspace
        .store_mut()
        .replace_font_state(&shift_font::Font::new())
        .unwrap();

    let error = match workspace.redo() {
        Ok(_) => panic!("redo should fail when the store rejects the replay"),
        Err(error) => error,
    };
    assert!(matches!(error, WorkspaceError::Store(_)));
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .any(|source| source.id() == source_id)
    );

    // Repair the store; the handed-back entry must still be redoable.
    let font = workspace.font().clone();
    workspace.store_mut().replace_font_state(&font).unwrap();

    workspace
        .redo()
        .unwrap()
        .expect("failed redo should hand the entry back for retry");
    assert!(
        workspace
            .font()
            .sources()
            .iter()
            .all(|source| source.id() != source_id)
    );
}

#[test]
fn ledger_trims_oldest_entries_beyond_max() {
    let temp = tempfile::tempdir().unwrap();
    let store_path = temp.path().join("working.sqlite");
    let mut workspace = FontWorkspace::create_untitled(&store_path, NewWorkspace::new()).unwrap();

    // One entry more than the ledger's MAX_ENTRIES bound of 100.
    for index in 0..101 {
        create_glyph(&mut workspace, &format!("g{index}"), vec![]);
    }

    let mut undone = 0;
    while workspace.undo().unwrap().is_some() {
        undone += 1;
    }

    assert_eq!(undone, 100, "oldest entry should fall off the ledger");
    assert_eq!(workspace.font().glyph_count(), 1);
    assert!(workspace.font().glyph_id_by_name("g0").is_some());
}

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}
