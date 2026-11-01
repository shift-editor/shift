//! Shapes and lays out text, once, for every Shift host.
//!
//! - [`shape`] (feature `shape`) itemizes a paragraph by bidi level and
//!   script, shapes each run with HarfRust, and finds line-break
//!   opportunities, over the live font in the editor or a compiled font in
//!   a proof.
//! - [`shaper_font`] (feature `shaper-font`) compiles a font's authored
//!   features into the shaper font the editor shapes live text with.
//! - [`layout`] lays text out over the live font: positioning, line
//!   breaking, bidi order, carets and boxes. Its request and result types
//!   build without features; laying out needs `layout`.
//!
//! Each consumer turns on only what it needs, so the editor's default
//! WebAssembly module, which holds only layout's types, links neither
//! HarfRust nor the feature compiler.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

pub mod layout;
#[cfg(feature = "shape")]
pub mod shape;
#[cfg(feature = "shaper-font")]
pub mod shaper_font;
