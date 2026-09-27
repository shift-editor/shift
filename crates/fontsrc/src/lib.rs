//! Format-native APIs for authored font sources.
//!
//! The crate owns no editor model or persistence identity. Format modules expose
//! source and sink abstractions that work with native files, in-memory maps, and
//! browser-provided bytes without depending on Shift crates.

/// Unified Font Object reading, writing, and format-native values.
pub mod ufo {
    pub use norad::error::{FontLoadError, FontWriteError};
    pub use norad::{DataRequest, DirEntry, Font, FontSink, FontSource, WriteOptions};
}
