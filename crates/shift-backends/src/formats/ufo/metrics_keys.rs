//! Metrics keys in a GLIF lib, under the names glyphsLib gives them.
//!
//! glyphsLib writes a glyph's keys into every one of its GLIFs as
//! `com.schriftgestaltung.glyph.<name>`, and a layer's own keys into that
//! layer's GLIF as `com.schriftgestaltung.layer.<name>`. Older glyphsLib wrote
//! `com.schriftgestaltung.<name>` without saying which; like glyphsLib, Shift
//! reads those as the layer's, with the `layer.` entry winning when both are
//! present.

use shift_font::{MetricsKey, MetricsKeySide, MetricsKeys};

const PREFIX: &str = "com.schriftgestaltung.";

/// The glyphsLib name of each side's key.
const NAMES: [(MetricsKeySide, &str); 3] = [
    (MetricsKeySide::Left, "leftMetricsKey"),
    (MetricsKeySide::Right, "rightMetricsKey"),
    (MetricsKeySide::Width, "widthMetricsKey"),
];

fn glyph_entry(name: &str) -> String {
    format!("{PREFIX}glyph.{name}")
}

fn layer_entry(name: &str) -> String {
    format!("{PREFIX}layer.{name}")
}

fn unscoped_entry(name: &str) -> String {
    format!("{PREFIX}{name}")
}

/// The keys one GLIF's lib holds.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct GlifMetricsKeys {
    /// Keys for the glyph in every source.
    pub(crate) glyph: MetricsKeys,
    /// Keys for this GLIF's layer only.
    pub(crate) layer: MetricsKeys,
}

/// Removes every metrics-key entry from `lib` and returns the keys they held.
///
/// An entry whose value is not text is left in the lib: it is not a key
/// glyphsLib wrote, so it is kept as ordinary lib data.
pub(crate) fn take_metrics_keys(lib: &mut plist::Dictionary) -> GlifMetricsKeys {
    let mut keys = GlifMetricsKeys::default();
    for (side, name) in NAMES {
        let glyph = take_key(lib, &glyph_entry(name));
        let unscoped = take_key(lib, &unscoped_entry(name));
        let layer = take_key(lib, &layer_entry(name)).or(unscoped);
        keys.glyph.set(side, glyph);
        keys.layer.set(side, layer);
    }
    keys
}

fn take_key(lib: &mut plist::Dictionary, entry: &str) -> Option<MetricsKey> {
    let text = lib.get(entry)?.as_string()?.to_owned();
    lib.remove(entry);
    MetricsKey::new(text)
}

/// Writes `glyph`'s and `layer`'s keys into a GLIF lib as glyphsLib does.
pub(crate) fn insert_metrics_keys(
    lib: &mut plist::Dictionary,
    glyph: &MetricsKeys,
    layer: &MetricsKeys,
) {
    for (side, name) in NAMES {
        if let Some(key) = glyph.get(side) {
            lib.insert(glyph_entry(name), plist::Value::String(key.to_string()));
        }
        if let Some(key) = layer.get(side) {
            lib.insert(layer_entry(name), plist::Value::String(key.to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(entries: &[(MetricsKeySide, &str)]) -> MetricsKeys {
        entries
            .iter()
            .map(|(side, text)| (*side, MetricsKey::new(*text).unwrap()))
            .collect()
    }

    fn lib(entries: &[(&str, plist::Value)]) -> plist::Dictionary {
        entries
            .iter()
            .map(|(entry, value)| ((*entry).to_owned(), value.clone()))
            .collect()
    }

    fn text(value: &str) -> plist::Value {
        plist::Value::String(value.to_owned())
    }

    #[test]
    fn takes_glyph_and_layer_keys_and_leaves_other_lib_data() {
        let mut glif_lib = lib(&[
            ("com.schriftgestaltung.glyph.leftMetricsKey", text("=n")),
            ("com.schriftgestaltung.glyph.rightMetricsKey", text("=n+10")),
            (
                "com.schriftgestaltung.layer.widthMetricsKey",
                text("==o*1.2"),
            ),
            ("public.markColor", text("1,0,0,1")),
        ]);

        let taken = take_metrics_keys(&mut glif_lib);

        assert_eq!(
            taken,
            GlifMetricsKeys {
                glyph: keys(&[
                    (MetricsKeySide::Left, "=n"),
                    (MetricsKeySide::Right, "=n+10"),
                ]),
                layer: keys(&[(MetricsKeySide::Width, "==o*1.2")]),
            }
        );
        assert_eq!(glif_lib, lib(&[("public.markColor", text("1,0,0,1"))]));
    }

    #[test]
    fn reads_an_unscoped_key_as_the_layers_unless_a_layer_key_is_present() {
        let mut glif_lib = lib(&[
            ("com.schriftgestaltung.leftMetricsKey", text("=|")),
            ("com.schriftgestaltung.rightMetricsKey", text("=o")),
            ("com.schriftgestaltung.layer.rightMetricsKey", text("=|n")),
        ]);

        let taken = take_metrics_keys(&mut glif_lib);

        assert_eq!(
            taken.layer,
            keys(&[(MetricsKeySide::Left, "=|"), (MetricsKeySide::Right, "=|n"),])
        );
        assert!(taken.glyph.is_empty());
        assert!(glif_lib.is_empty());
    }

    #[test]
    fn keeps_an_entry_that_is_not_text_as_lib_data() {
        let entry = "com.schriftgestaltung.glyph.leftMetricsKey";
        let mut glif_lib = lib(&[(entry, plist::Value::Integer(4.into()))]);

        let taken = take_metrics_keys(&mut glif_lib);

        assert_eq!(taken, GlifMetricsKeys::default());
        assert!(glif_lib.contains_key(entry));
    }

    #[test]
    fn written_keys_read_back_unchanged() {
        let glyph = keys(&[(MetricsKeySide::Left, "=n")]);
        let layer = keys(&[(MetricsKeySide::Right, "=|")]);
        let mut glif_lib = plist::Dictionary::new();

        insert_metrics_keys(&mut glif_lib, &glyph, &layer);

        assert_eq!(
            glif_lib,
            lib(&[
                ("com.schriftgestaltung.glyph.leftMetricsKey", text("=n")),
                ("com.schriftgestaltung.layer.rightMetricsKey", text("=|")),
            ])
        );
        assert_eq!(
            take_metrics_keys(&mut glif_lib),
            GlifMetricsKeys { glyph, layer }
        );
    }
}
