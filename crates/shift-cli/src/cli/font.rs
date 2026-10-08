use std::path::PathBuf;

use clap::{Args, ValueHint};

use super::MutationArgs;

#[derive(Debug, Args)]
pub struct FontInfoArgs {
    /// Canonical SQLite .shift document to inspect.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Master name or full source ID; defaults to the default source.
    #[arg(long)]
    pub source: Option<String>,

    /// Emit authored metadata and source metrics as JSON.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct SetFontArgs {
    /// Canonical SQLite .shift document to edit.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Family name; omitted metadata flags preserve their current values.
    #[arg(long)]
    pub family_name: Option<String>,

    /// Style name.
    #[arg(long)]
    pub style_name: Option<String>,

    /// Font version as MAJOR or MAJOR.NNN, such as 1.000 or 2.125.
    #[arg(long, value_name = "MAJOR.NNN")]
    pub version: Option<String>,

    /// Copyright notice.
    #[arg(long)]
    pub copyright: Option<String>,

    /// Designer attribution.
    #[arg(long)]
    pub designer: Option<String>,

    /// Designer URL.
    #[arg(long)]
    pub designer_url: Option<String>,

    /// Complete license text, including any required notices.
    #[arg(long)]
    pub license: Option<String>,

    /// License URL.
    #[arg(long)]
    pub license_url: Option<String>,

    /// Master owning metric edits, by name or full ID; defaults to the default source.
    #[arg(long)]
    pub source: Option<String>,

    /// Authored ascender in font units; preserves overshoot.
    #[arg(long, allow_negative_numbers = true)]
    pub ascender: Option<f64>,

    /// Authored descender in font units; preserves overshoot.
    #[arg(long, allow_negative_numbers = true)]
    pub descender: Option<f64>,

    /// Authored x-height in font units; preserves overshoot.
    #[arg(long, allow_negative_numbers = true)]
    pub x_height: Option<f64>,

    /// Authored cap height in font units; preserves overshoot.
    #[arg(long, allow_negative_numbers = true)]
    pub cap_height: Option<f64>,

    /// Source line gap in font units.
    #[arg(long, allow_negative_numbers = true)]
    pub line_gap: Option<f64>,

    /// Source italic angle in degrees.
    #[arg(long, allow_negative_numbers = true)]
    pub italic_angle: Option<f64>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}
