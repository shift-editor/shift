//! The Shift agent skill, embedded in the binary so an installed copy always
//! matches the command that wrote it.
//!
//! Each Shift build installs its CLI under its own name (`shift-cli`,
//! `shift-cli-nightly`, `shift-cli-dev`), and its skill follows: `shift`,
//! `shift-nightly`, `shift-dev`. A non-release skill opens by naming its
//! command, so an agent never runs another build's CLI.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use serde::Serialize;

use crate::cli::{
    InstallSkillArgs, ShowSkillArgs, SkillAgent, SkillIdentityArgs, SkillStatusArgs, SkillTopic,
};

/// The release build's command, which the skill text names.
const RELEASE_COMMAND: &str = "shift-cli";
const RELEASE_SKILL: &str = "shift";
const PRODUCT_VERSION: &str = env!("SHIFT_PRODUCT_VERSION");
const SKILL_FILE: &str = "SKILL.md";

/// Every file of `skills/shift`, by its path inside the skill directory.
const FILES: [(&str, &str); 5] = [
    (SKILL_FILE, include_str!("../../../skills/shift/SKILL.md")),
    (
        "references/cli.md",
        include_str!("../../../skills/shift/references/cli.md"),
    ),
    (
        "references/fonts.md",
        include_str!("../../../skills/shift/references/fonts.md"),
    ),
    (
        "references/mcp.md",
        include_str!("../../../skills/shift/references/mcp.md"),
    ),
    (
        "references/variable-fonts.md",
        include_str!("../../../skills/shift/references/variable-fonts.md"),
    ),
];

/// Which build's skill to write: the command it names and the skill's directory name.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillIdentity {
    command: String,
    name: String,
}

impl SkillIdentity {
    /// Resolves the build from `--command`, or else from the name this program was run as.
    ///
    /// # Errors
    ///
    /// Returns an error when an explicit `--command` is not `shift-cli` or
    /// `shift-cli-<build>` with a lowercase alphanumeric build name.
    fn resolve(args: &SkillIdentityArgs) -> Result<Self> {
        match &args.command {
            Some(command) => Self::from_command(command)
                .ok_or_else(|| miette!("`{command}` is not a Shift command-line tool name")),
            None => Ok(invoked_command()
                .and_then(|command| Self::from_command(&command))
                .unwrap_or_else(Self::release)),
        }
    }

    fn release() -> Self {
        Self {
            command: RELEASE_COMMAND.to_owned(),
            name: RELEASE_SKILL.to_owned(),
        }
    }

    fn from_command(command: &str) -> Option<Self> {
        let build = command.strip_prefix(RELEASE_COMMAND)?;
        let valid = build.is_empty()
            || build.strip_prefix('-').is_some_and(|name| {
                !name.is_empty()
                    && !name.ends_with('-')
                    && !name.contains("--")
                    && name
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            });
        valid.then(|| Self {
            command: command.to_owned(),
            name: format!("{RELEASE_SKILL}{build}"),
        })
    }

    fn is_release(&self) -> bool {
        self.command == RELEASE_COMMAND
    }

    /// The skill's files for this build, with `SKILL.md` stamped with its name, command, and version.
    fn render(&self) -> BTreeMap<&'static str, String> {
        FILES
            .iter()
            .map(|&(path, text)| {
                let rendered = if path == SKILL_FILE {
                    self.render_skill_file(text)
                } else {
                    text.to_owned()
                };
                (path, rendered)
            })
            .collect()
    }

    fn render_skill_file(&self, text: &str) -> String {
        let (frontmatter, body) = split_frontmatter(text);
        let mut lines: Vec<String> = frontmatter
            .lines()
            .map(|line| {
                if line.starts_with("name:") {
                    format!("name: {}", self.name)
                } else if line.starts_with("description:") && !self.is_release() {
                    format!(
                        "{line} This copy is for the Shift build whose command-line tool is {}.",
                        self.command
                    )
                } else {
                    line.to_owned()
                }
            })
            .collect();
        lines.push("metadata:".to_owned());
        lines.push(format!("  shift-version: \"{PRODUCT_VERSION}\""));
        lines.push(format!("  shift-command: \"{}\"", self.command));

        let preface = if self.is_release() {
            String::new()
        } else {
            format!(
                "\nThis build installs its command-line tool as `{0}`. Run `{0}` wherever this skill says `{RELEASE_COMMAND}`.\n",
                self.command
            )
        };
        format!("---\n{}\n---\n{preface}{body}", lines.join("\n"))
    }
}

/// Splits `---`-delimited YAML frontmatter from the Markdown body that follows it.
fn split_frontmatter(text: &str) -> (&str, &str) {
    text.strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n"))
        .expect("the embedded SKILL.md starts with frontmatter")
}

/// The name this program was run as, without a Windows `.exe` suffix.
fn invoked_command() -> Option<String> {
    let program = std::env::args_os().next()?;
    let stem = Path::new(&program).file_stem()?;
    Some(stem.to_string_lossy().into_owned())
}

