use std::path::PathBuf;

use clap::{Args, Subcommand, ValueHint};

use super::MutationArgs;

/// How every condition flag reads, shared by the commands that take one.
const WHEN_HELP: &str = "Where it applies, one axis range per flag; repeat for more, all must \
hold. The axis by tag or name, then 700, >=700, 700+ (from 700), <=80 (up to 80) or 400-600, \
in user units on font axes: wght>=700, \"Weight 400-600\".";

#[derive(Debug, Subcommand)]
pub(crate) enum GlyphAlternateCommand {
    /// Add an alternate: another glyph text draws in this one's place where
    /// a condition on the font's axes holds.
    ///
    /// Alternates are tried in order and the first whose condition holds
    /// wins. An alternate an earlier one always beats is reported as never
    /// used.
    Add(AddAlternateArgs),

    /// Remove an alternate; its glyph stays in the font.
    Remove(RemoveAlternateArgs),

    /// Move an alternate to another position in the order they are tried.
    #[command(name = "move")]
    Reorder(MoveAlternateArgs),

    /// Replace an alternate's condition or the glyph it draws.
    Set(SetAlternateArgs),
}

/// One of a glyph's alternates.
#[derive(Debug, Args)]
pub(crate) struct AlternateSelectorArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full stable glyph id.
    pub glyph: String,

    /// The alternate: its position, counting from 1, or the name of the glyph
    /// it draws when only one alternate draws it.
    pub alternate: String,
}

/// Where an alternate applies: `--when` ranges, or `--always`.
#[derive(Debug, Args)]
pub(crate) struct ConditionArgs {
    #[arg(long, value_name = "AXIS RANGE", help = WHEN_HELP)]
    pub when: Vec<String>,

    /// Apply everywhere, with no condition.
    #[arg(long, conflicts_with = "when")]
    pub always: bool,
}

#[derive(Debug, Args)]
pub(crate) struct AddAlternateArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full stable glyph id.
    pub glyph: String,

    /// The glyph drawn in its place, by name or full stable glyph id.
    pub alternate_glyph: String,

    #[command(flatten)]
    pub condition: ConditionArgs,

    /// Position in the order alternates are tried, counting from 1; last
    /// when omitted.
    #[arg(long, value_name = "POSITION")]
    pub at: Option<usize>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct RemoveAlternateArgs {
    #[command(flatten)]
    pub alternate: AlternateSelectorArgs,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct MoveAlternateArgs {
    #[command(flatten)]
    pub alternate: AlternateSelectorArgs,

    /// The new position, counting from 1.
    #[arg(long, value_name = "POSITION")]
    pub to: usize,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct SetAlternateArgs {
    #[command(flatten)]
    pub alternate: AlternateSelectorArgs,

    /// The replacement condition; the current one stays when no flag is given.
    #[command(flatten)]
    pub condition: ConditionArgs,

    /// The glyph to draw instead, by name or full stable glyph id.
    #[arg(long = "glyph", value_name = "GLYPH")]
    pub alternate_glyph: Option<String>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Subcommand)]
pub(crate) enum ComponentCommand {
    /// Author where a component draws.
    Condition {
        #[command(subcommand)]
        command: ComponentConditionCommand,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum ComponentConditionCommand {
    /// Set where a component draws: nowhere its condition fails.
    ///
    /// The condition is the same in every drawing of the glyph, since a
    /// component exists in all of them. It is evaluated where the glyph is
    /// drawn, so it reads font axes and the glyph's own axes, never the
    /// axes of the glyph the component draws.
    Set(SetComponentConditionArgs),
}

#[derive(Debug, Args)]
pub(crate) struct SetComponentConditionArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full stable glyph id of the glyph the component is in.
    pub glyph: String,

    /// The component: its position, counting from 1, as `glyph export` lists
    /// components, or the name of the glyph it draws when only one component
    /// draws it.
    pub component: String,

    /// The source whose drawing names the component; the default source
    /// when omitted. The condition is set in every drawing.
    #[arg(long)]
    pub source: Option<String>,

    #[command(flatten)]
    pub condition: ConditionArgs,

    #[command(flatten)]
    pub mutation: MutationArgs,
}
