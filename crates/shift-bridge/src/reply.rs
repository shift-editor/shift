//! How a packed request crosses napi: one request export per interface,
//! taking the method's index, its numbers and its blobs, and returning the
//! reply's.
//!
//! napi only carries the message; the interface's `<trait>_request` decodes
//! it and encodes the result. Every message carries the names it uses as its
//! last blob ([`pack::CarriedNames`]), since JavaScript and this addon share
//! no name table.

use napi::Env;
use napi::bindgen_prelude::{BufferSlice, Float64Array, Float64ArraySlice, Uint8ArraySlice};
use napi_derive::napi;
use pack::{Names, Packed};

/// An interface's reply: its numbers, and its blobs, the last of them the
/// names it uses.
#[napi(object, object_from_js = false)]
pub struct PackedReply<'env> {
  pub numbers: Float64Array,
  #[napi(ts_type = "Uint8Array[]")]
  pub blobs: Vec<BufferSlice<'env>>,
}

/// Answers one request with `dispatch`, an interface's `<trait>_request`
/// bound to its target and method.
///
/// The request is read in place, and the reply copied once into JavaScript
/// memory: an external buffer costs more than copying a small reply, and
/// Electron's V8 sandbox refuses external buffers, so napi would copy them
/// anyway.
///
/// # Errors
///
/// Fails only when JavaScript cannot allocate the reply.
pub(crate) fn answer<'env>(
  env: &'env Env,
  numbers: &Float64ArraySlice<'_>,
  blobs: &[Uint8ArraySlice<'_>],
  dispatch: impl FnOnce(&[f64], Vec<Vec<u8>>, &mut dyn Names) -> Packed,
) -> napi::Result<PackedReply<'env>> {
  let request = Packed {
    numbers: numbers.to_vec(),
    blobs: blobs.iter().map(|blob| blob.to_vec()).collect(),
  };
  let reply = request.answer_carrying_names(dispatch);
  Ok(PackedReply {
    numbers: reply.numbers.into(),
    blobs: reply
      .blobs
      .iter()
      .map(|blob| BufferSlice::copy_from(env, blob))
      .collect::<napi::Result<_>>()?,
  })
}
