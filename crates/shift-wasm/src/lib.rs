//! Shift's shared Rust rules for the editor, compiled to WebAssembly.
//!
//! The editor runs these synchronously inside reactive computeds, where the
//! native bridge, which is asynchronous, cannot. Each module calls the same
//! code the workspace and export use, so there is one implementation.
//!
//! Cold values that cross the boundary are typed with `tsify`, which
//! generates their TypeScript types. Hot calls are [`pack::interface`]
//! traits, one request export each, whose values cross packed into flat
//! number arrays; the editor's side is generated from them, and strings cross
//! once each, as interned ids ([`names`]).

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]
#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned arguments"
)]
#![allow(
    unreachable_pub,
    reason = "wasm-bindgen exports items from private modules; their `pub` is the export"
)]

pub mod anchors;
pub mod decomposition;
pub mod drag;
#[cfg(feature = "engine")]
pub mod engine;
pub mod engine_reads;
pub mod geometry;
pub mod names;
mod numbers;
#[cfg(feature = "reference")]
pub mod reference;
pub mod shaping;
pub mod svg;
pub mod variation;
