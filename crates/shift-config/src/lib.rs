//! Reads, validates, and edits Shift's `config.toml`.
//!
//! `config.toml` is a hand-edited dotfile, so this crate never rewrites what it
//! does not own: an edit replaces one value and keeps every comment, key, and
//! blank line around it. The app and `shift-cli` share it, so both agree on
//! what a valid file is.

// Library code returns errors instead of panicking: a panic kills the
// WebAssembly engine. Tests may unwrap (clippy.toml).
#![warn(clippy::unwrap_used, clippy::print_stdout)]

pub mod theme;

use std::ops::Range;

use toml_edit::{Document, DocumentMut, InlineTable, Item, Value};

/// Settings this build reads.
const KNOWN_KEYS: [&str; 1] = ["theme"];

/// How serious a [`ConfigProblem`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    /// The file was not applied; the caller keeps its last valid settings.
    Error,
    /// The file applied, but something in it was ignored.
    Warning,
}

/// One problem in `config.toml`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigProblem {
    pub severity: Severity,
    pub message: String,
    /// One-based line and column of the problem, when it has a location.
    pub location: Option<Location>,
}

/// A one-based line and column, in characters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Location {
    pub line: usize,
    pub column: usize,
}

/// Keys a `theme` table reads.
const THEME_KEYS: [&str; 3] = ["mode", "light", "dark"];

/// Which appearance a `theme` table uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeMode {
    /// Follow the operating system's light or dark appearance.
    System,
    Light,
    Dark,
}

impl ThemeMode {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

/// A `theme` table: a mode and the theme used in each appearance.
///
/// Missing keys are `None`; the app picks their defaults.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThemeSlots {
    pub mode: Option<ThemeMode>,
    pub light: Option<String>,
    pub dark: Option<String>,
}

/// The `theme` setting, in either of its two forms.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ThemeSetting {
    /// `theme = "nord"`: one theme id, or `system`.
    Name(String),
    /// `theme = { mode = "system", light = "…", dark = "…" }`, or a `[theme]` table.
    Slots(ThemeSlots),
}

/// Settings read from a valid `config.toml`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfigValues {
    /// `None` when the file does not choose a theme.
    pub theme: Option<ThemeSetting>,
}

/// The result of reading `config.toml`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigRead {
    /// The settings, or `None` when an error means the file must not be applied.
    pub values: Option<ConfigValues>,
    pub problems: Vec<ConfigProblem>,
}

/// Why `config.toml` could not be edited.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigEditError {
    #[error("config.toml has errors; fix it before changing settings in Shift.")]
    InvalidFile,
}

/// Reads the settings in a `config.toml` source.
///
/// Unknown keys are warnings rather than errors, so a file written for a newer
/// build still applies the settings this build understands.
pub fn read_config(source: &str) -> ConfigRead {
    let document = match Document::parse(source) {
        Ok(document) => document,
        Err(error) => {
            return ConfigRead {
                values: None,
                problems: vec![ConfigProblem {
                    severity: Severity::Error,
                    message: error.message().trim_end().to_string(),
                    location: error.span().map(|span| location(source, span.start)),
                }],
            };
        }
    };

    let root = document.as_table();
    let key_location = |key: &str| {
        root.get_key_value(key)
            .and_then(|(key, _)| key.span())
            .map(|span: Range<usize>| location(source, span.start))
    };

    let mut problems: Vec<ConfigProblem> = root
        .iter()
        .filter(|(key, _)| !KNOWN_KEYS.contains(key))
        .map(|(key, _)| ConfigProblem {
            severity: Severity::Warning,
            message: format!("Unknown setting \"{key}\" is ignored."),
            location: key_location(key),
        })
        .collect();

    let theme = match root.get("theme") {
        None => None,
        Some(item) => match read_theme(source, item, &mut problems) {
            Ok(theme) => Some(theme),
            Err(problem) => {
                problems.push(ConfigProblem {
                    location: problem.location.or_else(|| key_location("theme")),
                    ..problem
                });
                return ConfigRead {
                    values: None,
                    problems,
                };
            }
        },
    };

    ConfigRead {
        values: Some(ConfigValues { theme }),
        problems,
    }
}

/// Reads `theme` as a name or a table, adding warnings to `problems`.
fn read_theme(
    source: &str,
    item: &Item,
    problems: &mut Vec<ConfigProblem>,
) -> Result<ThemeSetting, ConfigProblem> {
    if let Some(name) = item.as_str() {
        return Ok(ThemeSetting::Name(name.to_string()));
    }
    let Some(table) = item.as_table_like() else {
        return Err(theme_error(
            "\"theme\" must be a theme name, such as theme = \"nord\", or a table, such as theme = { mode = \"system\", light = \"nord-light\", dark = \"nord\" }.",
            None,
        ));
    };

    let key_location = |key: &str| {
        table
            .get_key_value(key)
            .and_then(|(key, _)| key.span())
            .map(|span| location(source, span.start))
    };
    problems.extend(
        table
            .iter()
            .filter(|(key, _)| !THEME_KEYS.contains(key))
            .map(|(key, _)| ConfigProblem {
                severity: Severity::Warning,
                message: format!("Unknown theme setting \"{key}\" is ignored."),
                location: key_location(key),
            }),
    );

    let string = |key: &str| match table.get(key) {
        None => Ok(None),
        Some(item) => item
            .as_str()
            .map(|value| Some(value.to_string()))
            .ok_or_else(|| {
                theme_error(
                    &format!("\"theme.{key}\" must be a theme name, such as {key} = \"nord\"."),
                    key_location(key),
                )
            }),
    };
    let mode = match string("mode")? {
        None => None,
        Some(mode) => Some(ThemeMode::parse(&mode).ok_or_else(|| {
            theme_error(
                "\"theme.mode\" must be \"system\", \"light\", or \"dark\".",
                key_location("mode"),
            )
        })?),
    };
    Ok(ThemeSetting::Slots(ThemeSlots {
        mode,
        light: string("light")?,
        dark: string("dark")?,
    }))
}

