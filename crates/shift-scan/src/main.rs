//! Reports Rust structure worth a reviewer's look, read from the syntax tree,
//! and holds each kind's count per crate to a checked-in baseline so the
//! count only goes down. The kinds are listed in `docs/DOCS.md`.
//!
//! ```text
//! shift-scan [--since <rev>] [--kind <kind>]... [<crate src dir>...]
//! shift-scan --check | --update
//! ```
//!
//! With no crate directories it scans every crate under `crates/`. `--since`
//! keeps findings in files changed since `<rev>`, for reviewing one branch.
//! `--check` scans everything and fails when any kind's count in any crate
//! is above `baseline.json`; `--update` rewrites the baseline from the tree.

mod baseline;
mod chain;
mod collect;
mod crate_scan;
mod duplicate;
mod errors;
mod file_scan;
mod finding;
mod layout;
mod runtime;
mod signature;
mod syntax;
mod test_code;
mod test_only_pub;
mod types;

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use baseline::Counts;
use crate_scan::CrateScan;
use duplicate::DuplicateBodies;
use finding::{Finding, Kind};
use test_only_pub::NameUses;
use types::DuplicateTypes;

/// What to do with the findings.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Print them.
    #[default]
    Report,
    /// Compare their counts with the baseline and fail on a rise.
    Check,
    /// Write their counts as the new baseline.
    Update,
}

/// What to scan and what to keep, from the command line.
#[derive(Default)]
struct Options {
    crates: Vec<PathBuf>,
    since: Option<String>,
    kinds: Vec<Kind>,
    mode: Mode,
}

impl Options {
    fn parse(mut args: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut options = Self::default();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--since" => options.since = Some(args.next().ok_or("--since needs a revision")?),
                "--kind" => {
                    let name = args.next().ok_or("--kind needs a kind")?;
                    let names: Vec<_> = Kind::ALL.iter().map(|kind| kind.as_str()).collect();
                    let kind = Kind::parse(&name).ok_or_else(|| {
                        format!("unknown kind {name}; one of {}", names.join(", "))
                    })?;
                    options.kinds.push(kind);
                }
                "--check" => options.mode = Mode::Check,
                "--update" => options.mode = Mode::Update,
                _ => options.crates.push(PathBuf::from(arg)),
            }
        }
        let filtered =
            !options.crates.is_empty() || options.since.is_some() || !options.kinds.is_empty();
        if options.mode != Mode::Report && filtered {
            return Err("--check and --update scan every crate and kind; drop the filters".into());
        }
        Ok(options)
    }

    fn crate_dirs(&self) -> std::io::Result<Vec<PathBuf>> {
        if !self.crates.is_empty() {
            return Ok(self.crates.clone());
        }
        let mut dirs = Vec::new();
        for entry in std::fs::read_dir("crates")? {
            let src = entry?.path().join("src");
            if src.is_dir() {
                dirs.push(src);
            }
        }
        dirs.sort();
        Ok(dirs)
    }

    /// The files changed since `--since`, or `None` to keep everything.
    fn changed_files(&self) -> Result<Option<Vec<PathBuf>>, String> {
        let Some(since) = &self.since else {
            return Ok(None);
        };
        let output = Command::new("git")
            .args(["diff", "--name-only", since])
            .output()
            .map_err(|error| format!("git diff failed: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(Some(text.lines().map(PathBuf::from).collect()))
    }

    fn keeps(&self, finding: &Finding, changed: Option<&[PathBuf]>) -> bool {
        let kind_kept = self.kinds.is_empty() || self.kinds.contains(&finding.kind);
        let path_kept = changed.is_none_or(|changed| {
            changed
                .iter()
                .any(|path| Self::same_file(path, &finding.path))
        });
        kind_kept && path_kept
    }

    /// A trait candidate names its crate's `src`, so it matches any change in it.
    fn same_file(changed: &Path, found: &Path) -> bool {
        changed.starts_with(found) || found.ends_with(changed)
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(message) => {
            eprintln!("shift-scan: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<ExitCode, String> {
    let options = Options::parse(std::env::args().skip(1))?;
    let changed = options.changed_files()?;
    let mut findings = Vec::new();
    let mut bodies = Vec::new();
    let mut helpers = Vec::new();
    let mut shapes = Vec::new();
    let mut name_uses = NameUses::default();
    for dir in options.crate_dirs().map_err(|error| error.to_string())? {
        let scan = CrateScan::read(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        findings.extend(scan.findings());
        bodies.extend(scan.bodies());
        helpers.extend(scan.test_helper_bodies());
        shapes.extend(scan.type_shapes());
        name_uses.extend(scan.name_uses());
    }
    findings.extend(DuplicateBodies::new(bodies, Kind::DuplicateBody).findings());
    findings.extend(test_code::repeated_helpers(helpers));
    findings.extend(name_uses.findings());
    findings.extend(DuplicateTypes::new(shapes).findings());
    findings.retain(|finding| options.keeps(finding, changed.as_deref()));
    findings.sort();
    match options.mode {
        Mode::Report => {
            #[expect(clippy::print_stdout, reason = "the findings are the report")]
            for finding in &findings {
                println!("{finding}");
            }
            eprintln!("shift-scan: {} findings", findings.len());
            Ok(ExitCode::SUCCESS)
        }
        Mode::Check => {
            let held = Counts::of(&findings).check()?;
            Ok(if held {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }
        Mode::Update => {
            Counts::of(&findings).update()?;
            Ok(ExitCode::SUCCESS)
        }
    }
}
