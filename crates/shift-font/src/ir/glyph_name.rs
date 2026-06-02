use serde::{Deserialize, Serialize};
use std::borrow::Borrow;
use std::fmt;
use std::ops::Deref;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GlyphName(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GlyphNameError {
    Empty,
}

impl GlyphName {
    pub fn new(value: impl Into<String>) -> Result<Self, GlyphNameError> {
        let value = value.into();
        if value.is_empty() {
            return Err(GlyphNameError::Empty);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl From<String> for GlyphName {
    fn from(value: String) -> Self {
        Self::new(value).expect("glyph name must not be empty")
    }
}

impl From<&str> for GlyphName {
    fn from(value: &str) -> Self {
        Self::from(value.to_string())
    }
}

impl From<GlyphName> for String {
    fn from(value: GlyphName) -> Self {
        value.0
    }
}

impl AsRef<str> for GlyphName {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Borrow<str> for GlyphName {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl Deref for GlyphName {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl fmt::Display for GlyphName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl fmt::Display for GlyphNameError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("glyph name must not be empty"),
        }
    }
}

impl std::error::Error for GlyphNameError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_names() {
        assert_eq!(GlyphName::new(""), Err(GlyphNameError::Empty));
    }

    #[test]
    fn borrows_as_str_for_map_lookup() {
        let mut names = std::collections::HashMap::new();
        names.insert(GlyphName::from("A"), 1);

        assert_eq!(names.get("A"), Some(&1));
    }
}