/// Prints the skill overview or one reference, rendered for this build.
///
/// # Errors
///
/// Returns an error for an invalid `--command`.
pub fn show_skill(args: &ShowSkillArgs) -> Result<String> {
    let identity = SkillIdentity::resolve(&args.identity)?;
    let path = match args.topic {
        SkillTopic::Overview => SKILL_FILE,
        SkillTopic::Mcp => "references/mcp.md",
        SkillTopic::Cli => "references/cli.md",
        SkillTopic::Fonts => "references/fonts.md",
        SkillTopic::VariableFonts => "references/variable-fonts.md",
    };
    let mut files = identity.render();
    Ok(files.remove(path).expect("every topic is an embedded file"))
}

/// The state of one skill directory, compared with this command's skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillState {
    /// No skill directory of this name.
    Missing,
    /// Every file matches this command's skill.
    Current,
    /// Installed by shift-cli, but some file differs, is missing, or is extra.
    Stale,
    /// A directory of this name that shift-cli did not install.
    Foreign,
    /// Written by this command just now.
    Installed,
    /// A stale copy rewritten by this command just now.
    Updated,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTargetReport {
    pub path: PathBuf,
    pub state: SkillState,
    /// The Shift version that wrote this copy, when shift-cli installed it.
    pub installed_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReport {
    pub skill: String,
    pub command: String,
    pub version: String,
    pub targets: Vec<SkillTargetReport>,
}

impl SkillReport {
    pub fn render(&self) -> String {
        let mut lines = vec![format!(
            "{} {} ({})",
            self.skill, self.version, self.command
        )];
        for target in &self.targets {
            let state = match target.state {
                SkillState::Missing => "missing",
                SkillState::Current => "current",
                SkillState::Stale => "stale",
                SkillState::Foreign => "foreign",
                SkillState::Installed => "installed",
                SkillState::Updated => "updated",
            };
            let version = target
                .installed_version
                .as_ref()
                .filter(|version| version.as_str() != self.version)
                .map(|version| format!("  (from {version})"))
                .unwrap_or_default();
            lines.push(format!("  {state:<9}  {}{version}", target.path.display()));
        }
        lines.join("\n")
    }
}

/// Reports whether each agent directory holds this command's skill.
///
/// # Errors
///
/// Returns an error for an invalid `--command`, a missing home directory, or
/// an unreadable skill directory.
pub fn skill_status(args: &SkillStatusArgs) -> Result<SkillReport> {
    let identity = SkillIdentity::resolve(&args.identity)?;
    let files = identity.render();
    let targets = skill_directories(&identity, args.global, args.agent)?
        .into_iter()
        .map(|path| inspect(&path, &files))
        .collect::<Result<_>>()?;
    Ok(report(&identity, targets))
}

/// Writes this command's skill into each agent directory, replacing stale copies.
///
/// Nothing is written when a target holds a skill that shift-cli did not
/// install, unless `--force` is set. Each directory is staged beside its
/// destination and moved into place, so a failed write leaves the old copy.
///
/// # Errors
///
/// Returns an error for an invalid `--command`, a missing home directory, a
/// foreign skill without `--force`, or a filesystem failure.
pub fn install_skill(args: &InstallSkillArgs) -> Result<SkillReport> {
    let identity = SkillIdentity::resolve(&args.identity)?;
    let files = identity.render();
    let targets = skill_directories(&identity, args.global, args.agent)?
        .into_iter()
        .map(|path| inspect(&path, &files))
        .collect::<Result<Vec<_>>>()?;

    if !args.force && !args.refresh_only {
        let foreign: Vec<String> = targets
            .iter()
            .filter(|target| target.state == SkillState::Foreign)
            .map(|target| target.path.display().to_string())
            .collect();
        if !foreign.is_empty() {
            bail!(
                "a skill that shift-cli did not install is already at {}; pass --force to replace it",
                foreign.join(" and ")
            );
        }
    }

    let mut written = Vec::with_capacity(targets.len());
    for mut target in targets {
        let write = match target.state {
            SkillState::Stale => true,
            SkillState::Missing => !args.refresh_only,
            SkillState::Foreign => args.force && !args.refresh_only,
            _ => false,
        };
        if write {
            write_skill(&target.path, &files)?;
            target.state = if target.state == SkillState::Missing {
                SkillState::Installed
            } else {
                SkillState::Updated
            };
            target.installed_version = Some(PRODUCT_VERSION.to_owned());
        }
        written.push(target);
    }
    Ok(report(&identity, written))
}

fn report(identity: &SkillIdentity, targets: Vec<SkillTargetReport>) -> SkillReport {
    SkillReport {
        skill: identity.name.clone(),
        command: identity.command.clone(),
        version: PRODUCT_VERSION.to_owned(),
        targets,
    }
}

fn skill_directories(
    identity: &SkillIdentity,
    global: bool,
    agent: SkillAgent,
) -> Result<Vec<PathBuf>> {
    let base = if global {
        std::env::home_dir().ok_or_else(|| miette!("could not find your home directory"))?
    } else {
        std::env::current_dir().into_diagnostic()?
    };
    let roots: &[&str] = match agent {
        SkillAgent::All => &[".agents", ".claude"],
        SkillAgent::Agents => &[".agents"],
        SkillAgent::Claude => &[".claude"],
    };
    Ok(roots
        .iter()
        .map(|root| base.join(root).join("skills").join(&identity.name))
        .collect())
}

fn inspect(path: &Path, files: &BTreeMap<&'static str, String>) -> Result<SkillTargetReport> {
    let target = |state, installed_version| SkillTargetReport {
        path: path.to_owned(),
        state,
        installed_version,
    };
    if !path.exists() {
        return Ok(target(SkillState::Missing, None));
    }

    let skill_file = fs::read_to_string(path.join(SKILL_FILE)).unwrap_or_default();
    if metadata_value(&skill_file, "shift-command").is_none() {
        return Ok(target(SkillState::Foreign, None));
    }
    let installed_version = metadata_value(&skill_file, "shift-version");

    let installed = read_tree(path)?;
    let current = installed.len() == files.len()
        && files
            .iter()
            .all(|(file, text)| installed.get(*file) == Some(text));
    let state = if current {
        SkillState::Current
    } else {
        SkillState::Stale
    };
    Ok(target(state, installed_version))
}

/// Reads a quoted `metadata` value that shift-cli stamped into `SKILL.md`.
fn metadata_value(skill_file: &str, key: &str) -> Option<String> {
    let prefix = format!("  {key}: \"");
    skill_file
        .lines()
        .find_map(|line| line.strip_prefix(&prefix)?.strip_suffix('"'))
        .map(str::to_owned)
}

/// Every file under `root`, keyed by its `/`-separated relative path.
fn read_tree(root: &Path) -> Result<BTreeMap<String, String>> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read {}", directory.display()))?
        {
            let path = entry.into_diagnostic()?.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .expect("walked from root")
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            // A file that is not UTF-8 text is never one of ours, so it reads as a difference.
            files.insert(relative, fs::read_to_string(&path).unwrap_or_default());
        }
    }
    Ok(files)
}

