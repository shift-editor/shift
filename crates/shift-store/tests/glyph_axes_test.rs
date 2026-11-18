//! Glyph axes and drawings off the font's sources in stored documents: they
//! save and reopen as they were, a version 6 document upgrades with every
//! layer on its source, and unsaved ones survive in the recovery overlay.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use shift_font::test_support::{glyph_axis_font, sample_variable_font};
use shift_font::{
    AxisId, DesignLocation, Font, FontChange, FontChangeSet, GlyphLayer, LayerId, Replacement,
    SourceId,
};
use shift_store::{RecoveryState, SHIFT_DOCUMENT_SCHEMA_VERSION, SaveState, ShiftStore};

type TestResult<T> = Result<T, Box<dyn std::error::Error>>;

/// A glyph drawn somewhere: each contour as its points.
type Outline = Vec<Vec<(f64, f64)>>;

/// A document path and its recovery overlay's, in a directory that lives as
/// long as the value.
struct DocumentPaths {
    _dir: tempfile::TempDir,
    document: PathBuf,
    recovery: PathBuf,
}

impl DocumentPaths {
    fn new() -> TestResult<Self> {
        let dir = tempfile::tempdir()?;
        Ok(Self {
            document: dir.path().join("Solenoid.shift"),
            recovery: dir.path().join("recovery.sqlite"),
            _dir: dir,
        })
    }

    /// A document holding `font`.
    fn holding(font: &Font) -> TestResult<Self> {
        let paths = Self::new()?;
        drop(ShiftStore::create_document(&paths.document, font)?);
        Ok(paths)
    }
}

/// The id of the font or glyph axis tagged `tag`.
fn axis_by_tag(font: &Font, tag: &str) -> TestResult<AxisId> {
    let font_axes = font.axes().iter().map(|axis| (axis.id(), axis.tag()));
    let glyph_axes = font
        .glyphs()
        .flat_map(|glyph| glyph.axes().iter().map(|axis| (axis.id(), axis.tag())));
    let (axis_id, _) = font_axes
        .chain(glyph_axes)
        .find(|(_, axis_tag)| *axis_tag == tag)
        .ok_or("no such axis")?;
    Ok(axis_id)
}

/// `glyph`'s outline at each of a grid of Bleed, Spread and Strike values,
/// as points: what the font draws, not how it stores it.
fn outlines(font: &Font, glyph: &str) -> TestResult<Vec<Outline>> {
    let (bleed, spread, strike) = (
        axis_by_tag(font, "BLED")?,
        axis_by_tag(font, "SPRD")?,
        axis_by_tag(font, "STRK")?,
    );
    let glyph_id = font.glyph_id_by_name(glyph).ok_or("no such glyph")?;
    let mut drawn = Vec::new();
    for b in [0.0, 25.0, 50.0, 75.0, 100.0] {
        for s in [0.0, 60.0, 100.0] {
            for k in [0.0, 100.0] {
                let location = DesignLocation::from([(bleed, b), (spread, s), (strike, k)]);
                let mut projection = font.projection(&location);
                let resolved = projection.glyph(glyph_id)?.ok_or("nothing drawn")?;
                drawn.push(
                    resolved
                        .contours()
                        .iter()
                        .map(|contour| {
                            contour
                                .points
                                .iter()
                                .map(|point| (point.x(), point.y()))
                                .collect()
                        })
                        .collect(),
                );
            }
        }
    }
    Ok(drawn)
}

/// `H`'s drawing at Bleed 50, which has no base source.
fn brace_layer(font: &Font) -> TestResult<LayerId> {
    let h = font.glyph_by_name("H").ok_or("no H")?;
    let brace = h
        .layers()
        .values()
        .find(|layer| layer.source_id().is_none())
        .ok_or("no brace layer")?;
    Ok(brace.id())
}

#[test]
fn glyph_axes_and_drawings_off_the_sources_save_and_reopen_as_they_were() {
    let font = glyph_axis_font();
    let paths = DocumentPaths::holding(&font).unwrap();

    let store = ShiftStore::open_document(&paths.document).unwrap();
    let reopened = store.load_font_state().unwrap();

    assert_eq!(reopened, font);
    assert_eq!(
        outlines(&reopened, "dot").unwrap(),
        outlines(&font, "dot").unwrap()
    );
    assert_eq!(
        outlines(&reopened, "H").unwrap(),
        outlines(&font, "H").unwrap()
    );
    let brace_id = brace_layer(&font).unwrap();
    let brace = store.load_glyph_layer(brace_id).unwrap().unwrap();
    assert_eq!(brace.source_id(), None);
    assert_eq!(brace.location(), font.layer(brace_id).unwrap().location());
}

