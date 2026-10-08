//! `proof`: renders a proof definition from a font to an image.

use std::io::Read;
use std::path::{Path, PathBuf};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use shift_proof::{ProofDefinition, ProofFont, ProofReport, layout, render_png, render_svg};

use crate::cli::ProofArgs;

/// Renders the requested proof, writes the image, and returns its report.
pub fn proof(args: ProofArgs) -> Result<(ProofReport, PathBuf)> {
    let format = OutputFormat::from_path(&args.output)?;
    let definition = match (&args.spec, &args.text) {
        (Some(spec), _) => {
            ProofDefinition::from_json(&read_spec(spec)?).map_err(|error| miette!("{error}"))?
        }
        (None, Some(text)) => ProofDefinition::text(text.clone(), args.size, args.location.clone()),
        (None, None) => bail!("pass --spec or --text"),
    };

    let font = ProofFont::open(&args.path).map_err(|error| miette!("{error}"))?;
    let page = layout(&definition, &font).map_err(|error| miette!("{error}"))?;
    let bytes = match format {
        OutputFormat::Png => render_png(&page).map_err(|error| miette!("{error}"))?,
        OutputFormat::Svg => render_svg(&page).into_bytes(),
    };
    std::fs::write(&args.output, bytes)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to write {}", args.output.display()))?;

    Ok((
        ProofReport::new(&page, definition.sections.len()),
        args.output,
    ))
}

/// One human-readable line about a written proof.
pub fn summary(report: &ProofReport, output: &Path) -> String {
    let rows: usize = report
        .sections
        .iter()
        .map(|section| section.rows.len())
        .sum();
    let mut line = format!(
        "Wrote {} ({}×{}, {} rows)",
        output.display(),
        report.width,
        report.height,
        rows
    );
    if !report.missing_characters.is_empty() {
        line.push_str(&format!(
            "; missing characters: {}",
            report.missing_characters.join(" ")
        ));
    }
    if !report.missing_glyphs.is_empty() {
        line.push_str(&format!(
            "; missing glyphs: {}",
            report.missing_glyphs.join(" ")
        ));
    }
    line
}

fn read_spec(path: &Path) -> Result<String> {
    if path.as_os_str() == "-" {
        let mut json = String::new();
        std::io::stdin()
            .read_to_string(&mut json)
            .into_diagnostic()
            .wrap_err("failed to read the proof definition from stdin")?;
        return Ok(json);
    }
    std::fs::read_to_string(path)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to read proof definition {}", path.display()))
}

enum OutputFormat {
    Png,
    Svg,
}

impl OutputFormat {
    fn from_path(path: &Path) -> Result<Self> {
        match path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("png") => Ok(Self::Png),
            Some("svg") => Ok(Self::Svg),
            _ => bail!("--output must end in .png or .svg"),
        }
    }
}
