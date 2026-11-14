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

#[cfg(test)]
mod tests {
    use super::*;

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|name| (*name).to_string()).collect()
    }

    fn lib_with_order(order: &[&str]) -> LibData {
        let mut lib = LibData::new();
        lib.set(
            GLYPH_ORDER_KEY.to_string(),
            LibValue::Array(
                order
                    .iter()
                    .map(|name| LibValue::String((*name).to_string()))
                    .collect(),
            ),
        );
        lib
    }

    #[test]
    fn listed_glyphs_come_first_in_order_then_the_rest_by_name() {
        let mut lib = lib_with_order(&["space", "missing", "b"]);

        let order = take_glyph_order(&mut lib, names(&["a", "b", "c", "space"]));

        assert_eq!(order, names(&["space", "b", "a", "c"]));
        assert!(lib.get(GLYPH_ORDER_KEY).is_none());
    }

    #[test]
    fn without_a_glyph_order_glyphs_come_by_name() {
        let mut lib = LibData::new();
        lib.set(GLYPH_ORDER_KEY.to_string(), LibValue::String("b a".into()));

        let order = take_glyph_order(&mut lib, names(&["b", "a"]));

        assert_eq!(order, names(&["a", "b"]));
        assert!(lib.get(GLYPH_ORDER_KEY).is_some());
    }
}
