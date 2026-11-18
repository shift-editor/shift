use std::path::PathBuf;

use clap::{Args, Subcommand, ValueHint};

use super::MutationArgs;

#[derive(Debug, Subcommand)]
pub(crate) enum GlyphAxisCommand {
    /// Add an axis only this glyph varies along, such as Spread on a dot.
    ///
    /// Values on it are in the axis's own units. Components that draw the
    /// glyph set it through their `location`; a component that doesn't set
    /// it draws the glyph at the axis default.
    Add(AddGlyphAxisArgs),

    /// Rename, retag, or change the range of a glyph axis.
    ///
    /// A new range that would leave a drawing or a component location outside
    /// it is refused, naming each one. With --rescale, every value stored on
    /// the axis moves with the range instead.
    Edit(EditGlyphAxisArgs),

    /// Remove a glyph axis that no drawing or component sets a value on.
    ///
    /// An axis in use is refused, naming every drawing and component that
    /// uses it: remove or move those first.
    Remove(RemoveGlyphAxisArgs),
}

#[derive(Debug, Args)]
pub(crate) struct AddGlyphAxisArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full stable glyph id.
    pub glyph: String,

    /// Human-readable axis name, such as Spread.
    #[arg(long)]
    pub name: String,

    /// Four-character tag, unique across the font's axes and every glyph's;
    /// omitted, one is made from the name (Spread is SPRD).
    #[arg(long)]
    pub tag: Option<String>,

    #[command(flatten)]
    pub range: GlyphAxisRangeArgs,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

/// A new glyph axis's range, in its own units.
#[derive(Debug, Args)]
pub(crate) struct GlyphAxisRangeArgs {
    /// Minimum value, in the axis's own units.
    #[arg(long, allow_hyphen_values = true)]
    pub min: f64,

    /// Default value: where components that don't set the axis draw.
    #[arg(long, allow_hyphen_values = true)]
    pub default: f64,

    /// Maximum value, in the axis's own units.
    #[arg(long, allow_hyphen_values = true)]
    pub max: f64,
}

#[derive(Debug, Args)]
pub(crate) struct EditGlyphAxisArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full stable glyph id.
    pub glyph: String,

    /// The glyph's axis, by tag or full stable axis id.
    pub axis: String,

    /// Replacement name; the tag stays.
    #[arg(long)]
    pub name: Option<String>,

    /// Replacement four-character tag; identity is preserved.
    #[arg(long)]
    pub tag: Option<String>,

    #[command(flatten)]
    pub range: GlyphAxisRangeEditArgs,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

/// A replacement range for a glyph axis, and what happens to the values on it.
#[derive(Debug, Args)]
pub(crate) struct GlyphAxisRangeEditArgs {
    /// Replacement minimum; omitted range values keep theirs.
    #[arg(long, allow_hyphen_values = true)]
    pub min: Option<f64>,

    /// Replacement default.
    #[arg(long, allow_hyphen_values = true)]
    pub default: Option<f64>,

    /// Replacement maximum.
    #[arg(long, allow_hyphen_values = true)]
    pub max: Option<f64>,

    /// Move every drawing coordinate and component location on the axis with
    /// the new range, linearly on each side of the default, instead of
    /// refusing values the range would leave outside.
    #[arg(long)]
    pub rescale: bool,
}

#[derive(Debug, Args)]
pub(crate) struct RemoveGlyphAxisArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full stable glyph id.
    pub glyph: String,

    /// The glyph's axis, by tag or full stable axis id.
    pub axis: String,

    #[command(flatten)]
    pub mutation: MutationArgs,
}
