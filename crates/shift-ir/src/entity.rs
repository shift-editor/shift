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

impl ComponentId {
    pub fn new() -> Self {
        Self(format!("component_{}", EntityId::new().raw()))
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

typed_id!(PointId);
typed_id!(ContourId);
typed_id!(AnchorId);
typed_id!(GuidelineId);
typed_id!(LayerId);
typed_id!(GlyphId);
typed_id!(SourceId);

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
}
