use std::path::PathBuf;

use anstyle::{AnsiColor, Effects};
use clap::builder::styling::Styles;
use clap::{Args, ColorChoice, Parser, Subcommand, ValueHint};

use crate::inspect::InspectView;

const CLAP_STYLES: Styles = Styles::styled()
    .header(AnsiColor::BrightCyan.on_default().effects(Effects::BOLD))
    .usage(AnsiColor::BrightCyan.on_default().effects(Effects::BOLD))
    .literal(AnsiColor::Green.on_default())
    .placeholder(AnsiColor::BrightBlue.on_default())
    .error(AnsiColor::Red.on_default().effects(Effects::BOLD))
    .valid(AnsiColor::Green.on_default())
    .invalid(AnsiColor::Red.on_default());

#[derive(Debug, Parser)]
#[command(
    name = "shift",
    version,
    about = "Command-line tools for Shift source packages",
    color = ColorChoice::Auto,
    styles = CLAP_STYLES
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Inspect a .shift source package without modifying it.
    Inspect(InspectArgs),

    /// Compile a .shift source package to a TrueType font.
    Compile(CompileArgs),

    /// Create a Shift font document.
    Font {
        #[command(subcommand)]
        command: FontCommand,
    },

    /// Author variable-font axes.
    Axis {
        #[command(subcommand)]
        command: AxisCommand,
    },

    /// Author master sources.
    Source {
        #[command(subcommand)]
        command: SourceCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum FontCommand {
    /// Create a new .shift document with its default Regular source.
    Create(CreateFontArgs),
}

#[derive(Debug, Subcommand)]
pub enum AxisCommand {
    /// Add a continuous axis.
    Add(AddAxisArgs),
}

#[derive(Debug, Subcommand)]
pub enum SourceCommand {
    /// Add a master source at a design-space location.
    Add(AddSourceArgs),
}

#[derive(Debug, Args)]
pub struct CreateFontArgs {
    /// Path for the new canonical .shift source package.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Validate and describe the creation without writing.
    #[arg(long)]
    pub dry_run: bool,

    /// Emit a structured result for scripts and agents.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct AddAxisArgs {
    /// Path to the canonical .shift source package.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Caller-minted stable identity; the axis_ prefix is optional.
    #[arg(long)]
    pub id: Option<String>,

    /// Four-character OpenType axis tag.
    #[arg(long)]
    pub tag: String,

    /// Human-readable axis name.
    #[arg(long)]
    pub name: String,

    /// Minimum external/design value.
    #[arg(long = "min")]
    pub minimum: f64,

    /// Default external/design value.
    #[arg(long)]
    pub default: f64,

    /// Maximum external/design value.
    #[arg(long = "max")]
    pub maximum: f64,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct AddSourceArgs {
    /// Path to the canonical .shift source package.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Caller-minted stable identity; the source_ prefix is optional.
    #[arg(long)]
    pub id: Option<String>,

    /// Human-readable source name.
    #[arg(long)]
    pub name: String,

    /// Design-space coordinate as TAG=VALUE; repeat or comma-separate values.
    #[arg(long, value_name = "TAG=VALUE", value_delimiter = ',')]
    pub location: Vec<String>,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub struct MutationArgs {
    /// Write a new independent package instead of modifying the input.
    #[arg(long, value_hint = ValueHint::FilePath)]
    pub output: Option<PathBuf>,

    /// Validate and describe the mutation without writing.
    #[arg(long)]
    pub dry_run: bool,

    /// Emit a structured result for scripts and agents.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Parser)]
pub struct CompileArgs {
    /// Path to the canonical .shift source package.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Path for the compiled .ttf output.
    #[arg(short, long, value_hint = ValueHint::FilePath)]
    pub output: PathBuf,
}

#[derive(Debug, Parser)]
pub struct InspectArgs {
    /// Path to the .shift source package to inspect.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Select the human-readable section to print.
    #[arg(long, value_enum, default_value_t = InspectView::Summary)]
    pub view: InspectView,

    /// Emit stable JSON for scripts and CI.
    #[arg(long)]
    pub json: bool,
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::*;

    #[test]
    fn command_definition_is_valid() {
        Cli::command().debug_assert();
    }
}
