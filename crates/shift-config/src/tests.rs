use super::*;

fn values(theme: Option<&str>) -> ConfigValues {
    ConfigValues {
        theme: theme.map(name),
    }
}

fn name(theme: &str) -> ThemeSetting {
    ThemeSetting::Name(theme.to_string())
}

fn slots(mode: Option<ThemeMode>, light: Option<&str>, dark: Option<&str>) -> ThemeSetting {
    ThemeSetting::Slots(ThemeSlots {
        mode,
        light: light.map(str::to_string),
        dark: dark.map(str::to_string),
    })
}

fn system_slots(light: &str, dark: &str) -> ThemeSetting {
    slots(Some(ThemeMode::System), Some(light), Some(dark))
}

#[test]
fn reads_the_theme() {
    let read = read_config("theme = \"nord\"\n");

    assert_eq!(read.values, Some(values(Some("nord"))));
    assert!(read.problems.is_empty());
}

#[test]
fn reads_an_empty_file_as_choosing_no_theme() {
    assert_eq!(
        read_config(""),
        ConfigRead {
            values: Some(values(None)),
            problems: Vec::new(),
        }
    );
}

#[test]
fn reports_a_syntax_error_with_its_location_and_applies_nothing() {
    let read = read_config("# rice\ntheme = \"nord\n");

    assert_eq!(read.values, None);
    let [problem] = read.problems.as_slice() else {
        panic!("expected one problem, got {:?}", read.problems);
    };
    assert_eq!(problem.severity, Severity::Error);
    assert_eq!(problem.location.map(|location| location.line), Some(2));
    assert!(!problem.message.contains('\n'), "{}", problem.message);
}

#[test]
fn rejects_a_theme_that_is_not_a_string_at_its_line() {
    let read = read_config("\ntheme = 3\n");

    assert_eq!(read.values, None);
    assert_eq!(
        read.problems,
        vec![ConfigProblem {
            severity: Severity::Error,
            message: "\"theme\" must be a theme name, such as theme = \"nord\", or a table, such as theme = { mode = \"system\", light = \"nord-light\", dark = \"nord\" }.".to_string(),
            location: Some(Location { line: 2, column: 1 }),
        }]
    );
}

#[test]
fn warns_about_unknown_keys_but_still_applies_known_ones() {
    let read = read_config("theme = \"nord\"\nacent = \"#fff\"\n\n[\"weird.(key\"]\n");

    assert_eq!(read.values, Some(values(Some("nord"))));
    assert_eq!(
        read.problems,
        vec![
            ConfigProblem {
                severity: Severity::Warning,
                message: "Unknown setting \"acent\" is ignored.".to_string(),
                location: Some(Location { line: 2, column: 1 }),
            },
            ConfigProblem {
                severity: Severity::Warning,
                message: "Unknown setting \"weird.(key\" is ignored.".to_string(),
                location: Some(Location { line: 4, column: 2 }),
            },
        ]
    );
}

#[test]
fn counts_columns_in_characters() {
    let read = read_config("é = 1\n");

    assert_eq!(
        read.problems[0].location,
        Some(Location { line: 1, column: 1 })
    );
    let read = read_config("x = \"é\" é\n");
    assert_eq!(
        read.problems[0].location.map(|location| location.column),
        Some(9)
    );
}

#[test]
fn creates_a_file_with_only_the_theme() {
    assert_eq!(
        set_theme(None, &name("nord")),
        Ok("theme = \"nord\"\n".to_string())
    );
}

#[test]
fn changes_only_the_theme_value_keeping_comments_and_layout() {
    let source =
        "# My rice\ntheme   =   \"dracula\"   # was nord\n\n[future]\ntheme = \"not-top-level\"\n";

    assert_eq!(
        set_theme(Some(source), &name("gruvbox-dark")),
        Ok(source.replace("\"dracula\"", "\"gruvbox-dark\""))
    );
}

#[test]
fn replaces_literal_and_quoted_key_forms() {
    assert_eq!(
        set_theme(Some("\"theme\" = 'nord'\n"), &name("system")),
        Ok("\"theme\" = \"system\"\n".to_string())
    );
}

#[test]
fn keeps_the_comment_after_a_value_containing_a_hash() {
    assert_eq!(
        set_theme(Some("theme = \"a#b\" # note\n"), &name("nord")),
        Ok("theme = \"nord\" # note\n".to_string())
    );
}

#[test]
fn adds_a_missing_theme_among_the_top_level_settings() {
    let edited = set_theme(
        Some("# header\nscale = 2\n\n[future]\nkey = 1\n"),
        &name("nord"),
    )
    .unwrap();

    assert_eq!(
        edited,
        "# header\nscale = 2\ntheme = \"nord\"\n\n[future]\nkey = 1\n"
    );
    assert_eq!(read_config(&edited).values, Some(values(Some("nord"))));
}

#[test]
fn appends_a_missing_theme_to_a_file_without_tables() {
    assert_eq!(
        set_theme(Some("# just a comment\n"), &name("nord")),
        Ok("# just a comment\ntheme = \"nord\"\n".to_string())
    );
}

