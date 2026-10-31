use std::ops::Range;

use fea_rs::parse::ParseTree;
use fea_rs::{DiagnosticSet, Level};

/// How serious a [`FeatureDiagnostic`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

impl From<Level> for DiagnosticSeverity {
    fn from(level: Level) -> Self {
        match level {
            Level::Error => Self::Error,
            Level::Warning => Self::Warning,
            Level::Info => Self::Info,
        }
    }
}

/// One parse, validation, or compilation message about the feature source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureDiagnostic {
    pub severity: DiagnosticSeverity,
    pub message: String,
    /// Source range in UTF-16 code units, the offsets JavaScript strings and
    /// code editors use.
    pub range: Range<usize>,
}

/// Converts fea-rs diagnostics, whose spans are UTF-8 byte offsets, into
/// [`FeatureDiagnostic`]s.
pub(super) fn feature_diagnostics(
    diagnostics: &DiagnosticSet,
    tree: &ParseTree,
) -> Vec<FeatureDiagnostic> {
    diagnostics
        .diagnostics()
        .iter()
        .map(|diagnostic| {
            let source = tree
                .get_source(diagnostic.message.file)
                .map_or("", |source| source.text());
            let span = diagnostic.span();
            FeatureDiagnostic {
                severity: diagnostic.level.into(),
                message: diagnostic.message.text.clone(),
                range: utf16_offset(source, span.start)..utf16_offset(source, span.end),
            }
        })
        .collect()
}

/// Converts a byte offset into `source` to a UTF-16 offset, clamping an
/// offset past the end or inside a character to the end of the source.
fn utf16_offset(source: &str, byte_offset: usize) -> usize {
    source
        .get(..byte_offset)
        .unwrap_or(source)
        .encode_utf16()
        .count()
}
