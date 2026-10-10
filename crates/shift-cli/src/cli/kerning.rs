use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum, ValueHint};
use serde::Deserialize;

use super::MutationArgs;

#[derive(Debug, Subcommand)]
pub enum KerningCommand {
    /// List authored kerning pairs with their value at each master.
    List(ListKerningArgs),

    /// List kerning groups and their members.
    Groups(KerningGroupsArgs),

    /// Show the kerning between two glyphs at each master, and optionally at a location.
    Get(GetKerningArgs),

    /// Set one pair's value at one master, or apply a JSON batch of group and pair edits.
    Set(Box<SetKerningArgs>),

    /// Remove one pair's value at one master.
    Remove(RemoveKerningArgs),

    /// Author kerning groups.
    Group {
        #[command(subcommand)]
        command: KerningGroupCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum KerningGroupCommand {
    /// Create a group at one pair position, optionally with members.
    Create(CreateKerningGroupArgs),

    /// Rename a group; its pairs are kept.
    Rename(RenameKerningGroupArgs),

    /// Delete a group; pairs that reference it no longer apply.
    Delete(DeleteKerningGroupArgs),

    /// Move glyphs into a group, out of any other group at its position.
    Assign(AssignKerningGroupArgs),

    /// Take glyphs out of their group at one pair position.
    Unassign(UnassignKerningGroupArgs),
}

/// The position a glyph or group occupies in a kerning pair.
#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KerningPositionArg {
    /// The left glyph of a pair; its group kerns the glyph's right edge (UFO kern1).
    First,
    /// The right glyph of a pair; its group kerns the glyph's left edge (UFO kern2).
    Second,
}

#[derive(Debug, Args)]
pub struct ListKerningArgs {
    /// Path to a .shift, UFO, Designspace, or Glyphs source; compiled fonts carry no authored kerning.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Only show this master, by name or full stable source id.
    #[arg(long)]
    pub source: Option<String>,

    /// Only show pairs that involve this glyph directly or through its groups.
    #[arg(long)]
    pub glyph: Option<String>,

    /// Emit the pair list as JSON.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct KerningGroupsArgs {
    /// Path to a .shift, UFO, Designspace, or Glyphs source; compiled fonts carry no authored kerning.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Only show groups at this pair position.
    #[arg(long, value_enum)]
    pub position: Option<KerningPositionArg>,

    /// Emit the groups as JSON.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct GetKerningArgs {
    /// Path to a .shift, UFO, Designspace, or Glyphs source; compiled fonts carry no authored kerning.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// The left glyph, by name or full stable glyph id.
    pub first: String,

    /// The right glyph, by name or full stable glyph id.
    pub second: String,

    /// Also resolve at this external user-space coordinate, as TAG=VALUE; repeat or comma-separate.
    #[arg(long, value_name = "TAG=VALUE", value_delimiter = ',')]
    pub location: Vec<String>,

    /// Emit the resolution as JSON.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
#[command(group(
    clap::ArgGroup::new("edit")
        .required(true)
        .args(["input", "first"])
))]
pub struct SetKerningArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// The left side: a glyph name or id, or @NAME for a first-position group.
    #[arg(requires_all = ["second", "value"])]
    pub first: Option<String>,

    /// The right side: a glyph name or id, or @NAME for a second-position group.
    pub second: Option<String>,

    /// The value in font units.
    #[arg(allow_negative_numbers = true)]
    pub value: Option<f64>,

    /// Master name or full stable source id; defaults to the default source.
    #[arg(long, conflicts_with = "input")]
    pub source: Option<String>,

    /// JSON batch of group and pair edits, or - to read it from stdin.
    #[arg(long, value_hint = ValueHint::FilePath)]
    pub input: Option<PathBuf>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct RemoveKerningArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// The left side: a glyph name or id, or @NAME for a first-position group.
    pub first: String,

    /// The right side: a glyph name or id, or @NAME for a second-position group.
    pub second: String,

    /// Master name or full stable source id; defaults to the default source.
    #[arg(long)]
    pub source: Option<String>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct CreateKerningGroupArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Group name, unique at its position.
    pub name: String,

    /// Glyph names or ids to move into the new group.
    pub members: Vec<String>,

    /// Pair position the group kerns at.
    #[arg(long, value_enum)]
    pub position: KerningPositionArg,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct RenameKerningGroupArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Current group name, or its full stable id.
    pub group: String,

    /// New group name, unique at its position.
    pub name: String,

    /// Pair position of the group.
    #[arg(long, value_enum)]
    pub position: KerningPositionArg,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct DeleteKerningGroupArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Group name, or its full stable id.
    pub group: String,

    /// Pair position of the group.
    #[arg(long, value_enum)]
    pub position: KerningPositionArg,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct AssignKerningGroupArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Group name, or its full stable id.
    pub group: String,

    /// Glyph names or ids to move into the group.
    #[arg(required = true)]
    pub members: Vec<String>,

    /// Pair position of the group.
    #[arg(long, value_enum)]
    pub position: KerningPositionArg,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct UnassignKerningGroupArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph names or ids to take out of their group.
    #[arg(required = true)]
    pub members: Vec<String>,

    /// Pair position to leave.
    #[arg(long, value_enum)]
    pub position: KerningPositionArg,

    #[command(flatten)]
    pub mutation: MutationArgs,
}
