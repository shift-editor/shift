mod cli;
mod inspect;

use std::io::{self, IsTerminal, Write};

use clap::Parser;
use cli::{Cli, Command};
use inspect::{InspectReport, RenderMode};
use miette::IntoDiagnostic;

fn main() -> miette::Result<()> {
    match Cli::parse().command {
        Command::Inspect(args) => inspect(args),
    }
}

fn inspect(args: cli::InspectArgs) -> miette::Result<()> {
    let report = InspectReport::load(&args.path)?;
    let output = if args.json {
        serde_json::to_string_pretty(&report).into_diagnostic()?
    } else {
        report.render(args.view, render_mode())
    };

    write_stdout(&output)
}

fn render_mode() -> RenderMode {
    if std::io::stdout().is_terminal() {
        RenderMode::Styled
    } else {
        RenderMode::Plain
    }
}

fn write_stdout(output: &str) -> miette::Result<()> {
    let mut stdout = io::stdout().lock();
    match writeln!(stdout, "{output}") {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => Ok(()),
        Err(error) => Err(error).into_diagnostic(),
    }
}
