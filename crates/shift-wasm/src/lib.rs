//! Shift's shared Rust rules for the editor, compiled to WebAssembly.
//!
//! The editor runs these synchronously inside reactive computeds, where the
//! native bridge, which is asynchronous, cannot. Each module calls the same
//! code the workspace and export use, so there is one implementation.
//!
//! Values that cross the boundary are typed with `tsify`, which generates
//! their TypeScript types. Hot calls pass flat number arrays instead of
//! objects, so nothing is converted field by field, and strings cross once
//! each, as interned ids ([`names`]).

pub mod anchors;
pub mod engine;
pub mod names;
mod reader;
#[cfg(feature = "reference")]
pub mod reference;
pub mod variation;