#[test]
fn the_directory_places_each_drawing_without_reading_its_content() {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let font = glyph_axis_font();
    store.replace_font_state(&font).unwrap();

    let directory = store.load_font_directory().unwrap();

    for glyph in font.glyphs() {
        let placed = directory.glyph(glyph.id()).unwrap();
        assert_eq!(placed.axes(), glyph.axes());
        for layer in glyph.layers().values() {
            let placeholder = placed.layer(layer.id()).unwrap();
            assert_eq!(placeholder.location(), layer.location(), "{}", layer.id());
        }
    }
}

#[test]
fn a_glyph_that_loses_a_drawing_off_the_sources_stores_without_it() {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let font = glyph_axis_font();
    store.replace_font_state(&font).unwrap();
    let before = font.glyph_by_name("H").unwrap().clone();
    let mut after = before.clone();
    after.remove_layer(brace_layer(&font).unwrap());
    let change = FontChange::Glyph(Box::new(Replacement::new(
        Some(before),
        Some(after.clone()),
    )));

    store
        .apply_change_set(&FontChangeSet::new(vec![change]))
        .unwrap();

    let loaded = store.load_font_state().unwrap();
    assert_eq!(loaded.glyph(after.id()), Some(&after));
}

/// The payload bytes of the one layer in `path`, when stored uncompressed.
fn uncompressed_payload(path: &Path) -> TestResult<Vec<u8>> {
    let conn = rusqlite::Connection::open(path)?;
    Ok(conn.query_row(
        "SELECT payload FROM glyph_layer_payloads WHERE compression = 'none'",
        [],
        |row| row.get(0),
    )?)
}

#[test]
fn a_layer_on_a_source_keeps_the_payload_bytes_it_had_before_locations() {
    let mut font = Font::new();
    let source_id = font.default_source_id().unwrap();
    let layer_id = LayerId::from_raw("layer_a");
    let mut glyph = shift_font::Glyph::new("a");
    glyph.set_layer(GlyphLayer::with_width(layer_id, source_id, 500.0));
    font.insert_glyph(glyph).unwrap();
    let paths = DocumentPaths::holding(&font).unwrap();

    // A layer's fields in order, as written when the second held its source id.
    let before_locations = rmp_serde::to_vec(&(
        layer_id,
        source_id,
        500.0_f64,
        None::<f64>,
        Vec::<shift_font::Contour>::new(),
        Vec::<shift_font::Component>::new(),
        Vec::<shift_font::Anchor>::new(),
        Vec::<shift_font::Guideline>::new(),
        shift_font::LibData::new(),
    ))
    .unwrap();
    assert_eq!(
        uncompressed_payload(&paths.document).unwrap(),
        before_locations
    );
}

/// Rewrites a current document into the version 6 shape: no glyph axes, no
/// layer coordinates, and every layer's source required.
fn downgrade_to_version_6(path: &Path) -> TestResult<()> {
    rusqlite::Connection::open(path)?.execute_batch(
        "PRAGMA foreign_keys = OFF;
         BEGIN;
         DROP TABLE glyph_layer_locations;
         DROP TABLE glyph_axes;
         CREATE TABLE glyph_layers_v6 (
             id TEXT PRIMARY KEY,
             glyph_id TEXT NOT NULL,
             source_id TEXT NOT NULL,
             width REAL NOT NULL DEFAULT 0,
             height REAL,
             left_metrics_key TEXT,
             right_metrics_key TEXT,
             width_metrics_key TEXT,
             FOREIGN KEY (glyph_id) REFERENCES glyphs(id) ON DELETE CASCADE,
             FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
         );
         INSERT INTO glyph_layers_v6 SELECT * FROM glyph_layers;
         DROP TABLE glyph_layers;
         ALTER TABLE glyph_layers_v6 RENAME TO glyph_layers;
         CREATE INDEX glyph_layers_glyph_id_idx ON glyph_layers(glyph_id);
         CREATE INDEX glyph_layers_source_id_idx ON glyph_layers(source_id);
         PRAGMA user_version = 6;
         COMMIT;",
    )?;
    Ok(())
}

