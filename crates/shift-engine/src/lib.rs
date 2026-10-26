//! Shift's editing session over a partly loaded font.
//!
//! A session holds the whole font directory, with layer content loaded on
//! demand through a synchronous [`LayerSource`], and applies edits with
//! shift-font. Before an edit it works out what the edit reads, loads what is
//! missing, and then applies, so an edit never waits on anything asynchronous.
//! The native workspace reads from its store and the renderer reads through a
//! native reader in its preload; both run this same code. It depends only on
//! shift-font, so it builds for WebAssembly.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod history;
mod residency;
mod session;
mod source;

pub use history::EditHistory;
pub use residency::LayerResidency;
pub use session::{ApplyError, EngineError, EngineSession, LoadError, StagedEdit};
pub use source::LayerSource;
