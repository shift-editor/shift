use serde::{Deserialize, Serialize};
use std::borrow::Borrow;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};

static ENTITY_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(u64);

impl EntityId {
    pub fn new() -> Self {
        Self(ENTITY_COUNTER.fetch_add(1, Ordering::Relaxed))
    }

    pub fn raw(&self) -> u64 {
        self.0
    }

    pub fn from_raw(raw: u64) -> Self {
        Self(raw)
    }
}

impl Default for EntityId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for EntityId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

macro_rules! typed_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(EntityId);

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl $name {
            pub fn new() -> Self {
                Self(EntityId::new())
            }

            pub fn raw(&self) -> u64 {
                self.0.raw()
            }

            pub fn from_raw(raw: u128) -> Self {
                Self(EntityId::from_raw(raw as u64))
            }
        }

        impl From<$name> for u64 {
            fn from(id: $name) -> u64 {
                id.raw()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = std::num::ParseIntError;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                let raw: u64 = s.parse()?;
                Ok(Self::from_raw(raw as u128))
            }
        }
    };
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ComponentId(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComponentIdParseError;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GlyphId(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlyphIdParseError;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SourceId(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceIdParseError;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AxisId(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AxisIdParseError;

impl ComponentId {
    pub fn new() -> Self {
        Self(format!("component_{:020}", EntityId::new().raw()))
    }

    pub fn from_raw(raw: u128) -> Self {
        Self(raw.to_string())
    }

    pub fn from_stable(id: impl Into<String>) -> Result<Self, ComponentIdParseError> {
        let id = id.into();
        if id.is_empty() {
            return Err(ComponentIdParseError);
        }
        Ok(Self(id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for ComponentId {
    fn default() -> Self {
        Self::new()
    }
}

impl Borrow<str> for ComponentId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for ComponentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl fmt::Display for ComponentIdParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "component ID must not be empty")
    }
}

impl std::error::Error for ComponentIdParseError {}

impl std::str::FromStr for ComponentId {
    type Err = ComponentIdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_stable(s)
    }
}

impl GlyphId {
    pub fn new() -> Self {
        Self(format!("glyph_{:020}", EntityId::new().raw()))
    }

    pub fn for_name(name: &str) -> Self {
        stable_label_id("glyph", name).map(Self).unwrap_or_default()
    }

    pub fn from_raw(raw: u128) -> Self {
        Self(raw.to_string())
    }

    pub fn from_stable(id: impl Into<String>) -> Result<Self, GlyphIdParseError> {
        let id = id.into();
        if id.is_empty() {
            return Err(GlyphIdParseError);
        }
        Ok(Self(id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl SourceId {
    pub fn new() -> Self {
        Self(format!("source_{:020}", EntityId::new().raw()))
    }

    pub fn for_name(name: &str) -> Self {
        stable_label_id("source", name)
            .map(Self)
            .unwrap_or_default()
    }

    pub fn from_raw(raw: u128) -> Self {
        Self(raw.to_string())
    }

    pub fn from_stable(id: impl Into<String>) -> Result<Self, SourceIdParseError> {
        let id = id.into();
        if id.is_empty() {
            return Err(SourceIdParseError);
        }
        Ok(Self(id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AxisId {
    pub fn new() -> Self {
        Self(format!("axis_{:020}", EntityId::new().raw()))
    }

    pub fn for_tag(tag: &str) -> Self {
        stable_label_id("axis", tag).map(Self).unwrap_or_default()
    }

    pub fn from_raw(raw: u128) -> Self {
        Self(raw.to_string())
    }

    pub fn from_stable(id: impl Into<String>) -> Result<Self, AxisIdParseError> {
        let id = id.into();
        if id.is_empty() {
            return Err(AxisIdParseError);
        }
        Ok(Self(id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn stable_label_id(prefix: &str, label: &str) -> Option<String> {
    let mut id = String::with_capacity(prefix.len() + label.len() + 1);
    id.push_str(prefix);
    id.push('_');

    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            id.push(ch);
        } else {
            id.push('_');
        }
    }

    while id.contains("__") {
        id = id.replace("__", "_");
    }

    let id = id.trim_end_matches('_');
    if id == prefix {
        return None;
    }

    Some(id.to_string())
}

impl Default for GlyphId {
    fn default() -> Self {
        Self::new()
    }
}

impl Borrow<str> for GlyphId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for GlyphId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl fmt::Display for GlyphIdParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "glyph ID must not be empty")
    }
}

impl std::error::Error for GlyphIdParseError {}

impl std::str::FromStr for GlyphId {
    type Err = GlyphIdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_stable(s)
    }
}

impl Default for SourceId {
    fn default() -> Self {
        Self::new()
    }
}

impl Borrow<str> for SourceId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for SourceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl fmt::Display for SourceIdParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "source ID must not be empty")
    }
}

impl std::error::Error for SourceIdParseError {}

impl std::str::FromStr for SourceId {
    type Err = SourceIdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_stable(s)
    }
}

impl Default for AxisId {
    fn default() -> Self {
        Self::new()
    }
}

impl Borrow<str> for AxisId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for AxisId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl fmt::Display for AxisIdParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "axis ID must not be empty")
    }
}

impl std::error::Error for AxisIdParseError {}

impl std::str::FromStr for AxisId {
    type Err = AxisIdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_stable(s)
    }
}

typed_id!(PointId);
typed_id!(ContourId);
typed_id!(AnchorId);
typed_id!(GuidelineId);
typed_id!(LayerId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_id_is_unique() {
        let id1 = EntityId::new();
        let id2 = EntityId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn typed_id_from_raw_roundtrip() {
        let original = PointId::new();
        let raw = original.raw();
        let reconstructed = PointId::from_raw(raw as u128);
        assert_eq!(original, reconstructed);
    }

    #[test]
    fn typed_id_display_and_parse() {
        let id = ContourId::from_raw(12345u128);
        assert_eq!(id.to_string(), "12345");
        let parsed: ContourId = "12345".parse().unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn component_id_accepts_stable_string_ids() {
        let id = ComponentId::from_stable("A.component.base").unwrap();
        let parsed: ComponentId = "A.component.base".parse().unwrap();

        assert_eq!(id, parsed);
        assert_eq!(id.as_str(), "A.component.base");
        assert!("".parse::<ComponentId>().is_err());
    }

    #[test]
    fn glyph_id_accepts_stable_string_ids() {
        let id = GlyphId::from_stable("glyph_A").unwrap();
        let parsed: GlyphId = "glyph_A".parse().unwrap();

        assert_eq!(id, parsed);
        assert_eq!(id.as_str(), "glyph_A");
        assert!("".parse::<GlyphId>().is_err());
    }

    #[test]
    fn glyph_id_for_name_keeps_readable_ascii_names() {
        assert_eq!(GlyphId::for_name("Aacute").as_str(), "glyph_Aacute");
        assert_eq!(GlyphId::for_name("A.alt").as_str(), "glyph_A_alt");
    }

    #[test]
    fn source_id_accepts_stable_string_ids() {
        let id = SourceId::from_stable("source_Regular").unwrap();
        let parsed: SourceId = "source_Regular".parse().unwrap();

        assert_eq!(id, parsed);
        assert_eq!(id.as_str(), "source_Regular");
        assert!("".parse::<SourceId>().is_err());
    }

    #[test]
    fn source_id_for_name_keeps_readable_ascii_names() {
        assert_eq!(SourceId::for_name("Regular").as_str(), "source_Regular");
        assert_eq!(
            SourceId::for_name("Bold Italic").as_str(),
            "source_Bold_Italic"
        );
    }

    #[test]
    fn axis_id_accepts_stable_string_ids() {
        let id = AxisId::from_stable("axis_wght").unwrap();
        let parsed: AxisId = "axis_wght".parse().unwrap();

        assert_eq!(id, parsed);
        assert_eq!(id.as_str(), "axis_wght");
        assert!("".parse::<AxisId>().is_err());
    }

    #[test]
    fn axis_id_for_tag_keeps_readable_ascii_tags() {
        assert_eq!(AxisId::for_tag("wght").as_str(), "axis_wght");
        assert_eq!(AxisId::for_tag("YTLC").as_str(), "axis_YTLC");
    }
}
