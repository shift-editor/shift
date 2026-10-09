//! Embeds the Shift product version so `shift-cli --version` and installed
//! skills report the app release they ship with, not the crate version.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("set by Cargo"));
    let package = manifest_dir.join("../../package.json");
    println!("cargo:rerun-if-changed={}", package.display());

    let text = fs::read_to_string(&package)
        .unwrap_or_else(|error| panic!("read {}: {error}", package.display()));
    let manifest: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", package.display()));
    let version = manifest["version"]
        .as_str()
        .unwrap_or_else(|| panic!("{} has no string version", package.display()));
    println!("cargo:rustc-env=SHIFT_PRODUCT_VERSION={version}");
}
