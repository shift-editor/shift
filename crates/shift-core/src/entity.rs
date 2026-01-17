use std::sync::atomic::{AtomicU64, Ordering};

static ENTITY_COUNTER: AtomicU64 = AtomicU64::new(1);
static NO_PARENT: Id = Id(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Id(u64);

#[derive(Debug, Clone, Copy, Eq)]
pub struct EntityId {
    id: Id,
    #[allow(dead_code)]
    parent: Id,
}

// Only compare the id field, not the parent
// This allows IDs reconstructed from JS (with parent=0) to match
impl PartialEq for EntityId {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

// Hash must be consistent with PartialEq - only hash the id field
impl std::hash::Hash for EntityId {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl EntityId {
    fn new() -> Self {
        Self {
            id: Id(ENTITY_COUNTER.fetch_add(1, Ordering::Relaxed)),
            parent: NO_PARENT,
        }
    }

    pub fn new_with_parent(parent: &Self) -> Self {
        Self {
            id: Id(ENTITY_COUNTER.fetch_add(1, Ordering::Relaxed)),
            parent: parent.id,
        }
    }
}

macro_rules! entity_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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

            pub fn new_with_parent<T>(parent: &T) -> Self
            where
                T: AsRef<EntityId>,
            {
                Self(EntityId::new_with_parent(parent.as_ref()))
            }

            pub fn raw(&self) -> u64 {
                self.0.id.0
            }

            /// Reconstruct an ID from its raw value.
            /// Note: This creates an ID without a parent reference.
            /// Use with caution - mainly for deserializing IDs from JS.
            pub fn from_raw(raw: u128) -> Self {
                Self(EntityId {
                    id: Id(raw as u64),
                    parent: NO_PARENT,
                })
            }
        }

        impl From<$name> for u64 {
            fn from(id: $name) -> u64 {
                id.raw()
            }
        }

        impl AsRef<EntityId> for $name {
            fn as_ref(&self) -> &EntityId {
                &self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.raw())
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

entity_id!(ContourId);
entity_id!(PointId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_id_equality_ignores_parent() {
        // Create two EntityIds with the same id but different parents
        let id1 = EntityId {
            id: Id(42),
            parent: Id(10),
        };
        let id2 = EntityId {
            id: Id(42),
            parent: Id(20),
        };
        let id3 = EntityId {
            id: Id(42),
            parent: NO_PARENT,
        };

        // All should be equal because they have the same id
        assert_eq!(id1, id2);
        assert_eq!(id1, id3);
        assert_eq!(id2, id3);
    }

    #[test]
    fn entity_id_inequality_when_different_id() {
        let id1 = EntityId {
            id: Id(42),
            parent: Id(10),
        };
        let id2 = EntityId {
            id: Id(43),
            parent: Id(10),
        };

        assert_ne!(id1, id2);
    }

    #[test]
    fn point_id_from_raw_matches_original() {
        // Simulate what happens when JS sends back an ID:
        // 1. Create a PointId with a parent (like when added to a contour)
        let contour_id = ContourId::new();
        let original = PointId::new_with_parent(&contour_id);
        let raw_value = original.raw();

        // 2. Reconstruct from raw (like when receiving from JS)
        let reconstructed = PointId::from_raw(raw_value as u128);

        // 3. They should be equal even though reconstructed has no parent
        assert_eq!(original, reconstructed);
    }

    #[test]
    fn contour_id_from_raw_matches_original() {
        let original = ContourId::new();
        let raw_value = original.raw();
        let reconstructed = ContourId::from_raw(raw_value as u128);

        assert_eq!(original, reconstructed);
    }

    #[test]
    fn point_id_display_shows_raw_value() {
        let id = PointId::from_raw(12345);
        assert_eq!(id.to_string(), "12345");
    }

    #[test]
    fn point_id_from_str_roundtrip() {
        let original = PointId::new();
        let string_rep = original.to_string();
        let parsed: PointId = string_rep.parse().unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn point_id_from_str_invalid() {
        let result: Result<PointId, _> = "not_a_number".parse();
        assert!(result.is_err());
    }
}
