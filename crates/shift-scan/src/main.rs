//! Reports Rust structure worth a reviewer's look, read from the syntax tree:
//! free functions that read as methods, method names several types share
//! (maybe a trait), long method chains, cheap lazy closures repeated within a
//! file, and conversions that copy fields one by one.
//!
//! It reports and never fails: some free functions are right as they are.
//! Clippy covers what it can decide alone; this covers what needs a reviewer.
//!
//! ```text
//! shift-scan [--since <rev>] [--kind <kind>]... [<crate dir>...]
//! ```
//!
//! With no crate directories it scans every crate under `crates/`. `--since`
//! keeps findings in files changed since `<rev>`, for reviewing one branch.

mod chain;
mod crate_scan;
mod file_scan;
mod finding;

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use crate_scan::CrateScan;
use finding::{Finding, Kind};

/// What to scan and what to keep, from the command line.
#[derive(Default)]
struct Options {
    crates: Vec<PathBuf>,
    since: Option<String>,
    kinds: Vec<Kind>,
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
                _ => options.crates.push(PathBuf::from(arg)),
            }
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
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("shift-scan: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let options = Options::parse(std::env::args().skip(1))?;
    let changed = options.changed_files()?;
    let mut findings = Vec::new();
    for dir in options.crate_dirs().map_err(|error| error.to_string())? {
        let scan = CrateScan::read(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        findings.extend(scan.findings());
    }
    findings.retain(|finding| options.keeps(finding, changed.as_deref()));
    findings.sort();
    for finding in &findings {
        println!("{finding}");
    }
    eprintln!("shift-scan: {} findings", findings.len());
    Ok(())
}
