use std::path::PathBuf;

use anstyle::{AnsiColor, Effects};
use clap::builder::styling::Styles;
use clap::{ColorChoice, Parser, Subcommand, ValueHint};

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
