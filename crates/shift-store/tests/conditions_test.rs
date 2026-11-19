//! Glyph swaps and component conditions in stored documents: they save and
//! reopen as they were, leave layer payloads as they were, a version 7
//! document upgrades with none, a version 8 document's alternates open as
//! swaps, and unsaved ones survive in the recovery overlay.

use std::path::{Path, PathBuf};

use shift_font::test_support::{conditions_font, sample_variable_font};
use shift_font::{
    Condition, DesignLocation, Font, FontChange, FontChangeSet, GlyphLayer, Replacement,
};
use shift_store::{RecoveryState, SHIFT_DOCUMENT_SCHEMA_VERSION, SaveState, ShiftStore};

mod support;

use support::{TestResult, payloads, without_tail};

/// A document path and its recovery overlay's, in a directory that lives as
/// long as the value.
struct DocumentPaths {
    _dir: tempfile::TempDir,
    document: PathBuf,
    recovery: PathBuf,
}

impl DocumentPaths {
    /// A document holding `font`.
    fn holding(font: &Font) -> TestResult<Self> {
        let dir = tempfile::tempdir()?;
        let paths = Self {
            document: dir.path().join("Dollar.shift"),
            recovery: dir.path().join("recovery.sqlite"),
            _dir: dir,
        };
        drop(ShiftStore::create_document(&paths.document, font)?);
        Ok(paths)
    }
}

/// What text draws for each glyph of `font` on a grid of Weight and Width,
/// as each contour's first x and the advance: what the font draws, not how
/// it stores it.
fn text_outlines(font: &Font) -> TestResult<Vec<(f64, Vec<f64>)>> {
    let weight = font.axis_id_by_tag("wght").ok_or("no Weight")?;
    let width = font.axis_id_by_tag("wdth").ok_or("no Width")?;
    let glyph_ids: Vec<_> = font.glyphs().map(shift_font::Glyph::id).collect();
    let mut drawn = Vec::new();
    for w in [400.0, 699.0, 700.0, 900.0] {
        for d in [100.0, 80.0, 50.0] {
            let location = DesignLocation::from([(weight, w), (width, d)]);
            for glyph in font.projection(&location).drawn_glyphs(&glyph_ids)? {
                let starts = glyph
                    .contours()
                    .iter()
                    .map(|contour| {
                        contour
                            .points
                            .first()
                            .map_or(f64::NAN, shift_font::Point::x)
                    })
                    .collect();
                drawn.push((glyph.x_advance(), starts));
            }
        }
    }
    Ok(drawn)
}

/// `H`'s one layer.
fn conditioned_h_layer(font: &Font) -> TestResult<&GlyphLayer> {
    let h = font.glyph_by_name("H").ok_or("no H")?;
    Ok(h.layers().values().next().ok_or("H has no layer")?)
}

#[test]
fn swaps_and_component_conditions_save_and_reopen_as_they_were() {
    let font = conditions_font();
    let paths = DocumentPaths::holding(&font).unwrap();

    let store = ShiftStore::open_document(&paths.document).unwrap();
    let reopened = store.load_font_state().unwrap();

    assert_eq!(reopened, font);
    assert_eq!(
        text_outlines(&reopened).unwrap(),
        text_outlines(&font).unwrap()
    );
    let h = conditioned_h_layer(&font).unwrap();
    assert_eq!(store.load_glyph_layer(h.id()).unwrap().as_ref(), Some(h));
}

#[test]
fn a_glyph_whose_swap_comes_later_in_glyph_order_reopens() {
    let mut font = conditions_font();
    let dollar = font
        .glyph_by_name("dollar")
        .ok_or("no dollar")
        .unwrap()
        .id();
    let later = font
        .insert_glyph(shift_font::Glyph::new("dollar.later"))
        .unwrap();
    let swap = shift_font::GlyphSwap::new(shift_font::SwapId::new(), Condition::always(), later);
    font.set_glyph_swaps(dollar, vec![swap]).unwrap();
    let paths = DocumentPaths::holding(&font).unwrap();

    let store = ShiftStore::open_document(&paths.document).unwrap();

    assert_eq!(store.load_font_state().unwrap(), font);
    assert_eq!(
        store
            .load_font_directory()
            .unwrap()
            .glyph(dollar)
            .unwrap()
            .swaps(),
        font.glyph(dollar).unwrap().swaps()
    );
}

