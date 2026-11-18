//! Helpers the document tests share.

use std::collections::BTreeMap;
use std::path::Path;

use shift_font::{Font, FontChange, FontChangeSet, Replacement};

pub(crate) type TestResult<T> = Result<T, Box<dyn std::error::Error>>;

/// Every stored layer payload, by layer id, as its bytes.
pub(crate) fn payloads(path: &Path) -> TestResult<BTreeMap<String, Vec<u8>>> {
    let conn = rusqlite::Connection::open(path)?;
    let mut statement = conn.prepare("SELECT layer_id, payload FROM glyph_layer_payloads")?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// `full` without the glyphs `tail` names, taken off its end last first,
/// and the change set that adds them back as unsaved edits: what a font
/// that gained them since it was saved holds.
pub(crate) fn without_tail(full: &Font, tail: &[&str]) -> TestResult<(Font, FontChangeSet)> {
    let mut saved = full.clone();
    let mut changes = Vec::new();
    for name in tail {
        let glyph_id = saved.glyph_id_by_name(name).ok_or("no such glyph")?;
        let glyph = saved.pop_glyph(glyph_id)?;
        changes.insert(
            0,
            FontChange::Glyph(Box::new(Replacement::new(None, Some(glyph)))),
        );
    }
    Ok((saved, FontChangeSet::new(changes)))
}