#[test]
fn replaces_a_theme_written_as_a_multi_line_string() {
    let edited = set_theme(
        Some("theme = \"\"\"\nnord\"\"\" # pick\n"),
        &name("dracula"),
    )
    .unwrap();

    assert_eq!(edited, "theme = \"dracula\" # pick\n");
}

#[test]
fn refuses_a_file_that_does_not_parse() {
    assert_eq!(
        set_theme(Some("theme = \"nord"), &name("dracula")),
        Err(ConfigEditError::InvalidFile)
    );
}

#[test]
fn refuses_a_file_whose_theme_is_not_a_name_or_table() {
    assert_eq!(
        set_theme(Some("theme = [\"nord\"]\n"), &name("dracula")),
        Err(ConfigEditError::InvalidFile)
    );
}

#[test]
fn reads_an_inline_theme_table() {
    let read = read_config(
        "theme = { mode = \"system\", light = \"catppuccin-latte\", dark = \"nord\" }\n",
    );

    assert_eq!(
        read.values,
        Some(ConfigValues {
            theme: Some(system_slots("catppuccin-latte", "nord")),
        })
    );
    assert!(read.problems.is_empty());
}

#[test]
fn reads_a_theme_section_with_missing_keys() {
    let read = read_config("[theme]\ndark = \"nord\"\n");

    assert_eq!(
        read.values,
        Some(ConfigValues {
            theme: Some(slots(None, None, Some("nord"))),
        })
    );
}

#[test]
fn rejects_an_unknown_mode_at_its_line() {
    let read = read_config("[theme]\nmode = \"auto\"\n");

    assert_eq!(read.values, None);
    assert_eq!(
        read.problems,
        vec![ConfigProblem {
            severity: Severity::Error,
            message: "\"theme.mode\" must be \"system\", \"light\", or \"dark\".".to_string(),
            location: Some(Location { line: 2, column: 1 }),
        }]
    );
}

#[test]
fn rejects_a_slot_that_is_not_a_string() {
    let read = read_config("theme = { light = 3 }\n");

    assert_eq!(read.values, None);
    assert_eq!(
        read.problems[0].message,
        "\"theme.light\" must be a theme name, such as light = \"nord\"."
    );
    assert_eq!(
        read.problems[0].location,
        Some(Location {
            line: 1,
            column: 11
        })
    );
}

#[test]
fn warns_about_unknown_keys_in_the_theme_table() {
    let read = read_config("theme = { dark = \"nord\", accent = \"#fff\" }\n");

    assert_eq!(
        read.values,
        Some(ConfigValues {
            theme: Some(slots(None, None, Some("nord"))),
        })
    );
    assert_eq!(
        read.problems,
        vec![ConfigProblem {
            severity: Severity::Warning,
            message: "Unknown theme setting \"accent\" is ignored.".to_string(),
            location: Some(Location {
                line: 1,
                column: 26
            }),
        }]
    );
}

#[test]
fn creates_a_file_with_an_inline_theme_table() {
    assert_eq!(
        set_theme(None, &system_slots("catppuccin-latte", "nord")),
        Ok(
            "theme = { mode = \"system\", light = \"catppuccin-latte\", dark = \"nord\" }\n"
                .to_string()
        )
    );
}

#[test]
fn replaces_a_theme_name_with_a_table_keeping_its_comment() {
    assert_eq!(
        set_theme(
            Some("# rice\ntheme = \"nord\" # cold\n"),
            &system_slots("shift-light", "nord")
        ),
        Ok("# rice\ntheme = { mode = \"system\", light = \"shift-light\", dark = \"nord\" } # cold\n"
            .to_string())
    );
}

#[test]
fn changes_only_the_slot_values_of_a_theme_section() {
    let source = "[theme]\n# when it's sunny\nlight = \"tomorrow\"   # bright\ndark = \"nord\"\nmode = \"system\"\n";

    assert_eq!(
        set_theme(Some(source), &system_slots("github", "nord")),
        Ok(source.replace("\"tomorrow\"", "\"github\""))
    );
}

#[test]
fn adds_missing_slots_to_an_inline_theme_table() {
    let edited = set_theme(
        Some("theme = { dark = \"nord\" }\n"),
        &system_slots("github", "nord"),
    )
    .unwrap();

    assert_eq!(
        read_config(&edited).values,
        Some(ConfigValues {
            theme: Some(system_slots("github", "nord")),
        })
    );
    assert_eq!(
        edited,
        "theme = { dark = \"nord\", mode = \"system\", light = \"github\" }\n"
    );
}

#[test]
fn replaces_an_inline_theme_table_with_a_name() {
    assert_eq!(
        set_theme(
            Some("theme = { mode = \"dark\", dark = \"nord\" } # mine\n"),
            &name("dracula")
        ),
        Ok("theme = \"dracula\" # mine\n".to_string())
    );
}

#[test]
fn turns_a_theme_section_into_a_top_level_name() {
    let edited = set_theme(
        Some("scale = 2\n\n[theme]\ndark = \"nord\"\n\n[future]\nkey = 1\n"),
        &name("dracula"),
    )
    .unwrap();

    assert_eq!(read_config(&edited).values, Some(values(Some("dracula"))));
    assert!(edited.contains("[future]\nkey = 1"), "{edited}");
}
