//! UFO's `public.glyphOrder` lib key, which Shift models as the order of a
//! font's glyphs rather than carrying it as lib data.

use std::collections::BTreeSet;

use shift_font::{LibData, LibValue};

/// The font lib key that lists a UFO's glyph names in order.
pub(crate) const GLYPH_ORDER_KEY: &str = "public.glyphOrder";

/// Returns `names` in the order the lib's `public.glyphOrder` lists them,
/// followed by every glyph it leaves out, by name, and removes the key from
/// `lib`.
///
/// Listed names that are not among `names` are skipped. A key whose value is
/// not an array is not a glyph order; it stays in `lib`, and the glyphs come
/// back by name.
pub(crate) fn take_glyph_order(
    lib: &mut LibData,
    names: impl IntoIterator<Item = String>,
) -> Vec<String> {
    let mut remaining: BTreeSet<String> = names.into_iter().collect();
    let Some(LibValue::Array(listed)) = lib.get(GLYPH_ORDER_KEY) else {
        return remaining.into_iter().collect();
    };

    let mut ordered = Vec::with_capacity(remaining.len());
    for value in listed {
        if let LibValue::String(name) = value
            && remaining.remove(name)
        {
            ordered.push(name.clone());
        }
    }
    ordered.extend(remaining);
    lib.remove(GLYPH_ORDER_KEY);
    ordered
}

/// The `public.glyphOrder` value listing `names` in order.
pub(crate) fn glyph_order_value<'a>(names: impl Iterator<Item = &'a str>) -> plist::Value {
    plist::Value::Array(
        names
            .map(|name| plist::Value::String(name.to_string()))
            .collect(),
    )
}
