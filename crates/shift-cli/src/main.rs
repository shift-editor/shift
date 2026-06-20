mod inspect;

use std::io::IsTerminal;
use std::path::PathBuf;

use anstyle::{AnsiColor, Effects};
use clap::builder::styling::Styles;
use clap::{ColorChoice, Parser, Subcommand, ValueEnum};
use inspect::{InspectOutput, InspectReport, RenderMode};
use miette::IntoDiagnostic;

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
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Inspect a .shift source package.
    Inspect(InspectArgs),
}

#[derive(Debug, Parser)]
struct InspectArgs {
    /// Path to a .shift source package.
    path: PathBuf,

    /// Focus the human-readable output on one section.
    #[arg(value_enum, default_value_t = InspectView::Summary)]
    view: InspectView,

    /// Emit stable JSON for scripts and CI.
    #[arg(long)]
    json: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
enum InspectView {
    Summary,
    Axes,
    Sources,
    Glyphs,
}

fn main() -> miette::Result<()> {
    match Cli::parse().command {
        Command::Inspect(args) => inspect(args),
    }
}

fn inspect(args: InspectArgs) -> miette::Result<()> {
    let report = InspectReport::load(&args.path)?;
    if args.json {
        anstream::println!(
            "{}",
            serde_json::to_string_pretty(&report).into_diagnostic()?
        );
        return Ok(());
    }

    let output = match args.view {
        InspectView::Summary => InspectOutput::Summary,
        InspectView::Axes => InspectOutput::Axes,
        InspectView::Sources => InspectOutput::Sources,
        InspectView::Glyphs => InspectOutput::Glyphs,
    };
    let mode = if std::io::stdout().is_terminal() {
        RenderMode::Styled
    } else {
        RenderMode::Plain
    };
    anstream::println!("{}", report.render(output, mode));
    Ok(())
}
