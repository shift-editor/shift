//! Writes each item's TypeScript description while the macros expand.
//!
//! Only when `PACK_TS_DIR` is set, which `@shift/pack`'s generator does
//! for a `cargo check` in its own target directory. Cargo doesn't know the
//! macros read that variable, so a crate it considers up to date writes
//! nothing; the generator cleans a crate whose folder is missing so its
//! macros expand again.

use std::fs;
use std::path::PathBuf;
use std::sync::Once;

use serde_json::Value;

/// Clears this crate's folder before its first fragment, so an item removed
/// since the last expansion leaves no fragment behind. A macro runs in the
/// rustc process compiling one crate, so this runs once per crate compiled.
static CLEARED: Once = Once::new();

/// Writes `fragment` as `<key>.json` in this crate's folder; does nothing
/// unless `PACK_TS_DIR` is set. Failures are ignored: the generator then
/// finds the fragment missing and says so.
pub(crate) fn write(key: &str, fragment: &Value) {
    let Some(folder) = folder() else { return };
    CLEARED.call_once(|| {
        let _ = fs::remove_dir_all(&folder);
    });
    if fs::create_dir_all(&folder).is_err() {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(fragment) else {
        return;
    };
    let _ = fs::write(folder.join(format!("{key}.json")), text);
}

/// `$PACK_TS_DIR/<package being compiled>`.
fn folder() -> Option<PathBuf> {
    let root = std::env::var_os("PACK_TS_DIR")?;
    let package = std::env::var("CARGO_PKG_NAME").ok()?;
    Some(PathBuf::from(root).join(package))
}