fn theme_error(message: &str, location: Option<Location>) -> ConfigProblem {
    ConfigProblem {
        severity: Severity::Error,
        message: message.to_string(),
        location,
    }
}

/// Returns `source` with its top-level `theme` set to `theme`, changing only
/// that setting.
///
/// Comments, key order, and whitespace elsewhere are preserved, as is any
/// comment after an existing value. Slots written into an existing `theme`
/// table replace only their own values; a name replaces an inline table, and a
/// `[theme]` table becomes a top-level `theme` key. A missing `theme` is added
/// among the top-level settings; `None` creates a file holding only `theme`.
///
/// # Errors
///
/// Returns [`ConfigEditError::InvalidFile`] when `source` has an error that
/// [`read_config`] reports, so an edit never overwrites a file the user is
/// still fixing.
pub fn set_theme(source: Option<&str>, theme: &ThemeSetting) -> Result<String, ConfigEditError> {
    let Some(source) = source else {
        let mut document = DocumentMut::new();
        document.insert("theme", Item::Value(theme_value(theme)));
        return Ok(document.to_string());
    };

    if read_config(source).values.is_none() {
        return Err(ConfigEditError::InvalidFile);
    }
    let mut document: DocumentMut = source.parse().map_err(|_| ConfigEditError::InvalidFile)?;

    if let (ThemeSetting::Slots(slots), Some(item)) = (theme, document.get_mut("theme"))
        && item.is_table_like()
    {
        set_slots(item, slots);
        return Ok(document.to_string());
    }

    if document.get("theme").is_some_and(Item::is_table) {
        // A `[theme]` section can't hold a name; drop it and add the key below.
        document.remove("theme");
    }
    match document.get_mut("theme").and_then(Item::as_value_mut) {
        Some(value) => replace_value(value, theme_value(theme)),
        None => insert_top_level(&mut document, theme_value(theme)),
    }
    Ok(document.to_string())
}

/// Sets each slot in an existing `theme` table, keeping its other keys.
fn set_slots(item: &mut Item, slots: &ThemeSlots) {
    let Some(table) = item.as_table_like_mut() else {
        return;
    };
    let entries = [
        ("mode", slots.mode.map(|mode| mode.as_str().to_string())),
        ("light", slots.light.clone()),
        ("dark", slots.dark.clone()),
    ];
    let mut added = false;
    for (key, value) in entries {
        let Some(value) = value else { continue };
        match table.get_mut(key).and_then(Item::as_value_mut) {
            Some(existing) => replace_value(existing, Value::from(value)),
            None => {
                table.insert(key, toml_edit::value(value));
                added = true;
            }
        }
    }
    if let (true, Some(inline)) = (added, item.as_inline_table_mut()) {
        close_inline_table(inline);
    }
}

/// Moves the space before an inline table's `}` to its new last value.
fn close_inline_table(table: &mut InlineTable) {
    let count = table.len();
    for (index, (_, value)) in table.iter_mut().enumerate() {
        let decor = value.decor_mut();
        let blank = decor
            .suffix()
            .and_then(|suffix| suffix.as_str())
            .is_none_or(|suffix| suffix.trim().is_empty());
        if blank {
            decor.set_suffix(if index + 1 == count { " " } else { "" });
        }
    }
}

/// The value `theme` is written as: a string, or an inline table of the set slots.
fn theme_value(theme: &ThemeSetting) -> Value {
    match theme {
        ThemeSetting::Name(name) => Value::from(name.as_str()),
        ThemeSetting::Slots(slots) => {
            let mut table = InlineTable::new();
            if let Some(mode) = slots.mode {
                table.insert("mode", Value::from(mode.as_str()));
            }
            if let Some(light) = &slots.light {
                table.insert("light", Value::from(light.as_str()));
            }
            if let Some(dark) = &slots.dark {
                table.insert("dark", Value::from(dark.as_str()));
            }
            table.fmt();
            Value::InlineTable(table)
        }
    }
}

/// Replaces `value`, keeping the whitespace and comment around it.
fn replace_value(value: &mut Value, next: Value) {
    let decor = value.decor().clone();
    *value = next;
    *value.decor_mut() = decor;
}

/// Adds `theme` among the top-level settings.
fn insert_top_level(document: &mut DocumentMut, value: Value) {
    // A file of only comments keeps them in the document's trailing text,
    // which renders after every key; keep them first instead.
    let leading = document
        .trailing()
        .as_str()
        .filter(|trailing| document.is_empty() && !trailing.is_empty())
        .map(str::to_string);
    document.insert("theme", Item::Value(value));
    if let Some(leading) = leading {
        document.set_trailing("");
        if let Some(mut key) = document.key_mut("theme") {
            key.leaf_decor_mut().set_prefix(leading);
        }
    }
}

/// Converts a byte offset in `source` to a one-based line and character column.
pub(crate) fn location(source: &str, offset: usize) -> Location {
    let before = source.get(..offset).unwrap_or(source);
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    Location {
        line: before.matches('\n').count() + 1,
        column: before[line_start..].chars().count() + 1,
    }
}

#[cfg(test)]
mod tests;
