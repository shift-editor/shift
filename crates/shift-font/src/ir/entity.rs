use serde::{Deserialize, Serialize};
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

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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

typed_id!(PointId);
typed_id!(ContourId);
typed_id!(ComponentId);
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
}
