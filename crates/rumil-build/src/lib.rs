//! OpenType MATH table builder for authored font sources.
//!
//! The crate builds a `MATH` table from glyph-name-level source data: MATH
//! constants, `math.*` anchors, size variants, and glyph assemblies, following
//! the rules ufo2ft applies to `com.nagwa.MATHPlugin.*` lib keys. It does not
//! depend on Shift crates.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]
