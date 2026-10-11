use super::*;

fn values(theme: Option<&str>) -> Option<ConfigValues> {
    Some(ConfigValues {
        theme: theme.map(str::to_string),
    })
}

#[test]
fn reads_the_theme() {
    let read = read_config("theme = \"nord\"\n");

    assert_eq!(read.values, values(Some("nord")));
    assert!(read.problems.is_empty());
}

#[test]
fn reads_an_empty_file_as_choosing_no_theme() {
    assert_eq!(
        read_config(""),
        ConfigRead {
            values: values(None),
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
            message: "\"theme\" must be a string, such as theme = \"nord\".".to_string(),
            location: Some(Location { line: 2, column: 1 }),
        }]
    );
}

#[test]
fn warns_about_unknown_keys_but_still_applies_known_ones() {
    let read = read_config("theme = \"nord\"\nacent = \"#fff\"\n\n[\"weird.(key\"]\n");

    assert_eq!(read.values, values(Some("nord")));
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
        set_theme(None, "nord"),
        Ok("theme = \"nord\"\n".to_string())
    );
}

#[test]
fn changes_only_the_theme_value_keeping_comments_and_layout() {
    let source =
        "# My rice\ntheme   =   \"dracula\"   # was nord\n\n[future]\ntheme = \"not-top-level\"\n";

    assert_eq!(
        set_theme(Some(source), "gruvbox-dark"),
        Ok(source.replace("\"dracula\"", "\"gruvbox-dark\""))
    );
}

#[test]
fn replaces_literal_and_quoted_key_forms() {
    assert_eq!(
        set_theme(Some("\"theme\" = 'nord'\n"), "system"),
        Ok("\"theme\" = \"system\"\n".to_string())
    );
}

#[test]
fn keeps_the_comment_after_a_value_containing_a_hash() {
    assert_eq!(
        set_theme(Some("theme = \"a#b\" # note\n"), "nord"),
        Ok("theme = \"nord\" # note\n".to_string())
    );
}

#[test]
fn adds_a_missing_theme_among_the_top_level_settings() {
    let edited = set_theme(Some("# header\nscale = 2\n\n[future]\nkey = 1\n"), "nord").unwrap();

    assert_eq!(
        edited,
        "# header\nscale = 2\ntheme = \"nord\"\n\n[future]\nkey = 1\n"
    );
    assert_eq!(read_config(&edited).values, values(Some("nord")));
}

#[test]
fn appends_a_missing_theme_to_a_file_without_tables() {
    assert_eq!(
        set_theme(Some("# just a comment\n"), "nord"),
        Ok("# just a comment\ntheme = \"nord\"\n".to_string())
    );
}

#[test]
fn replaces_a_theme_written_as_a_multi_line_string() {
    let edited = set_theme(Some("theme = \"\"\"\nnord\"\"\" # pick\n"), "dracula").unwrap();

    assert_eq!(edited, "theme = \"dracula\" # pick\n");
}

#[test]
fn refuses_a_file_that_does_not_parse() {
    assert_eq!(
        set_theme(Some("theme = \"nord"), "dracula"),
        Err(ConfigEditError::InvalidFile)
    );
}

#[test]
fn refuses_a_file_whose_theme_is_not_a_string() {
    assert_eq!(
        set_theme(Some("[theme]\nname = \"nord\"\n"), "dracula"),
        Err(ConfigEditError::InvalidFile)
    );
}
