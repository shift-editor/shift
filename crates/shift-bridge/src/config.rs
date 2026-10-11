//! `config.toml` reading and editing for the desktop main process.
//!
//! These functions hold no state and touch no files: main owns the file and
//! passes its text in, so reads and writes stay atomic on the JavaScript side.

use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_config::{ConfigProblem, Severity};

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

/// The settings in a `config.toml` source.
#[napi(object)]
pub struct NapiConfigRead {
  /// Whether the file may be applied; `false` when any problem is an error.
  pub valid: bool,
  /// The selected theme, when the file is valid and chooses one.
  pub theme: Option<String>,
  pub problems: Vec<NapiConfigProblem>,
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
  NapiConfigRead {
    valid: read.values.is_some(),
    theme: read.values.and_then(|values| values.theme),
    problems: read.problems.into_iter().map(Into::into).collect(),
  }
}

/// Returns `source` with its theme set, preserving everything else; `null`
/// source creates a new file.
///
/// # Errors
///
/// Throws when `source` has errors, so an edit never overwrites a file the
/// user is still fixing.
#[napi]
pub fn config_set_theme(source: Option<String>, theme: String) -> Result<String> {
  shift_config::set_theme(source.as_deref(), &theme)
    .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))
}
