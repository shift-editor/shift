//! The blobs a request carries beside its numbers, for the [`pack::Bytes`]
//! values it holds.
//!
//! A request export takes its blobs as one array, left out for a request
//! without bytes, so a call that carries none makes no call back into
//! JavaScript to read them. A reply's blobs wait here until the editor's
//! transport asks for them with `takeReplyBlobs`, which it does only for a
//! reply that reads bytes, so the per-frame calls that carry none pay for
//! no array.

use std::cell::RefCell;

use js_sys::{Array, Uint8Array};
use wasm_bindgen::prelude::*;

use crate::names::with_names;

thread_local! {
    static REPLY_BLOBS: RefCell<Vec<Vec<u8>>> = const { RefCell::new(Vec::new()) };
}

/// Runs `dispatch`, an interface's `<trait>_request`, with the request's
/// blobs copied into this module's memory and the module's name table; keeps
/// the reply's blobs for `takeReplyBlobs` and returns its numbers.
pub(crate) fn answer(
    blobs: Option<Array>,
    dispatch: impl FnOnce(Vec<Vec<u8>>, &mut dyn pack::Names) -> pack::Packed,
) -> Vec<f64> {
    let blobs = request_blobs(blobs);
    let reply = with_names(|names| dispatch(blobs, names));
    // Most replies carry no bytes and find none kept; they touch nothing.
    if !reply.blobs.is_empty() || REPLY_BLOBS.with_borrow(|kept| !kept.is_empty()) {
        REPLY_BLOBS.with_borrow_mut(|kept| *kept = reply.blobs);
    }
    reply.numbers
}

/// Each blob as bytes in this module's memory; a value that is not a
/// `Uint8Array` reads as empty.
fn request_blobs(blobs: Option<Array>) -> Vec<Vec<u8>> {
    let Some(blobs) = blobs else {
        return Vec::new();
    };
    blobs
        .iter()
        .map(|blob| {
            blob.dyn_ref::<Uint8Array>()
                .map(Uint8Array::to_vec)
                .unwrap_or_default()
        })
        .collect()
}

/// Takes the latest reply's blobs, in order; empty once taken.
#[wasm_bindgen(js_name = takeReplyBlobs, unchecked_return_type = "Uint8Array[]")]
pub fn take_reply_blobs() -> Array {
    REPLY_BLOBS
        .with_borrow_mut(std::mem::take)
        .iter()
        .map(|blob| JsValue::from(Uint8Array::from(&blob[..])))
        .collect()
}
