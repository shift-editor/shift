//! Theme files: `themes/<id>.toml` in the config folder.
//!
//! A theme is a base16 palette plus whether it is light or dark:
//!
//! ```toml
//! name = "My Rice"
//! appearance = "dark"
//!
//! [palette]
//! base00 = "#1a1b26"
//! # … through base0F
//! ```
//!
//! Colors are six-digit hex, with or without `#`, so palettes copied from
//! base16 scheme files work unchanged.
//!
//! An optional `[colors]` table overrides individual colors Shift derives from
//! the palette, by name, such as `accent` or `editor-handle-primary-stroke`.
//! Override values may carry alpha as `#rrggbbaa`. This crate checks the form
//! of names and values; which names exist is the desktop renderer's to decide.

use std::collections::BTreeMap;

use toml_edit::{Document, Item, TableLike};

use crate::{ConfigProblem, Location, Severity, location};

/// The sixteen base16 palette keys, in order.
pub const PALETTE_KEYS: [&str; 16] = [
    "base00", "base01", "base02", "base03", "base04", "base05", "base06", "base07", "base08",
    "base09", "base0A", "base0B", "base0C", "base0D", "base0E", "base0F",
];

const KNOWN_KEYS: [&str; 4] = ["name", "appearance", "palette", "colors"];

/// Whether a theme's background is light or dark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

/// A valid theme file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Theme {
    /// The name shown in Settings; `None` when the file has none.
    pub name: Option<String>,
    pub appearance: Appearance,
    /// `base00` through `base0F` as lowercase `#rrggbb`.
    pub palette: [String; 16],
    /// Overrides of derived colors by name, as lowercase `#rrggbb` or `#rrggbbaa`.
    pub colors: BTreeMap<String, String>,
}

/// The result of reading a theme file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThemeRead {
    /// The theme, or `None` when an error means it cannot be used.
    pub theme: Option<Theme>,
    pub problems: Vec<ConfigProblem>,
}

/// Reads a theme file.
///
/// The appearance and all sixteen palette colors are required; a missing or
/// invalid one is an error. Unknown keys are warnings.
pub fn read_theme(source: &str) -> ThemeRead {
    let document = match Document::parse(source) {
        Ok(document) => document,
        Err(error) => {
            return ThemeRead {
                theme: None,
                problems: vec![error_problem(
                    error.message().trim_end().to_string(),
                    error.span().map(|span| location(source, span.start)),
                )],
            };
        }
    };
    let root = document.as_table();
    let at = |table: &dyn TableLike, key: &str| key_location(source, table, key);
    let mut problems = Vec::new();

    for (key, _) in root.iter().filter(|(key, _)| !KNOWN_KEYS.contains(key)) {
        problems.push(ConfigProblem {
            severity: Severity::Warning,
            message: format!("Unknown setting \"{key}\" is ignored."),
            location: at(root, key),
        });
    }

    let name = match root.get("name").map(Item::as_str) {
        None => None,
        Some(Some(name)) => Some(name.to_string()),
        Some(None) => {
            problems.push(error_problem(
                "\"name\" must be a string.",
                at(root, "name"),
            ));
            None
        }
    };

    let appearance = match root.get("appearance").and_then(Item::as_str) {
        Some("light") => Some(Appearance::Light),
        Some("dark") => Some(Appearance::Dark),
        _ => {
            problems.push(error_problem(
                "\"appearance\" must be \"light\" or \"dark\".",
                at(root, "appearance"),
            ));
            None
        }
    };

    let palette = match root.get("palette").and_then(Item::as_table_like) {
        Some(table) => read_palette(source, table, &mut problems),
        None => {
            problems.push(error_problem(
                "A theme needs a [palette] table with base00 through base0F.",
                at(root, "palette"),
            ));
            None
        }
    };

    let colors = match root.get("colors") {
        None => BTreeMap::new(),
        Some(item) => match item.as_table_like() {
            Some(table) => read_colors(source, table, &mut problems),
            None => {
                problems.push(error_problem(
                    "\"colors\" must be a table of color names and values.",
                    at(root, "colors"),
                ));
                BTreeMap::new()
            }
        },
    };

    let has_error = problems
        .iter()
        .any(|problem| problem.severity == Severity::Error);
    let theme = match (appearance, palette) {
        (Some(appearance), Some(palette)) if !has_error => Some(Theme {
            name,
            appearance,
            palette,
            colors,
        }),
        _ => None,
    };
    ThemeRead { theme, problems }
}

