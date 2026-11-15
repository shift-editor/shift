//! `shift import`: read a font source into a new .shift document, glyphs and
//! all, the way the app opens a UFO, Designspace, Glyphs, TTF, or OTF font.

use std::path::PathBuf;

use miette::{IntoDiagnostic, Result, WrapErr};
use serde::Serialize;
use shift_backends::ImportLossKind;
use shift_store::ShiftStore;

use crate::Report;
use crate::authoring::validate_new_document_path;
use crate::check::read_font;
use crate::cli::ImportArgs;

/// What one import wrote, and what reading the source dropped.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportReport {
    pub source: PathBuf,
    pub document: PathBuf,
    pub glyphs: usize,
    pub masters: usize,
    pub instances: usize,
    /// What reading the source into Shift dropped or approximated.
    pub import: Vec<String>,
}

impl Report for ImportReport {
    fn render(&self) -> String {
        let mut lines = vec![format!(
            "{}: {} glyphs, {} masters, {} named instances",
            self.document.display(),
            self.glyphs,
            self.masters,
            self.instances
        )];
        for loss in &self.import {
            lines.push(format!("note: reading the source: {loss}"));
        }
        lines.join("\n")
    }
}

/// Reads `args.source` and writes it as a new document at `args.output`.
///
/// # Errors
///
/// Refuses an output that exists or doesn't end in `.shift`, and reports
/// sources that can't be read and documents that can't be written.
pub(crate) fn import(args: &ImportArgs) -> Result<ImportReport> {
    validate_new_document_path(&args.output)?;
    let (font, losses) = read_font(&args.source)?;
    drop(
        ShiftStore::create_document(&args.output, &font)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to write {}", args.output.display()))?,
    );

    Ok(ImportReport {
        source: args.source.clone(),
        document: args.output.clone(),
        glyphs: font.glyph_count(),
        masters: font.sources().len(),
        instances: font.named_instances().len(),
        import: losses
            .into_iter()
            .filter(|loss| loss.kind == ImportLossKind::Omitted)
            .map(|loss| loss.message)
            .collect(),
    })
}
