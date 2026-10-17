//! Shift's shared Rust rules for the editor, compiled to WebAssembly.
//!
//! The editor runs these synchronously inside reactive computeds, where the
//! native bridge, which is asynchronous, cannot. Each module calls the same
//! code the workspace and export use, so there is one implementation.
//!
//! Hot calls exchange numbers through scratch buffers in the module's memory
//! ([`buffers`]): the caller writes its input in place, the call reads it and
//! writes its result to the output buffer, and nothing is allocated or
//! converted per call. Strings cross once each, as interned ids ([`names`]).

pub mod anchors;
pub mod buffers;
pub mod names;
