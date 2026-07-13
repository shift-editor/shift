mod cli;
mod inspect;

use std::io::{self, IsTerminal, Write};

use clap::Parser;
use cli::{Cli, Command, CompileArgs};
use inspect::{InspectReport, RenderMode};
use miette::IntoDiagnostic;
use shift_backends::{ExportFormat, FontExportRequest, FontExportResult, FontExporter};
use shift_source::ShiftSourcePackage;

fn main() -> miette::Result<()> {
    match Cli::parse().command {
        Command::Inspect(args) => inspect(args),
        Command::Compile(args) => {
            let result = compile(args)?;
            write_stdout(&result.path.display().to_string())
        }
    }
}

fn compile(args: CompileArgs) -> miette::Result<FontExportResult> {
    let font = ShiftSourcePackage::load_font(&args.path).into_diagnostic()?;
    FontExporter::new()
        .export(
            &font,
            FontExportRequest {
                path: args.output,
                format: ExportFormat::Ttf,
            },
        )
        .into_diagnostic()
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

#[cfg(test)]
mod tests {
    use shift_font::test_support::sample_variable_font;

    use super::*;

    #[test]
    fn compile_command_writes_ttf_from_shift_source() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("Dogfood.shift");
        let output_path = temp.path().join("Dogfood.ttf");
        ShiftSourcePackage::save_font(&source_path, &sample_variable_font()).unwrap();

        let result = compile(CompileArgs {
            path: source_path,
            output: output_path.clone(),
        })
        .unwrap();

        assert_eq!(
            result,
            FontExportResult {
                path: output_path,
                format: ExportFormat::Ttf,
            }
        );
        let bytes = std::fs::read(result.path).unwrap();
        assert_eq!(&bytes[..4], &[0x00, 0x01, 0x00, 0x00]);
    }
}
