//! `shift check`: report problems that make a font build, interpolate, or
//! kern differently from what was drawn.
//!
//! Runs the same checks the editor runs live, over a whole source.

use std::path::{Path, PathBuf};

use miette::{IntoDiagnostic, Result, WrapErr, miette};
use serde::Serialize;
use shift_backends::font_loader::FontLoader;
use shift_backends::{BackendError, ImportLoss, ImportLossKind};
use shift_font::Font;
use shift_font::check::{Charset, CheckOptions, Finding, Severity, check_font_with};

use crate::cli::CheckArgs;

/// Findings for one source, with what Shift changed while reading it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    pub document: PathBuf,
    pub findings: Vec<ReportedFinding>,
    /// What reading the source into Shift dropped or approximated.
    pub import: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedFinding {
    pub code: &'static str,
    pub name: &'static str,
    pub severity: Severity,
    pub glyph: Option<String>,
    pub source: Option<String>,
    pub contour: Option<usize>,
    pub message: String,
}

impl CheckReport {
    /// Whether any finding is an error.
    pub fn has_errors(&self) -> bool {
        self.findings
            .iter()
            .any(|finding| finding.severity == Severity::Error)
    }

    pub fn render(&self) -> String {
        let mut lines = Vec::new();
        for finding in &self.findings {
            let severity = match finding.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            };
            lines.push(format!(
                "{} {severity}[{}]: {}",
                finding.code, finding.name, finding.message
            ));
        }
        for loss in &self.import {
            lines.push(format!("note: reading the source: {loss}"));
        }

        let errors = self
            .findings
            .iter()
            .filter(|finding| finding.severity == Severity::Error)
            .count();
        let warnings = self.findings.len() - errors;
        lines.push(match (errors, warnings) {
            (0, 0) => format!("{}: no problems found", self.document.display()),
            _ => format!(
                "{}: {errors} error{}, {warnings} warning{}",
                self.document.display(),
                plural(errors),
                plural(warnings)
            ),
        });
        lines.join("\n")
    }
}

/// Reads `args.path` and runs every check.
///
/// # Errors
///
/// Reports unreadable sources and axis mappings that cannot compile.
pub fn check(args: &CheckArgs) -> Result<CheckReport> {
    let options = CheckOptions {
        charset: args.charset.as_deref().map(read_charset).transpose()?,
        monospace: args.mono.then_some(args.width),
    };
    let (font, losses) = read_font(&args.path)?;
    let findings = check_font_with(&font, &options)
        .into_diagnostic()
        .wrap_err("failed to check the font")?;

    Ok(CheckReport {
        document: args.path.clone(),
        findings: findings
            .into_iter()
            .map(|finding| reported(&font, finding))
            .collect(),
        import: losses
            .into_iter()
            .filter(|loss| loss.kind == ImportLossKind::Omitted)
            .map(|loss| loss.message)
            .collect(),
    })
}

fn reported(font: &Font, finding: Finding) -> ReportedFinding {
    ReportedFinding {
        code: finding.check.code(),
        name: finding.check.name(),
        severity: finding.check.severity(),
        glyph: finding
            .glyph
            .and_then(|glyph_id| font.glyph(&glyph_id).map(|glyph| glyph.name().to_string())),
        source: finding.source.and_then(|source_id| {
            font.source(&source_id)
                .map(|source| source.name().to_string())
        }),
        contour: finding.contour,
        message: finding.message,
    }
}

/// Reads a font and what the import dropped, streaming when the format can.
fn read_font(path: &Path) -> Result<(Font, Vec<ImportLoss>)> {
    let path_text = path
        .to_str()
        .ok_or_else(|| miette!("font path is not valid UTF-8"))?;
    let loader = FontLoader::new();
    let failed = || format!("failed to load font {}", path.display());

    match loader.stream_font(path_text) {
        Ok(import) => {
            let losses = import.report().losses.clone();
            let font = import
                .collect_font()
                .into_diagnostic()
                .wrap_err_with(failed)?;
            Ok((font, losses))
        }
        Err(BackendError::StreamingUnsupported { .. }) => {
            let font = loader
                .read_font(path_text)
                .into_diagnostic()
                .wrap_err_with(failed)?;
            Ok((font, Vec::new()))
        }
        Err(error) => Err(error).into_diagnostic().wrap_err_with(failed),
    }
}

/// Resolves `ascii`, `latin1`, or a charset file.
fn read_charset(selector: &str) -> Result<Charset> {
    let charset = match selector {
        "ascii" => Charset::ascii(),
        "latin1" => Charset::latin1(),
        path => {
            let text = std::fs::read_to_string(path)
                .into_diagnostic()
                .wrap_err_with(|| {
                    format!("failed to read charset {path}; use ascii, latin1, or a file")
                })?;
            Charset::parse(&text).map_err(|line| {
                miette!("charset {path} line {line} is not a U+XXXX scalar or range")
            })?
        }
    };
    if charset.is_empty() {
        return Err(miette!("charset {selector} contains no characters"));
    }
    Ok(charset)
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}