/// What the schema of `path` says: its version, and whether a layer must
/// have a source.
fn schema_facts(path: &Path) -> TestResult<(i64, bool)> {
    let conn = rusqlite::Connection::open(path)?;
    let version = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let source_required = conn.query_row(
        "SELECT \"notnull\" FROM pragma_table_info('glyph_layers') WHERE name = 'source_id'",
        [],
        |row| row.get(0),
    )?;
    Ok((version, source_required))
}

/// Every stored layer payload, by layer id, as its bytes.
fn payloads(path: &Path) -> TestResult<BTreeMap<String, Vec<u8>>> {
    let conn = rusqlite::Connection::open(path)?;
    let mut statement = conn.prepare("SELECT layer_id, payload FROM glyph_layer_payloads")?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[test]
fn a_version_6_document_upgrades_with_every_layer_on_its_source_and_nothing_else_changed() {
    let font = sample_variable_font();
    let paths = DocumentPaths::holding(&font).unwrap();
    downgrade_to_version_6(&paths.document).unwrap();
    assert_eq!(schema_facts(&paths.document).unwrap(), (6, true));
    let stored = payloads(&paths.document).unwrap();

    let store = ShiftStore::open_document(&paths.document).unwrap();
    let migrated = store.load_font_state().unwrap();
    drop(store);

    assert_eq!(migrated, font);
    for layer in migrated.glyphs().flat_map(|glyph| glyph.layers().values()) {
        let on_its_source = layer
            .source_id()
            .is_some_and(|source_id: SourceId| layer.is_at_source(source_id));
        assert!(on_its_source, "{}", layer.id());
    }
    assert!(migrated.glyphs().all(|glyph| glyph.axes().is_empty()));
    assert_eq!(
        payloads(&paths.document).unwrap(),
        stored,
        "no payload is rewritten"
    );
    assert_eq!(
        schema_facts(&paths.document).unwrap(),
        (SHIFT_DOCUMENT_SCHEMA_VERSION, false)
    );
}

/// The glyph-axis font, the same font without `dot` and `H`, and the change
/// set that adds them back: glyphs with axes and drawings off the sources,
/// as unsaved edits.
fn without_dot_and_h() -> TestResult<(Font, Font, FontChangeSet)> {
    let full = glyph_axis_font();
    let mut saved = full.clone();
    let mut changes = Vec::new();
    for name in ["H", "dot"] {
        let glyph_id = saved.glyph_id_by_name(name).ok_or("no such glyph")?;
        let glyph = saved.pop_glyph(glyph_id)?;
        changes.insert(
            0,
            FontChange::Glyph(Box::new(Replacement::new(None, Some(glyph)))),
        );
    }
    Ok((full, saved, FontChangeSet::new(changes)))
}

#[test]
fn an_upgraded_document_saves_a_drawing_with_no_source() {
    let (full, saved, added) = without_dot_and_h().unwrap();
    let paths = DocumentPaths::holding(&saved).unwrap();
    downgrade_to_version_6(&paths.document).unwrap();

    let mut store =
        ShiftStore::open_document_with_recovery(&paths.document, &paths.recovery).unwrap();
    store
        .apply_change_set_with_font(&added, &full, SaveState::Unsaved)
        .unwrap();
    store.save_document().unwrap();
    drop(store);

    let reopened = ShiftStore::open_document(&paths.document).unwrap();
    assert_eq!(reopened.load_font_state().unwrap(), full);
}

#[test]
fn unsaved_glyph_axes_and_drawings_off_the_sources_survive_a_crash() {
    let (expected, saved, added) = without_dot_and_h().unwrap();
    let paths = DocumentPaths::holding(&saved).unwrap();
    let open = || ShiftStore::open_document_with_recovery(&paths.document, &paths.recovery);

    let mut store = open().unwrap();
    store
        .apply_change_set_with_font(&added, &expected, SaveState::Unsaved)
        .unwrap();
    drop(store);

    let mut recovered = open().unwrap();
    assert_eq!(
        recovered.recovery_state().unwrap(),
        Some(RecoveryState::Dirty)
    );
    assert_eq!(recovered.load_font_state().unwrap(), expected);
    let document = ShiftStore::open_document(&paths.document).unwrap();
    assert_eq!(
        document.load_font_state().unwrap(),
        saved,
        "unchanged until saved"
    );
    drop(document);

    recovered.save_document().unwrap();
    drop(recovered);
    let reopened = open().unwrap();
    assert_eq!(
        reopened.recovery_state().unwrap(),
        Some(RecoveryState::Clean)
    );
    assert_eq!(reopened.load_font_state().unwrap(), expected);
}
