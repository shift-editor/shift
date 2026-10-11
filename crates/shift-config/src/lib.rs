//! Reads, validates, and edits Shift's `config.toml`.
//!
//! `config.toml` is a hand-edited dotfile, so this crate never rewrites what it
//! does not own: an edit replaces one value and keeps every comment, key, and
//! blank line around it. The app and `shift-cli` share it, so both agree on
//! what a valid file is.

use std::ops::Range;

use toml_edit::{Document, DocumentMut, Item, Value};

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

/// Settings read from a valid `config.toml`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfigValues {
    /// A theme id or `system`; `None` when the file does not choose one.
    pub theme: Option<String>,
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
        Some(item) => match item.as_str() {
            Some(theme) => Some(theme.to_string()),
            None => {
                problems.push(ConfigProblem {
                    severity: Severity::Error,
                    message: "\"theme\" must be a string, such as theme = \"nord\".".to_string(),
                    location: key_location("theme"),
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

/// Returns `source` with its top-level `theme` set to `theme`, changing only
/// that value.
///
/// Comments, key order, and whitespace elsewhere are preserved, as is any
/// comment after an existing value. A missing `theme` is added among the
/// top-level settings; `None` creates a file holding only `theme`.
///
/// # Errors
///
/// Returns [`ConfigEditError::InvalidFile`] when `source` has an error that
/// [`read_config`] reports, so an edit never overwrites a file the user is
/// still fixing.
pub fn set_theme(source: Option<&str>, theme: &str) -> Result<String, ConfigEditError> {
    let Some(source) = source else {
        let mut document = DocumentMut::new();
        document.insert("theme", toml_edit::value(theme));
        return Ok(document.to_string());
    };

    if read_config(source).values.is_none() {
        return Err(ConfigEditError::InvalidFile);
    }
    let mut document: DocumentMut = source.parse().map_err(|_| ConfigEditError::InvalidFile)?;

    match document.get_mut("theme").and_then(Item::as_value_mut) {
        Some(value) => {
            let decor = value.decor().clone();
            *value = Value::from(theme);
            *value.decor_mut() = decor;
        }
        None => {
            // A file of only comments keeps them in the document's trailing
            // text, which renders after every key; keep them first instead.
            let leading = document
                .trailing()
                .as_str()
                .filter(|trailing| document.is_empty() && !trailing.is_empty())
                .map(str::to_string);
            document.insert("theme", toml_edit::value(theme));
            if let Some(leading) = leading {
                document.set_trailing("");
                if let Some(mut key) = document.key_mut("theme") {
                    key.leaf_decor_mut().set_prefix(leading);
                }
            }
        }
    }
    Ok(document.to_string())
}

/// Converts a byte offset in `source` to a one-based line and character column.
fn location(source: &str, offset: usize) -> Location {
    let before = source.get(..offset).unwrap_or(source);
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    Location {
        line: before.matches('\n').count() + 1,
        column: before[line_start..].chars().count() + 1,
    }
}

#[cfg(test)]
mod tests;