#[test]
fn an_imported_font_keeps_its_swaps_and_component_conditions() {
    let font = conditions_font();
    let mut store = ShiftStore::open_memory_for_test().unwrap();

    let mut writer = store.begin_import(&font).unwrap();
    for glyph in font.glyphs() {
        writer.write_glyph(glyph).unwrap();
    }
    writer.finish().unwrap();

    assert_eq!(store.load_font_state().unwrap(), font);
}

#[test]
fn the_directory_has_every_glyphs_swaps() {
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    let font = conditions_font();
    store.replace_font_state(&font).unwrap();

    let directory = store.load_font_directory().unwrap();

    for glyph in font.glyphs() {
        assert_eq!(directory.glyph(glyph.id()).unwrap().swaps(), glyph.swaps());
    }
}

/// `font` with no component conditions.
fn without_conditions(font: &Font) -> TestResult<Font> {
    let mut layers = Vec::new();
    for layer in font.glyphs().flat_map(|glyph| glyph.layers().values()) {
        let mut layer = layer.as_ref().clone();
        for component in layer.components_iter_mut() {
            component.set_condition(Condition::always());
        }
        layers.push(layer);
    }
    let mut stripped = font.clone();
    stripped.replace_glyph_layers(layers)?;
    Ok(stripped)
}

#[test]
fn a_layer_payload_keeps_the_bytes_it_has_without_component_conditions() {
    let font = conditions_font();
    let with = DocumentPaths::holding(&font).unwrap();
    let without = DocumentPaths::holding(&without_conditions(&font).unwrap()).unwrap();

    assert_eq!(
        payloads(&with.document).unwrap(),
        payloads(&without.document).unwrap()
    );
}

/// Rewrites a current document into the version 7 shape: no swap or
/// component condition tables.
fn downgrade_to_version_7(path: &Path) -> TestResult<()> {
    rusqlite::Connection::open(path)?.execute_batch(
        "DROP TABLE glyph_component_conditions;
         DROP TABLE glyph_swap_conditions;
         DROP TABLE glyph_swaps;
         PRAGMA user_version = 7;",
    )?;
    Ok(())
}

/// The first column of each row `sql` reads from `path`, as text.
fn text_column(path: &Path, sql: &str) -> TestResult<Vec<String>> {
    let conn = rusqlite::Connection::open(path)?;
    let mut statement = conn.prepare(sql)?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// The names of the tables in `path` that hold swaps and conditions.
fn condition_tables(path: &Path) -> TestResult<Vec<String>> {
    text_column(
        path,
        "SELECT name FROM sqlite_master WHERE type = 'table'
           AND name IN ('glyph_swaps', 'glyph_swap_conditions', 'glyph_component_conditions')
         ORDER BY name",
    )
}

#[test]
fn a_version_7_document_upgrades_with_no_swaps_or_conditions_and_its_payloads_untouched() {
    let font = sample_variable_font();
    let paths = DocumentPaths::holding(&font).unwrap();
    downgrade_to_version_7(&paths.document).unwrap();
    let stored = payloads(&paths.document).unwrap();

    let store = ShiftStore::open_document(&paths.document).unwrap();
    let migrated = store.load_font_state().unwrap();
    drop(store);

    assert_eq!(migrated, font);
    assert!(migrated.glyphs().all(|glyph| glyph.swaps().is_empty()));
    assert_eq!(payloads(&paths.document).unwrap(), stored);
    let conn = rusqlite::Connection::open(&paths.document).unwrap();
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SHIFT_DOCUMENT_SCHEMA_VERSION);
    assert_eq!(
        condition_tables(&paths.document).unwrap(),
        [
            "glyph_component_conditions",
            "glyph_swap_conditions",
            "glyph_swaps"
        ]
    );
}

