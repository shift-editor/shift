//! Semantic collections for Shift authoring entities.
//!
//! [`EntityList`] is for values that have stable identity and meaningful
//! order. It deliberately differs from a map: iteration and equality both
//! observe authoring order, and serialization emits an ordered sequence.
//! Unordered dictionaries and derived lookup indices should remain behind
//! their domain-specific types instead of using this collection.

use std::hash::Hash;
use std::sync::Arc;

use indexmap::IndexMap;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Supplies the stable identity owned by an authoring entity.
pub trait Identified {
    type Id: Clone + Eq + Hash;

    fn id(&self) -> Self::Id;
}

impl<T> Identified for Arc<T>
where
    T: Identified,
{
    type Id = T::Id;

    fn id(&self) -> Self::Id {
        self.as_ref().id()
    }
}

/// An identity-addressable sequence whose order is part of its value.
///
/// Lookup uses an entity's stable ID, while iteration, equality, and
/// serialization preserve authoring order. Replacing an existing entity keeps
/// its current position; removing one preserves the relative order of the
/// remaining entities.
#[derive(Clone, Debug)]
pub struct EntityList<T>
where
    T: Identified,
{
    entries: IndexMap<T::Id, T>,
}

impl<T> EntityList<T>
where
    T: Identified,
{
    pub fn new() -> Self {
        Self {
            entries: IndexMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains(&self, id: &T::Id) -> bool {
        self.entries.contains_key(id)
    }

    pub fn get(&self, id: &T::Id) -> Option<&T> {
        self.entries.get(id)
    }

    pub fn get_mut(&mut self, id: &T::Id) -> Option<&mut T> {
        self.entries.get_mut(id)
    }

    pub fn get_index(&self, index: usize) -> Option<(&T::Id, &T)> {
        self.entries.get_index(index)
    }

    pub fn keys(&self) -> indexmap::map::Keys<'_, T::Id, T> {
        self.entries.keys()
    }

    pub fn values(&self) -> indexmap::map::Values<'_, T::Id, T> {
        self.entries.values()
    }

    pub fn values_mut(&mut self) -> indexmap::map::ValuesMut<'_, T::Id, T> {
        self.entries.values_mut()
    }

    pub fn iter(&self) -> indexmap::map::Iter<'_, T::Id, T> {
        self.entries.iter()
    }

    /// Inserts an entity at the end or replaces the entity with the same ID.
    ///
    /// Replacement preserves the existing position and returns the previous
    /// value. A newly inserted entity returns `None`.
    pub fn insert(&mut self, entity: T) -> Option<T> {
        self.entries.insert(entity.id(), entity)
    }

    pub fn shift_remove(&mut self, id: &T::Id) -> Option<T> {
        self.entries.shift_remove(id)
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Moves an entity to another position without changing its identity.
    ///
    /// Returns `false` when either index is outside the list.
    pub fn move_index(&mut self, from: usize, to: usize) -> bool {
        if from >= self.len() || to >= self.len() {
            return false;
        }

        self.entries.move_index(from, to);
        true
    }
}

impl<T> Default for EntityList<T>
where
    T: Identified,
{
    fn default() -> Self {
        Self::new()
    }
}

impl<T> PartialEq for EntityList<T>
where
    T: Identified + PartialEq,
{
    fn eq(&self, other: &Self) -> bool {
        self.entries.as_slice() == other.entries.as_slice()
    }
}

impl<T> Eq for EntityList<T> where T: Identified + Eq {}

impl<T> Serialize for EntityList<T>
where
    T: Identified + Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.collect_seq(self.values())
    }
}

impl<'de, T> Deserialize<'de> for EntityList<T>
where
    T: Identified + Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let entities = Vec::<T>::deserialize(deserializer)?;
        let mut list = Self::new();

        for entity in entities {
            if list.insert(entity).is_some() {
                return Err(D::Error::custom("duplicate entity identity"));
            }
        }

        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    struct Item {
        id: u32,
        value: String,
    }

    impl Identified for Item {
        type Id = u32;

        fn id(&self) -> Self::Id {
            self.id
        }
    }

    fn item(id: u32, value: &'static str) -> Item {
        Item {
            id,
            value: value.to_string(),
        }
    }

    #[test]
    fn equality_observes_entity_order() {
        let mut first = EntityList::new();
        first.insert(item(2, "second"));
        first.insert(item(1, "first"));

        let mut reordered = EntityList::new();
        reordered.insert(item(1, "first"));
        reordered.insert(item(2, "second"));

        assert_ne!(first, reordered);
    }

    #[test]
    fn replacement_preserves_position() {
        let mut list = EntityList::new();
        list.insert(item(2, "old"));
        list.insert(item(1, "first"));

        assert_eq!(list.insert(item(2, "new")), Some(item(2, "old")));
        assert_eq!(
            list.values()
                .map(|item| item.value.as_str())
                .collect::<Vec<_>>(),
            vec!["new", "first"]
        );
    }
}
