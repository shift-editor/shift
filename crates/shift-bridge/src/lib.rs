#![allow(
  clippy::needless_pass_by_value,
  reason = "NAPI exports take owned arguments"
)]

mod bridge;
// Public so the compiler sees the napi exports as the crate's interface; nothing else calls them.
pub mod config;
mod errors;
mod input;
// Public so the compiler sees the napi exports as the crate's interface; nothing else calls them.
pub mod layer_reader;
mod reply;
// Public so the compiler sees the napi exports as the crate's interface; nothing else calls them.
pub mod source_reader;
mod specimen;
mod wire_napi;