/// Rewrites a current document, or with `overlay` a recovery overlay, into
/// the version 8 shape nightly builds wrote: swaps stored as alternates, in
/// `glyph_alternates` and `glyph_alternate_conditions`, with `alternate_` ids.
fn downgrade_to_version_8(path: &Path, overlay: bool) -> TestResult<()> {
    let conn = rusqlite::Connection::open(path)?;
    conn.execute_batch(
        "ALTER TABLE glyph_swaps RENAME COLUMN swap_glyph_id TO alternate_glyph_id;
         ALTER TABLE glyph_swaps RENAME TO glyph_alternates;
         DROP INDEX glyph_swaps_glyph_id_idx;
         CREATE INDEX glyph_alternates_glyph_id_idx ON glyph_alternates(glyph_id);
         ALTER TABLE glyph_swap_conditions RENAME COLUMN swap_id TO alternate_id;
         ALTER TABLE glyph_swap_conditions RENAME TO glyph_alternate_conditions;
         DROP INDEX glyph_swap_conditions_glyph_id_idx;
         CREATE INDEX glyph_alternate_conditions_glyph_id_idx
             ON glyph_alternate_conditions(glyph_id);
         UPDATE glyph_alternates SET id = 'alternate_' || substr(id, 6);
         UPDATE glyph_alternate_conditions SET alternate_id = 'alternate_' || substr(alternate_id, 6);
         PRAGMA user_version = 8;",
    )?;
    if overlay {
        conn.execute_batch(
            "UPDATE recovery_replacements SET collection = 'glyph_alternates'
               WHERE collection = 'glyph_swaps';
             UPDATE recovery_replacements SET collection = 'glyph_alternate_conditions'
               WHERE collection = 'glyph_swap_conditions';",
        )?;
    }
    Ok(())
}

/// The ids stored in `path`'s `glyph_swaps`, in order.
fn stored_swap_ids(path: &Path) -> TestResult<Vec<String>> {
    text_column(
        path,
        "SELECT id FROM glyph_swaps ORDER BY glyph_id, order_index",
    )
}

#[test]
fn a_version_8_documents_alternates_open_as_its_swaps() {
    let font = conditions_font();
    let paths = DocumentPaths::holding(&font).unwrap();
    downgrade_to_version_8(&paths.document, false).unwrap();

    let store = ShiftStore::open_document(&paths.document).unwrap();
    let migrated = store.load_font_state().unwrap();
    drop(store);

    assert_eq!(migrated, font);
    assert_eq!(
        text_outlines(&migrated).unwrap(),
        text_outlines(&font).unwrap()
    );
    assert_eq!(
        stored_swap_ids(&paths.document).unwrap(),
        ["swap_compact-heavy", "swap_heavy"]
    );
    assert_eq!(
        condition_tables(&paths.document).unwrap(),
        [
            "glyph_component_conditions",
            "glyph_swap_conditions",
            "glyph_swaps"
        ]
    );
}

/// The change that drops `dollar`'s first swap from `saved`, and the font
/// it leads to.
fn without_first_swap_of_dollar(saved: &Font) -> TestResult<(FontChangeSet, Font)> {
    let before = saved.glyph_by_name("dollar").ok_or("no dollar")?.clone();
    let mut after = before.clone();
    after.set_swaps(
        after
            .swaps()
            .get(1..)
            .ok_or("dollar has no swaps")?
            .to_vec(),
    );
    let change = FontChangeSet::new(vec![FontChange::Glyph(Box::new(Replacement::new(
        Some(before),
        Some(after),
    )))]);
    let mut expected = saved.clone();
    expected.apply_change_set(&change)?;
    Ok((change, expected))
}

#[test]
fn unsaved_alternates_in_a_version_8_recovery_overlay_reopen_as_swaps() {
    let saved = conditions_font();
    let paths = DocumentPaths::holding(&saved).unwrap();
    let (change, expected) = without_first_swap_of_dollar(&saved).unwrap();
    let open = || ShiftStore::open_document_with_recovery(&paths.document, &paths.recovery);
    let mut store = open().unwrap();
    store
        .apply_change_set_with_font(&change, &expected, SaveState::Unsaved)
        .unwrap();
    drop(store);
    downgrade_to_version_8(&paths.document, false).unwrap();
    downgrade_to_version_8(&paths.recovery, true).unwrap();

    let recovered = open().unwrap();

    assert_eq!(
        recovered.recovery_state().unwrap(),
        Some(RecoveryState::Dirty)
    );
    assert_eq!(recovered.load_font_state().unwrap(), expected);
}

