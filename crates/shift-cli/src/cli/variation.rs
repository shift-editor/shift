use std::path::PathBuf;

use clap::{Args, Subcommand, ValueHint};

use super::MutationArgs;

#[derive(Debug, Args)]
pub struct SetAxisArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Current axis tag or full stable axis id.
    pub axis: String,

    /// Replacement four-character OpenType tag; identity is preserved.
    #[arg(long)]
    pub tag: Option<String>,

    /// Replacement human-readable axis name.
    #[arg(long)]
    pub name: Option<String>,

    /// Replacement user-space minimum for a continuous axis.
    #[arg(long = "min", allow_hyphen_values = true)]
    pub minimum: Option<f64>,

    /// Replacement user-space default; masters are never relocated implicitly.
    #[arg(long, allow_hyphen_values = true)]
    pub default: Option<f64>,

    /// Replacement user-space maximum for a continuous axis.
    #[arg(long = "max", allow_hyphen_values = true)]
    pub maximum: Option<f64>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Subcommand)]
pub enum InstanceCommand {
    /// Add one product preset, or missing standard weight presets.
    Add(AddInstanceArgs),
    /// Edit a product preset without replacing its identity or author order.
    Set(SetInstanceArgs),
    /// Remove one product preset, leaving masters and glyph layers unchanged.
    Remove(RemoveInstanceArgs),
}

#[derive(Debug, Args)]
pub struct AddInstanceArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Product name, such as Book; names need not be unique.
    #[arg(long)]
    pub name: Option<String>,

    /// External/user-space coordinate as TAG=VALUE; omitted axes use defaults.
    #[arg(long, value_name = "TAG=VALUE", value_delimiter = ',')]
    pub location: Vec<String>,

    /// Optional published PostScript name.
    #[arg(long)]
    pub postscript_name: Option<String>,

    /// Add missing in-range wght presets, preserving existing products and IDs.
    #[arg(long, conflicts_with_all = ["name", "location", "postscript_name"])]
    pub standard_weights: bool,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct SetInstanceArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Unique product name or full stable instance id.
    pub instance: String,

    /// Replacement product name.
    #[arg(long)]
    pub name: Option<String>,

    /// External/user-space coordinates to replace; omitted coordinates survive.
    #[arg(long, value_name = "TAG=VALUE", value_delimiter = ',')]
    pub location: Vec<String>,

    /// Replacement published PostScript name.
    #[arg(long, conflicts_with = "clear_postscript_name")]
    pub postscript_name: Option<String>,

    /// Remove the authored PostScript name.
    #[arg(long)]
    pub clear_postscript_name: bool,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct RemoveInstanceArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Unique product name or full stable instance id.
    pub instance: String,

    #[command(flatten)]
    pub mutation: MutationArgs,
}
