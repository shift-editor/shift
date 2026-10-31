//! Sibling order keys, as shift-font's `index_key` makes and orders them.

use pack::Pack;
use shift_font::index_key::{self, IndexKeyError};
use std::cmp::Ordering;
use wasm_bindgen::prelude::wasm_bindgen;

/// The keys that order a scene node among its siblings: `shift_font::index_key`.
#[pack::interface]
pub trait IndexKeys {
    /// A key after `before` and before `after`; `None` for the start or end of the list.
    fn between(
        &self,
        before: Option<String>,
        after: Option<String>,
    ) -> Result<String, IndexKeyFailure>;
    /// Orders two keys: -1 when `a` sorts first, 1 when `b` does, 0 when they are equal.
    fn compare(&self, a: String, b: String) -> i32;
}

/// Why [`IndexKeys::between`] could make no key. Each variant carries the
/// error's text as `detail`, which TypeScript's `PackError` ends its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub enum IndexKeyFailure {
    /// A key is not a fractional index.
    Invalid { detail: String },
    /// The two keys are equal, so nothing sorts between them.
    Equal { detail: String },
    /// The keys reach the end of the key space.
    Exhausted { detail: String },
}

impl From<IndexKeyError> for IndexKeyFailure {
    fn from(error: IndexKeyError) -> Self {
        let detail = error.to_string();
        match error {
            IndexKeyError::Invalid(_) => Self::Invalid { detail },
            IndexKeyError::Equal(_) => Self::Equal { detail },
            IndexKeyError::Exhausted(_) => Self::Exhausted { detail },
        }
    }
}

/// The key rules [`IndexKeys`] calls.
pub struct IndexKeyRules;

impl IndexKeys for IndexKeyRules {
    fn between(
        &self,
        before: Option<String>,
        after: Option<String>,
    ) -> Result<String, IndexKeyFailure> {
        Ok(index_key::between(before.as_deref(), after.as_deref())?)
    }

    fn compare(&self, a: String, b: String) -> i32 {
        match index_key::compare(&a, &b) {
            Ordering::Less => -1,
            Ordering::Equal => 0,
            Ordering::Greater => 1,
        }
    }
}

/// Runs one [`IndexKeys`] method for the editor's generated `IndexKeys` class.
#[wasm_bindgen(js_name = indexKeysRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        index_keys_request(&IndexKeyRules, method, input, blobs, names)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_and_orders_keys_as_shift_font_does() {
        let rules = IndexKeyRules;
        let first = rules.between(None, None).expect("a first key");
        let next = rules.between(Some(first.clone()), None).expect("a next key");

        assert_eq!((first.as_str(), next.as_str()), ("a0", "a1"));
        assert_eq!(rules.compare(first.clone(), next.clone()), -1);
        assert_eq!(rules.compare(next, first.clone()), 1);
        assert!(matches!(
            rules.between(Some(first.clone()), Some(first)),
            Err(IndexKeyFailure::Equal { .. })
        ));
    }
}
