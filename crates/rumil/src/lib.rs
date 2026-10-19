//! MathML Core layout from OpenType MATH data.
//!
//! The crate turns a formula tree into a display list of positioned glyphs and
//! rules, and can record which MATH value placed each item. It reads MATH data
//! and glyph metrics through a data-source trait, so it works on compiled fonts
//! and on in-memory editor data alike. It does not rasterise and does not depend
//! on Shift crates.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]
