//! Paths to files in the repository, for tests that read real fonts.

use std::path::PathBuf;

/// The repository root.
pub fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The repository's `fixtures/` directory.
pub fn root() -> PathBuf {
    repository_root().join("fixtures")
}

/// A font under `fixtures/fonts/`.
pub fn font(path: &str) -> PathBuf {
    root().join("fonts").join(path)
}

/// The MutatorSans light condensed master as a UFO.
pub fn mutatorsans_ufo() -> PathBuf {
    font("mutatorsans/MutatorSansLightCondensed.ufo")
}

/// MutatorSans compiled to a variable TrueType font.
pub fn mutatorsans_ttf() -> PathBuf {
    font("mutatorsans/MutatorSans.ttf")
}

/// The MutatorSans designspace with its masters.
pub fn mutatorsans_designspace() -> PathBuf {
    font("mutatorsans-variable/MutatorSans.designspace")
}
