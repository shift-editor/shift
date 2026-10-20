// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

mod bridge;
// Public so the compiler sees the napi exports as the crate's interface; nothing else calls them.
pub mod config;
mod errors;
mod input;
mod shaping;
mod specimen;
