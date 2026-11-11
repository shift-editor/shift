//! Metrics keys: the text that links a glyph's sidebearings or width to
//! other glyphs' metrics, such as `=n`, `=n+10`, or `=|`.
//!
//! A glyph holds keys that apply in every source, and a layer holds keys
//! that apply in its source only, as Glyphs stores them. Keys are kept as
//! authored and are not evaluated here, so a key survives a round trip
//! unchanged even when it names a glyph the font lacks.

use serde::{Deserialize, Serialize};

/// One metrics key as its author wrote it, such as `=n+10`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MetricsKey(String);

impl MetricsKey {
    /// A key from its text, or `None` for empty or whitespace-only text,
    /// which sources write to mean "no key".
    pub fn new(text: impl Into<String>) -> Option<Self> {
        let text = text.into();
        if text.trim().is_empty() {
            return None;
        }
        Some(Self(text))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for MetricsKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The metric a key sets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum MetricsKeySide {
    Left,
    Right,
    Width,
}

impl MetricsKeySide {
    pub const ALL: [Self; 3] = [Self::Left, Self::Right, Self::Width];
}

/// The keys set on a glyph or a layer; each side is optional.
///
/// Every side is always serialized, even when unset: layers are stored as
/// positional MessagePack, where a skipped side would shift the ones after it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MetricsKeys {
    left: Option<MetricsKey>,
    right: Option<MetricsKey>,
    width: Option<MetricsKey>,
}

impl MetricsKeys {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether no side has a key.
    pub fn is_empty(&self) -> bool {
        self.left.is_none() && self.right.is_none() && self.width.is_none()
    }

    /// The key set for `side`, if any.
    pub fn get(&self, side: MetricsKeySide) -> Option<&MetricsKey> {
        match side {
            MetricsKeySide::Left => self.left.as_ref(),
            MetricsKeySide::Right => self.right.as_ref(),
            MetricsKeySide::Width => self.width.as_ref(),
        }
    }

    /// Sets or clears the key for `side`.
    pub fn set(&mut self, side: MetricsKeySide, key: Option<MetricsKey>) {
        let slot = match side {
            MetricsKeySide::Left => &mut self.left,
            MetricsKeySide::Right => &mut self.right,
            MetricsKeySide::Width => &mut self.width,
        };
        *slot = key;
    }

    /// Each side that has a key, with its key, in left, right, width order.
    pub fn iter(&self) -> impl Iterator<Item = (MetricsKeySide, &MetricsKey)> {
        MetricsKeySide::ALL
            .into_iter()
            .filter_map(|side| self.get(side).map(|key| (side, key)))
    }
}

impl FromIterator<(MetricsKeySide, MetricsKey)> for MetricsKeys {
    fn from_iter<I: IntoIterator<Item = (MetricsKeySide, MetricsKey)>>(iter: I) -> Self {
        let mut keys = Self::new();
        for (side, key) in iter {
            keys.set(side, Some(key));
        }
        keys
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_is_no_key() {
        assert_eq!(MetricsKey::new(""), None);
        assert_eq!(MetricsKey::new("  "), None);
        assert_eq!(
            MetricsKey::new("=n").map(|key| key.to_string()),
            Some("=n".to_string())
        );
    }

    #[test]
    fn keys_set_and_clear_each_side() {
        let mut keys: MetricsKeys = [
            (MetricsKeySide::Left, MetricsKey::new("=n").unwrap()),
            (MetricsKeySide::Width, MetricsKey::new("=o*1.2").unwrap()),
        ]
        .into_iter()
        .collect();

        assert_eq!(
            keys.get(MetricsKeySide::Left).map(MetricsKey::as_str),
            Some("=n")
        );
        assert_eq!(keys.get(MetricsKeySide::Right), None);
        assert_eq!(
            keys.iter().map(|(side, _)| side).collect::<Vec<_>>(),
            [MetricsKeySide::Left, MetricsKeySide::Width]
        );

        keys.set(MetricsKeySide::Left, None);
        keys.set(MetricsKeySide::Width, None);
        assert!(keys.is_empty());
    }
}
