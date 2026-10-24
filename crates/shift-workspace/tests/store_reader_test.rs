//! A read-only reader beside a live workspace sees what the workspace has
//! written, unsaved edits included, as the renderer's preload will.

use shift_font::test_support::fixtures;
use shift_font::{FontIntentSet, Glyph, GlyphId, GlyphLayer, MovePoints};
use shift_store::StoreReader;
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

/// A saved document opened with a recovery overlay, every layer loaded.
fn open_document(dir: &TempDir) -> (FontWorkspace, std::path::PathBuf, std::path::PathBuf) {
    let path = dir.path().join("Homenaje.shift");
    let recovery = dir.path().join("recovery.sqlite");
    let mut imported = FontWorkspace::open(
        fixtures::font("Homenaje.glyphs"),
        dir.path().join("import.sqlite"),
    )
    .unwrap();
    imported
        .save_as_document(&path, dir.path().join("save-recovery.sqlite"))
        .unwrap();
    drop(imported);
    let mut workspace = FontWorkspace::open_document(&path, &recovery).unwrap();
    workspace.acquire_all_layers().unwrap();
    (workspace, path, recovery)
}

fn drawn_layer(workspace: &FontWorkspace) -> GlyphLayer {
    workspace
        .font()
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .find(|layer| layer.contours_iter().next().is_some())
        .map(|layer| GlyphLayer::clone(layer))
        .unwrap()
}

fn read(reader: &StoreReader, layer: &GlyphLayer) -> GlyphLayer {
    reader
        .load_glyph_layers(&[layer.id()])
        .unwrap()
        .pop()
        .unwrap()
}

#[test]
fn a_reader_sees_the_workspaces_unsaved_edits_as_they_are_written() {
    let dir = TempDir::new().unwrap();
    let (mut workspace, path, recovery) = open_document(&dir);
    let layer = drawn_layer(&workspace);
    let reader = StoreReader::open_document(&path, &recovery).unwrap();
    assert_eq!(read(&reader, &layer), layer);

    let point = layer.contours_iter().next().unwrap().points()[0].clone();
    workspace
        .apply(
            &FontIntentSet::from(shift_font::FontIntent::from(MovePoints {
                layer_id: layer.id(),
                point_ids: vec![point.id()],
                coords: vec![point.x() + 25.0, point.y()],
            })),
            None,
        )
        .unwrap();
    let edited = workspace.font().layer(&layer.id()).unwrap().clone();
    assert_ne!(edited, layer);
    assert_eq!(read(&reader, &layer), edited, "unsaved edit");

    workspace.save().unwrap();
    assert_eq!(read(&reader, &layer), edited, "after Save");
}

#[test]
fn a_reader_answers_component_questions_as_the_writer_does() {
    let dir = TempDir::new().unwrap();
    let (workspace, path, recovery) = open_document(&dir);
    let reader = StoreReader::open_document(&path, &recovery).unwrap();
    let composites: Vec<&Glyph> = workspace
        .font()
        .glyphs()
        .filter(|glyph| {
            glyph
                .layers()
                .values()
                .any(|layer| layer.components_iter().next().is_some())
        })
        .collect();
    assert!(!composites.is_empty());

    let roots: Vec<GlyphId> = composites.iter().map(|glyph| glyph.id()).collect();
    assert_eq!(
        reader
            .referenced_glyph_closure(roots.iter().cloned())
            .unwrap(),
        workspace.store().referenced_glyph_closure(roots).unwrap()
    );

    let base_layers: Vec<_> = composites
        .iter()
        .flat_map(|glyph| glyph.layers().values())
        .flat_map(|layer| {
            layer
                .components_iter()
                .map(shift_font::Component::base_glyph_id)
        })
        .filter_map(|base| workspace.font().glyph(&base))
        .flat_map(Glyph::layer_ids)
        .collect();
    assert_eq!(
        reader.dependent_glyph_ids_for_layers(&base_layers).unwrap(),
        workspace
            .store()
            .dependent_glyph_ids_for_layers(&base_layers)
            .unwrap()
    );
}