#[test]
fn an_upgraded_document_saves_swaps_and_component_conditions() {
    let (full, saved, added) = without_swap_and_condition_glyphs().unwrap();
    let paths = DocumentPaths::holding(&saved).unwrap();
    downgrade_to_version_7(&paths.document).unwrap();

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

/// The conditions font, the same font without its glyphs from `dollar` on
/// (the one with swaps, and those with component conditions), and the
/// change set that adds them back as unsaved edits.
fn without_swap_and_condition_glyphs() -> TestResult<(Font, Font, FontChangeSet)> {
    let full = conditions_font();
    let tail = ["U", "T", "mid", "HX", "H", "dollarcomp", "dollar"];
    let (saved, added) = without_tail(&full, &tail)?;
    Ok((full, saved, added))
}

/// What a document and its recovery overlay hold after an unsaved change
/// and a crash: the overlay's state and font on reopening, the document's
/// font then, and the overlay's state and font after saving and reopening.
#[derive(Debug, PartialEq)]
struct AfterCrash {
    recovered: (Option<RecoveryState>, Font),
    document: Font,
    saved: (Option<RecoveryState>, Font),
}

impl AfterCrash {
    /// What a crash leaves when the document held `saved` and the unsaved
    /// change led to `expected`.
    fn expected(saved: &Font, expected: &Font) -> Self {
        Self {
            recovered: (Some(RecoveryState::Dirty), expected.clone()),
            document: saved.clone(),
            saved: (Some(RecoveryState::Clean), expected.clone()),
        }
    }
}

/// Opens the document with its recovery overlay, applies `change` to it
/// unsaved, leading to `expected`, and drops it, as a crash would; then
/// reads what [`AfterCrash`] names.
fn after_a_crash(
    paths: &DocumentPaths,
    change: &FontChangeSet,
    expected: &Font,
) -> TestResult<AfterCrash> {
    let open = || ShiftStore::open_document_with_recovery(&paths.document, &paths.recovery);
    let mut store = open()?;
    store.apply_change_set_with_font(change, expected, SaveState::Unsaved)?;
    drop(store);

    let mut recovered = open()?;
    let recovered_state = (recovered.recovery_state()?, recovered.load_font_state()?);
    let document = ShiftStore::open_document(&paths.document)?.load_font_state()?;
    recovered.save_document()?;
    drop(recovered);
    let reopened = open()?;
    Ok(AfterCrash {
        recovered: recovered_state,
        document,
        saved: (reopened.recovery_state()?, reopened.load_font_state()?),
    })
}

#[test]
fn unsaved_swaps_and_component_conditions_survive_a_crash() {
    let (expected, saved, added) = without_swap_and_condition_glyphs().unwrap();
    let paths = DocumentPaths::holding(&saved).unwrap();

    assert_eq!(
        after_a_crash(&paths, &added, &expected).unwrap(),
        AfterCrash::expected(&saved, &expected)
    );
}

#[test]
fn an_unsaved_change_to_a_component_condition_survives_a_crash() {
    let saved = conditions_font();
    let paths = DocumentPaths::holding(&saved).unwrap();
    let before = conditioned_h_layer(&saved).unwrap().clone();
    let mut after = before.clone();
    for component in after.components_iter_mut() {
        component.set_condition(Condition::always());
    }
    let mut expected = saved.clone();
    expected.replace_glyph_layers(vec![after.clone()]).unwrap();
    let h = saved.glyph_id_by_name("H").unwrap();
    let change = FontChangeSet::new(vec![FontChange::Layer {
        glyph_id: h,
        layer: Replacement::new(Some(before.into()), Some(after.into())),
        structural: false,
    }]);

    assert_eq!(
        after_a_crash(&paths, &change, &expected).unwrap(),
        AfterCrash::expected(&saved, &expected)
    );
}

#[test]
fn an_unsaved_change_to_a_glyphs_swaps_survives_a_crash() {
    let saved = conditions_font();
    let paths = DocumentPaths::holding(&saved).unwrap();
    let (change, expected) = without_first_swap_of_dollar(&saved).unwrap();

    assert_eq!(
        after_a_crash(&paths, &change, &expected).unwrap(),
        AfterCrash::expected(&saved, &expected)
    );
}
