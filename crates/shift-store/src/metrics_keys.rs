//! The three metrics-key columns `glyphs` and `glyph_layers` both have.

use shift_font as font;

/// Each side's column name.
const COLUMNS: [(font::MetricsKeySide, &str); 3] = [
    (font::MetricsKeySide::Left, "left_metrics_key"),
    (font::MetricsKeySide::Right, "right_metrics_key"),
    (font::MetricsKeySide::Width, "width_metrics_key"),
];

/// The column value for `keys`'s key on `side`.
pub(crate) fn column(keys: &font::MetricsKeys, side: font::MetricsKeySide) -> Option<&str> {
    keys.get(side).map(font::MetricsKey::as_str)
}

/// The keys in `row`'s metrics-key columns, which it selects by name.
pub(crate) fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<font::MetricsKeys> {
    let mut keys = font::MetricsKeys::new();
    for (side, column) in COLUMNS {
        let text: Option<String> = row.get(column)?;
        keys.set(side, text.and_then(font::MetricsKey::new));
    }
    Ok(keys)
}
