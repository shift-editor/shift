//! `config.toml` reading and editing for the desktop main process.
//!
//! These functions hold no state and touch no files: main owns the file and
//! passes its text in, so reads and writes stay atomic on the JavaScript side.

use shift_wire::bridges::napi::IntoEach;
use std::collections::HashMap;

use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_config::theme::Appearance;
use shift_config::{ConfigProblem, Severity, ThemeMode, ThemeSetting, ThemeSlots};

/// How serious a config problem is: `error` keeps the last valid settings,
/// `warning` applies the file but ignores something in it.
#[napi(string_enum = "lowercase")]
pub enum NapiConfigSeverity {
  Error,
  Warning,
}

/// One problem in `config.toml`; line and column are one-based.
#[napi(object)]
pub struct NapiConfigProblem {
  pub severity: NapiConfigSeverity,
  pub message: String,
  pub line: Option<u32>,
  pub column: Option<u32>,
}

/// Which appearance a `theme` table uses.
#[napi(string_enum = "lowercase")]
pub enum NapiThemeMode {
  System,
  Light,
  Dark,
}

/// A `theme` table: a mode and the theme used in each appearance; missing
/// keys are left to the app's defaults.
#[napi(object)]
pub struct NapiThemeSlots {
  pub mode: Option<NapiThemeMode>,
  pub light: Option<String>,
  pub dark: Option<String>,
}

/// The settings in a `config.toml` source.
#[napi(object)]
pub struct NapiConfigRead {
  /// Whether the file may be applied; `false` when any problem is an error.
  pub valid: bool,
  /// The theme name, when the file is valid and writes `theme = "…"`.
  pub theme: Option<String>,
  /// The theme table, when the file is valid and writes `theme` as a table.
  pub theme_slots: Option<NapiThemeSlots>,
  pub problems: Vec<NapiConfigProblem>,
}

impl From<ThemeSlots> for NapiThemeSlots {
  fn from(slots: ThemeSlots) -> Self {
    Self {
      mode: slots.mode.map(|mode| match mode {
        ThemeMode::System => NapiThemeMode::System,
        ThemeMode::Light => NapiThemeMode::Light,
        ThemeMode::Dark => NapiThemeMode::Dark,
      }),
      light: slots.light,
      dark: slots.dark,
    }
  }
}

impl From<NapiThemeSlots> for ThemeSlots {
  fn from(slots: NapiThemeSlots) -> Self {
    Self {
      mode: slots.mode.map(|mode| match mode {
        NapiThemeMode::System => ThemeMode::System,
        NapiThemeMode::Light => ThemeMode::Light,
        NapiThemeMode::Dark => ThemeMode::Dark,
      }),
      light: slots.light,
      dark: slots.dark,
    }
  }
}

impl From<ConfigProblem> for NapiConfigProblem {
  fn from(problem: ConfigProblem) -> Self {
    let severity = match problem.severity {
      Severity::Error => NapiConfigSeverity::Error,
      Severity::Warning => NapiConfigSeverity::Warning,
    };
    Self {
      severity,
      message: problem.message,
      // A location past u32 is reported without one rather than wrapped.
      line: problem
        .location
        .and_then(|location| u32::try_from(location.line).ok()),
      column: problem
        .location
        .and_then(|location| u32::try_from(location.column).ok()),
    }
  }
}

/// Reads the settings in a `config.toml` source.
#[napi]
pub fn config_read(source: String) -> NapiConfigRead {
  let read = shift_config::read_config(&source);
  let valid = read.values.is_some();
  let (theme, theme_slots) = match read.values.and_then(|values| values.theme) {
    None => (None, None),
    Some(ThemeSetting::Name(name)) => (Some(name), None),
    Some(ThemeSetting::Slots(slots)) => (None, Some(slots.into())),
  };
  NapiConfigRead {
    valid,
    theme,
    theme_slots,
    problems: read.problems.into_each(),
  }
}

/// Returns `source` with `theme = "…"` set, preserving everything else;
/// `null` source creates a new file.
///
/// # Errors
///
/// Throws when `source` has errors, so an edit never overwrites a file the
/// user is still fixing.
#[napi]
pub fn config_set_theme(source: Option<String>, theme: String) -> Result<String> {
  set_theme(source, ThemeSetting::Name(theme))
}

/// Returns `source` with its `theme` table set, editing an existing table in
/// place; `null` source creates a new file.
///
/// # Errors
///
/// Throws when `source` has errors, so an edit never overwrites a file the
/// user is still fixing.
#[napi]
pub fn config_set_theme_slots(source: Option<String>, slots: NapiThemeSlots) -> Result<String> {
  set_theme(source, ThemeSetting::Slots(slots.into()))
}

fn set_theme(source: Option<String>, theme: ThemeSetting) -> Result<String> {
  shift_config::set_theme(source.as_deref(), &theme)
    .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))
}

/// Whether a theme's background is light or dark.
#[napi(string_enum = "lowercase")]
pub enum NapiThemeAppearance {
  Light,
  Dark,
}

/// A valid theme file's contents.
#[napi(object)]
pub struct NapiThemeFile {
  /// The name shown in Settings, when the file sets one.
  pub name: Option<String>,
  pub appearance: NapiThemeAppearance,
  /// `base00` through `base0F` as lowercase `#rrggbb`.
  pub palette: Vec<String>,
  /// Overrides of derived colors by name, as `#rrggbb` or `#rrggbbaa`.
  pub colors: HashMap<String, String>,
}

/// The result of reading a theme file.
#[napi(object)]
pub struct NapiThemeRead {
  /// The theme, or nothing when an error means it cannot be used.
  pub theme: Option<NapiThemeFile>,
  pub problems: Vec<NapiConfigProblem>,
}

/// Reads a `themes/<id>.toml` file.
#[napi]
pub fn theme_read(source: String) -> NapiThemeRead {
  let read = shift_config::theme::read_theme(&source);
  NapiThemeRead {
    theme: read.theme.map(|theme| NapiThemeFile {
      name: theme.name,
      appearance: match theme.appearance {
        Appearance::Light => NapiThemeAppearance::Light,
        Appearance::Dark => NapiThemeAppearance::Dark,
      },
      palette: theme.palette.into(),
      colors: theme.colors.into_iter().collect(),
    }),
    problems: read.problems.into_each(),
  }
}
