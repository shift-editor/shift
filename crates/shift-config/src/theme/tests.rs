use std::collections::BTreeMap;

use super::*;

const PALETTE: &str = r##"[palette]
base00 = "#1A1B26"
base01 = "16161e"
base02 = "#2f3549"
base03 = "#444b6a"
base04 = "#787c99"
base05 = "#a9b1d6"
base06 = "#cbccd1"
base07 = "#d5d6db"
base08 = "#c0caf5"
base09 = "#a9b1d6"
base0a = "#0db9d7"
base0B = "#9ece6a"
base0C = "#b4f9f8"
base0D = "#2ac3de"
base0E = "#bb9af7"
base0F = "#f7768e"
"##;

fn theme_source(head: &str) -> String {
    format!("{head}\n{PALETTE}")
}

#[test]
fn reads_a_theme_normalizing_colors_and_key_case() {
    let read = read_theme(&theme_source("name = \"Night\"\nappearance = \"dark\""));

    assert!(read.problems.is_empty(), "{:?}", read.problems);
    let theme = read.theme.expect("valid theme");
    assert_eq!(theme.name.as_deref(), Some("Night"));
    assert_eq!(theme.appearance, Appearance::Dark);
    assert_eq!(theme.palette[0], "#1a1b26");
    assert_eq!(theme.palette[1], "#16161e");
    assert_eq!(theme.palette[10], "#0db9d7");
}

#[test]
fn a_name_is_optional() {
    let read = read_theme(&theme_source("appearance = \"light\""));

    assert_eq!(read.theme.map(|theme| theme.name), Some(None));
}

#[test]
fn requires_light_or_dark_appearance_at_its_line() {
    let read = read_theme(&theme_source("appearance = \"dim\""));

    assert_eq!(read.theme, None);
    assert_eq!(
        read.problems,
        vec![ConfigProblem {
            severity: Severity::Error,
            message: "\"appearance\" must be \"light\" or \"dark\".".to_string(),
            location: Some(Location { line: 1, column: 1 }),
        }]
    );
}

#[test]
fn names_every_missing_palette_color() {
    let source = "appearance = \"dark\"\n[palette]\nbase00 = \"#000000\"\n";
    let read = read_theme(source);

    assert_eq!(read.theme, None);
    let message = &read.problems[0].message;
    assert!(
        message.starts_with("The palette is missing base01, base02,"),
        "{message}"
    );
    assert!(message.ends_with("base0F."), "{message}");
}

#[test]
fn rejects_a_color_that_is_not_six_digit_hex_at_its_line() {
    let source = theme_source("appearance = \"dark\"").replace("\"#2f3549\"", "\"#fff\"");
    let read = read_theme(&source);

    assert_eq!(read.theme, None);
    assert_eq!(
        read.problems,
        vec![ConfigProblem {
            severity: Severity::Error,
            message: "\"base02\" must be a six-digit hex color such as \"#1a1b26\".".to_string(),
            location: Some(Location { line: 5, column: 1 }),
        }]
    );
}

#[test]
fn warns_about_unknown_keys_and_still_reads_the_theme() {
    let read = read_theme(&theme_source("appearance = \"dark\"\nauthor = \"me\""));

    assert!(read.theme.is_some());
    assert_eq!(read.problems.len(), 1);
    assert_eq!(read.problems[0].severity, Severity::Warning);
}

#[test]
fn requires_a_palette_table() {
    let read = read_theme("appearance = \"dark\"\n");

    assert_eq!(read.theme, None);
    assert!(read.problems[0].message.contains("[palette]"));
}

#[test]
fn reads_color_overrides_with_alpha() {
    let source = format!(
        "{}\n[colors]\naccent = \"#FF9E64\"\neditor-selection-fill = \"ff9e6420\"\n",
        theme_source("appearance = \"dark\"")
    );
    let theme = read_theme(&source).theme.expect("valid theme");

    assert_eq!(
        theme.colors,
        BTreeMap::from([
            ("accent".to_string(), "#ff9e64".to_string()),
            ("editor-selection-fill".to_string(), "#ff9e6420".to_string()),
        ])
    );
}

#[test]
fn rejects_malformed_color_names_and_values_at_their_lines() {
    let source = format!(
        "{}\n[colors]\nAccent = \"#ff9e64\"\naccent = \"rgb(1, 2, 3)\"\n",
        theme_source("appearance = \"dark\"")
    );
    let read = read_theme(&source);

    assert_eq!(read.theme, None);
    let lines: Vec<_> = read
        .problems
        .iter()
        .map(|problem| problem.location.map(|location| location.line))
        .collect();
    assert_eq!(lines, vec![Some(21), Some(22)]);
}
