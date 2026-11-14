//! Embeds the Shift product version so `shift-cli --version` and installed
//! skills report the app release they ship with, not the crate version.

use std::env;
use std::error::Error;
use std::fs;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let package = manifest_dir.join("../../package.json");
    println!("cargo:rerun-if-changed={}", package.display());

    let text = fs::read_to_string(&package)
        .map_err(|error| format!("read {}: {error}", package.display()))?;
    let manifest: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("parse {}: {error}", package.display()))?;
    let version = manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("{} has no string version", package.display()))?;
    println!("cargo:rustc-env=SHIFT_PRODUCT_VERSION={version}");
    Ok(())
}
