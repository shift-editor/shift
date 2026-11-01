//! Sibling order keys, as shift-font's `index_key` makes them. Keys compare as
//! plain strings, so ordering them needs no call.

use pack::Pack;
use shift_font::index_key::{self, IndexKeyError};
use wasm_bindgen::prelude::wasm_bindgen;

/// Makes the keys that order a scene node among its siblings: `shift_font::index_key`.
#[pack::interface]
pub trait IndexKeys {
    /// A key after `before` and before `after`; `None` for the start or end of the list.
    ///
    /// # Errors
    ///
    /// Returns [`IndexKeyFailure`] when a key is malformed, or `before` does
    /// not sort before `after`.
    fn between(
        &self,
        before: Option<String>,
        after: Option<String>,
    ) -> Result<String, IndexKeyFailure>;
}

/// Why [`IndexKeys::between`] could make no key. Each variant carries the
/// error's text as `detail`, which TypeScript's `PackError` ends its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub enum IndexKeyFailure {
    /// A key is not a fractional index.
    Invalid { detail: String },
    /// The keys are equal or out of order, so nothing sorts between them.
    Unordered { detail: String },
}

impl From<IndexKeyError> for IndexKeyFailure {
    fn from(error: IndexKeyError) -> Self {
        let detail = error.to_string();
        match error {
            IndexKeyError::Invalid(_) => Self::Invalid { detail },
            IndexKeyError::Unordered { .. } => Self::Unordered { detail },
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
    fn makes_keys_as_shift_font_does() {
        let rules = IndexKeyRules;
        let first = rules.between(None, None).expect("a first key");
        let next = rules
            .between(Some(first.clone()), None)
            .expect("a next key");

        assert!(first < next);
        assert!(matches!(
            rules.between(Some(next), Some(first)),
            Err(IndexKeyFailure::Unordered { .. })
        ));
    }
}
