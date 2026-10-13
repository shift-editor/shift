//! Reads and replaces a document's authored feature code.

use std::io::{self, Read};
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr};
use shift_font::{FontIntent, FontIntentSet};
use shift_store::ShiftStore;

use crate::cli::{SetFeaturesArgs, ShowFeaturesArgs};

use super::{AuthoringReport, apply_mutation};

/// Returns the document's authored feature code; `None` when it has none.
///
/// # Errors
///
/// Fails when the document cannot be opened or read.
pub fn show_features(args: &ShowFeaturesArgs) -> Result<Option<String>> {
    let font = ShiftStore::open_document(&args.path)
        .and_then(|store| store.load_font_state())
        .into_diagnostic()
        .wrap_err("failed to load Shift font")?;
    Ok(font.features().fea_source().map(str::to_string))
}

/// Replaces the document's feature code with the input's text, as the app's
/// "Edit Feature Code" does; empty input removes it. The code is stored as
/// written; problems in it are reported when the font compiles or shapes.
///
/// # Errors
///
/// Fails when the input cannot be read, or the document cannot be changed.
pub fn set_features(args: SetFeaturesArgs) -> Result<AuthoringReport> {
    let source = read_text_input(&args.input)?;
    let source = (!source.trim().is_empty()).then_some(source);
    let set = FontIntentSet {
        intents: vec![FontIntent::SetFeatureSource { source }],
    };
    apply_mutation(&args.path, &args.mutation, set)
}

fn read_text_input(path: &Path) -> Result<String> {
    if path == Path::new("-") {
        let mut text = String::new();
        io::stdin()
            .read_to_string(&mut text)
            .into_diagnostic()
            .wrap_err("failed to read feature code from stdin")?;
        return Ok(text);
    }
    std::fs::read_to_string(path)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to read feature code from {}", path.display()))
}
