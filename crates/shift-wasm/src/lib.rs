//! Shift's shared Rust rules for the editor, compiled to WebAssembly.
//!
//! The editor runs these synchronously inside reactive computeds, where the
//! native bridge, which is asynchronous, cannot. Each module calls the same
//! code the workspace and export use, so there is one implementation.
//!
//! Cold values that cross the boundary are typed with `tsify`, which
//! generates their TypeScript types. Hot calls pass flat number arrays in
//! layouts declared once here ([`layout`]), from which the editor's side is
//! generated, and strings cross once each, as interned ids ([`names`]).

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]
#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned arguments"
)]

pub mod anchors;
pub mod decomposition;
mod layout;
pub mod names;
#[cfg(feature = "reference")]
pub mod reference;
pub mod shaping;
pub mod variation;
