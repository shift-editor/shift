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

pub mod anchors;
pub mod decomposition;
mod layout;
pub mod names;
#[cfg(feature = "reference")]
pub mod reference;
pub mod variation;
