use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

const PRODUCT_VERSION: &str = env!("SHIFT_PRODUCT_VERSION");

fn shift_in(directory: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shift-cli"))
        .args(args)
        .current_dir(directory)
        .env("HOME", directory.join("home"))
        .env("USERPROFILE", directory.join("home"))
        .output()
        .expect("shift CLI should run")
}

fn report(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn states(report: &Value) -> Vec<String> {
    report["targets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|target| target["state"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn version_is_the_shift_product_version() {
    let root = tempfile::tempdir().unwrap();
    let output = shift_in(root.path(), &["--version"]);

    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        format!("shift {PRODUCT_VERSION}")
    );
}

#[test]
fn installs_the_skill_for_every_agent_and_refreshes_a_stale_reference() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path();

    let installed = report(&shift_in(project, &["skill", "install", "--json"]));
    assert_eq!(states(&installed), ["installed", "installed"]);
    let skill = fs::read_to_string(project.join(".agents/skills/shift/SKILL.md")).unwrap();
    assert!(skill.contains("name: shift\n"));
    assert!(skill.contains(&format!("  shift-version: \"{PRODUCT_VERSION}\"")));
    assert!(
        project
            .join(".claude/skills/shift/references/cli.md")
            .is_file()
    );

    let reference = project.join(".claude/skills/shift/references/fonts.md");
    fs::write(&reference, "an older reference").unwrap();
    let status = report(&shift_in(project, &["skill", "status", "--json"]));
    assert_eq!(states(&status), ["current", "stale"]);

    let refreshed = report(&shift_in(
        project,
        &["skill", "install", "--refresh-only", "--json"],
    ));
    assert_eq!(states(&refreshed), ["current", "updated"]);
    assert_ne!(
        fs::read_to_string(&reference).unwrap(),
        "an older reference"
    );
}

#[test]
fn refresh_only_never_creates_a_skill() {
    let root = tempfile::tempdir().unwrap();
    let refreshed = report(&shift_in(
        root.path(),
        &["skill", "install", "--global", "--refresh-only", "--json"],
    ));

    assert_eq!(states(&refreshed), ["missing", "missing"]);
    assert!(!root.path().join("home/.agents").exists());
}

#[test]
fn each_build_installs_its_own_skill_globally() {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("home");

    report(&shift_in(
        root.path(),
        &["skill", "install", "-g", "--json"],
    ));
    let nightly = report(&shift_in(
        root.path(),
        &[
            "skill",
            "install",
            "-g",
            "--command",
            "shift-cli-nightly",
            "--json",
        ],
    ));

    assert_eq!(nightly["skill"], "shift-nightly");
    assert_eq!(states(&nightly), ["installed", "installed"]);
    let skill = fs::read_to_string(home.join(".agents/skills/shift-nightly/SKILL.md")).unwrap();
    assert!(skill.contains("name: shift-nightly\n"));
    assert!(skill.contains("Run `shift-cli-nightly` wherever this skill says `shift-cli`"));
    let release = fs::read_to_string(home.join(".agents/skills/shift/SKILL.md")).unwrap();
    assert!(release.contains("name: shift\n"));
}

#[test]
fn refuses_to_replace_a_skill_it_did_not_install() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path();
    let foreign = project.join(".claude/skills/shift");
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("SKILL.md"), "---\nname: shift\n---\nmine\n").unwrap();

    let refused = shift_in(project, &["skill", "install"]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("--force"));
    assert!(!project.join(".agents/skills/shift").exists());

    let forced = report(&shift_in(
        project,
        &["skill", "install", "--force", "--json"],
    ));
    assert_eq!(states(&forced), ["installed", "updated"]);
}

#[test]
fn shows_a_reference_rendered_for_the_build() {
    let root = tempfile::tempdir().unwrap();
    let output = shift_in(
        root.path(),
        &["skill", "show", "--command", "shift-cli-dev"],
    );
    let overview = String::from_utf8_lossy(&output.stdout);

    assert!(overview.contains("name: shift-dev\n"));
    assert!(overview.contains("Run `shift-cli-dev` wherever this skill says `shift-cli`"));

    let cli = shift_in(root.path(), &["skill", "show", "cli"]);
    assert!(String::from_utf8_lossy(&cli.stdout).starts_with("# shift-cli"));
}