fn read_colors(
    source: &str,
    table: &dyn TableLike,
    problems: &mut Vec<ConfigProblem>,
) -> BTreeMap<String, String> {
    let mut colors = BTreeMap::new();
    for (name, item) in table.iter() {
        let location = key_location(source, table, name);
        if !is_color_name(name) {
            problems.push(error_problem(
                format!(
                    "\"{name}\" is not a color name; names are lowercase words joined by \"-\"."
                ),
                location,
            ));
            continue;
        }
        match item.as_str().and_then(normalize_override) {
            Some(color) => {
                colors.insert(name.to_string(), color);
            }
            None => problems.push(error_problem(
                format!("\"{name}\" must be a hex color such as \"#ff9e64\" or \"#ff9e6480\"."),
                location,
            )),
        }
    }
    colors
}

/// Whether `name` is lowercase words joined by `-`, as derived color names are.
fn is_color_name(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|word| {
            !word.is_empty()
                && word
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

/// Returns lowercase `#rrggbb` or `#rrggbbaa` for an override with or without `#`.
fn normalize_override(color: &str) -> Option<String> {
    let digits = color.strip_prefix('#').unwrap_or(color);
    let valid =
        matches!(digits.len(), 6 | 8) && digits.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then(|| format!("#{}", digits.to_ascii_lowercase()))
}

fn read_palette(
    source: &str,
    table: &dyn TableLike,
    problems: &mut Vec<ConfigProblem>,
) -> Option<[String; 16]> {
    let mut palette: [String; 16] = Default::default();
    let mut missing = Vec::new();
    for (slot, key) in palette.iter_mut().zip(PALETTE_KEYS) {
        // base16 scheme files differ on the case of the hex digit in the key.
        let found = table
            .get(key)
            .map(|item| (key.to_string(), item))
            .or_else(|| {
                let lower = key.to_ascii_lowercase();
                table.get(&lower).map(|item| (lower, item))
            });
        let Some((found_key, item)) = found else {
            missing.push(key);
            continue;
        };
        match item.as_str().and_then(normalize_color) {
            Some(color) => *slot = color,
            None => problems.push(error_problem(
                format!("\"{key}\" must be a six-digit hex color such as \"#1a1b26\"."),
                key_location(source, table, &found_key),
            )),
        }
    }

    if !missing.is_empty() {
        problems.push(error_problem(
            format!("The palette is missing {}.", missing.join(", ")),
            None,
        ));
    }
    let complete = missing.is_empty() && palette.iter().all(|color| !color.is_empty());
    complete.then_some(palette)
}

/// Returns `#rrggbb` in lowercase for a six-digit hex color with or without `#`.
fn normalize_color(color: &str) -> Option<String> {
    let digits = color.strip_prefix('#').unwrap_or(color);
    let valid = digits.len() == 6 && digits.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then(|| format!("#{}", digits.to_ascii_lowercase()))
}

fn key_location(source: &str, table: &dyn TableLike, key: &str) -> Option<Location> {
    table
        .get_key_value(key)
        .and_then(|(key, _)| key.span())
        .map(|span| location(source, span.start))
}

fn error_problem(message: impl Into<String>, location: Option<Location>) -> ConfigProblem {
    ConfigProblem {
        severity: Severity::Error,
        message: message.into(),
        location,
    }
}

#[cfg(test)]
mod tests;