fn write_skill(destination: &Path, files: &BTreeMap<&'static str, String>) -> Result<()> {
    let parent = destination
        .parent()
        .expect("skill directories sit inside a skills directory");
    fs::create_dir_all(parent)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to create {}", parent.display()))?;

    let staging = tempfile::Builder::new()
        .prefix(".shift-skill-")
        .tempdir_in(parent)
        .into_diagnostic()?;
    for (file, text) in files {
        let path = staging.path().join(file);
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).into_diagnostic()?;
        }
        fs::write(&path, text).into_diagnostic()?;
    }

    if destination.exists() {
        fs::remove_dir_all(destination)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to replace {}", destination.display()))?;
    }
    fs::rename(staging.keep(), destination)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to install {}", destination.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_every_file_of_the_skill() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../skills/shift");
        let on_disk: Vec<String> = read_tree(&root).unwrap().into_keys().collect();
        let embedded: Vec<&str> = FILES.iter().map(|(path, _)| *path).collect();
        assert_eq!(on_disk, embedded);
    }

    #[test]
    fn names_each_build_after_its_command() {
        let nightly = SkillIdentity::from_command("shift-cli-nightly").unwrap();
        assert_eq!(nightly.name, "shift-nightly");
        assert_eq!(
            SkillIdentity::from_command("shift-cli").unwrap(),
            SkillIdentity::release()
        );
        assert!(SkillIdentity::from_command("shift-cli-").is_none());
        assert!(SkillIdentity::from_command("shift-cliX").is_none());
        assert!(SkillIdentity::from_command("fontc").is_none());
    }

    #[test]
    fn stamps_skill_file_with_build_name_command_and_version() {
        let nightly = SkillIdentity::from_command("shift-cli-nightly").unwrap();
        let skill = nightly.render().remove(SKILL_FILE).unwrap();
        let (frontmatter, body) = split_frontmatter(&skill);

        assert!(
            frontmatter
                .lines()
                .any(|line| line == "name: shift-nightly")
        );
        assert_eq!(
            metadata_value(&skill, "shift-command").as_deref(),
            Some("shift-cli-nightly")
        );
        assert_eq!(
            metadata_value(&skill, "shift-version").as_deref(),
            Some(PRODUCT_VERSION)
        );
        assert!(
            body.starts_with("\nThis build installs its command-line tool as `shift-cli-nightly`")
        );

        let release = SkillIdentity::release()
            .render()
            .remove(SKILL_FILE)
            .unwrap();
        assert!(!release.contains("This build installs"));
    }
}
