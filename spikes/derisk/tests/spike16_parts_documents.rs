//! Spike 16: parts in real documents. A version-3 `.shift` document is upgraded
//! on open; a part and two composites are added as unsaved edits; the app
//! "crashes"; recovery brings them back exactly; save and reopen keep them.
//!
//! `cargo test --release --test spike16_parts_documents -- --nocapture`

use std::collections::BTreeMap;

use shift_font::{
    AxisId, AxisInheritance, Component, ComponentLocation, Contour, DecomposedTransform, Font, FontChange, FontChangeSet, Glyph, GlyphAxis, GlyphId, GlyphLayer, LayerId, LayerLocation,
    PointType, Replacement,
};
use shift_store::ShiftStore;
use shift_workspace::FontWorkspace;

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

fn stroke() -> AxisId {
    AxisId::from_raw("stroke")
}

fn rect(x1: f64) -> Contour {
    let mut contour = Contour::new();
    for (x, y) in [(0.0, 0.0), (x1, 0.0), (x1, 700.0), (0.0, 700.0)] {
        contour.add_point(x, y, PointType::OnCurve, false);
    }
    contour.close();
    contour
}

fn part(font: &Font) -> Glyph {
    let default = font.default_source_id().unwrap();
    let mut glyph = Glyph::with_id(GlyphId::from_raw("part_stem"), "part.stem");
    glyph.set_axes(vec![GlyphAxis { id: stroke(), tag: "STRK".into(), name: "Stroke".into(), minimum: 0.0, default: 0.0, maximum: 100.0 }]);
    let mut thin = GlyphLayer::with_width(LayerId::from_raw("stem_thin"), default.clone(), 200.0);
    thin.add_contour(rect(40.0));
    let mut thick = GlyphLayer::with_width(LayerId::from_raw("stem_thick"), default, 200.0);
    thick.add_contour(rect(120.0));
    thick.set_location(LayerLocation(BTreeMap::from([(stroke(), 100.0)])));
    glyph.set_layer(thin);
    glyph.set_layer(thick);
    glyph
}

fn composite(font: &Font, id: &str, inheritance: AxisInheritance) -> Glyph {
    let wght = font.axes().iter().find(|a| a.tag() == "wght").unwrap().id();
    let mut glyph = Glyph::with_id(GlyphId::from_raw(id), id);
    for source in font.masters() {
        let t = source.location().get(&wght).unwrap_or(0.0) / 1000.0;
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("{id}_{}", source.id())), source.id(), 600.0);
        let mut component = Component::with_id(
            shift_font::ComponentId::from_raw(format!("{id}_c_{}", source.id())),
            GlyphId::from_raw("part_stem"),
            "part.stem",
            DecomposedTransform::from_values([100.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
        );
        component.set_location(ComponentLocation(BTreeMap::from([(stroke(), 100.0 * t)])));
        component.set_inheritance(inheritance);
        layer.add_component(component);
        glyph.set_layer(layer);
    }
    glyph
}

fn user_version(path: &std::path::Path) -> i64 {
    rusqlite::Connection::open(path).unwrap().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
}

#[test]
fn parts_survive_migration_crash_recovery_and_save() {
    let temp = tempfile::tempdir().unwrap();
    let document = temp.path().join("Mutator.shift");
    let recovery = temp.path().join("recovery.sqlite");

    // A version-3 document: today's document minus the v4 additions.
    let mut imported = FontWorkspace::open(MUTATOR, temp.path().join("import.sqlite")).unwrap();
    imported.acquire_all_layers().unwrap();
    let base = imported.font().clone();
    drop(ShiftStore::create_document(&document, &base).unwrap());
    rusqlite::Connection::open(&document)
        .unwrap()
        .execute_batch("DROP TABLE glyph_axes; ALTER TABLE glyph_layers DROP COLUMN location_json; PRAGMA user_version = 3;")
        .unwrap();
    assert_eq!(user_version(&document), 3);

    // Open upgrades it; add the part and composites as unsaved edits.
    let mut workspace = FontWorkspace::open_document(&document, &recovery).unwrap();
    eprintln!("opened a v3 document: now v{}", user_version(&document));
    assert_eq!(user_version(&document), 4);
    workspace.acquire_all_layers().unwrap();
    let font = workspace.font().clone();
    let glyphs = [part(&font), composite(&font, "H_part", AxisInheritance::Parent), composite(&font, "T_part", AxisInheritance::Font)];
    let changes = glyphs.iter().map(|g| FontChange::Glyph(Box::new(Replacement { before: None, after: Some(g.clone()) }))).collect();
    workspace.persist_change_set(FontChangeSet::new(changes), true).unwrap();
    let expected: Vec<Glyph> = glyphs.iter().map(|g| workspace.font().glyph(&g.id()).unwrap().clone()).collect();

    // Crash: drop without saving. Recovery restores the unsaved parts.
    drop(workspace);
    let mut recovered = FontWorkspace::open_document(&document, &recovery).unwrap();
    recovered.acquire_all_layers().unwrap();
    eprintln!("after the crash: dirty {}", recovered.is_dirty().unwrap());
    for glyph in &expected {
        let back = recovered.font().glyph(&glyph.id()).cloned();
        eprintln!("  recovered {}: {}", glyph.name(), back.as_ref() == Some(glyph));
        assert_eq!(back.as_ref(), Some(glyph));
    }

    // Save, reopen clean, still exact.
    recovered.save().unwrap();
    drop(recovered);
    let mut saved = FontWorkspace::open_document(&document, &recovery).unwrap();
    saved.acquire_all_layers().unwrap();
    eprintln!("after save and reopen: dirty {}", saved.is_dirty().unwrap());
    assert!(!saved.is_dirty().unwrap());
    for glyph in &expected {
        assert_eq!(saved.font().glyph(&glyph.id()), Some(glyph), "{} after save", glyph.name());
    }
    eprintln!("  saved and reopened: all three exact");
}
